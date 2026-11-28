import { validatePlan } from './validatePlan.js';
import express from 'express';
import os from 'node:os';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, Store } from './db.js';
import { parseIndexText } from './indexParser.js';
import { generatePlan, rerollSlot } from './planner.js';
import { lookupIsbn } from './isbn.js';
import { findCover, isLocalCover, removeLocalCover } from './covers.js';
import { aiEnabled, extractIndex, extractBook, classifyCourses } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.RECIPE_MONSTER_DATA || path.resolve('data');
const COVERS_DIR = path.join(DATA_DIR, 'covers');
fs.mkdirSync(COVERS_DIR, { recursive: true });

export function isCrossSite(headers) {
  const site = headers['sec-fetch-site'];
  if (site) return !['same-origin', 'none'].includes(site);
  if (!headers.origin) return false;
  try {
    return new URL(headers.origin).host !== headers.host;
  } catch {
    return true;
  }
}

export function createApp(store, { classify = classifyCourses } = {}) {
  const app = express();
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !isCrossSite(req.headers)) return next();
    res.status(403).json({ error: 'Cross-site request blocked' });
  });
  app.use(express.json({ limit: '25mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/covers', express.static(COVERS_DIR, { maxAge: '30d' }));

  // ---- live updates: the desktop hears about scans done on the phone ----
  const clients = new Set();
  const broadcast = (event) => {
    const msg = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(msg);
  };
  app.get('/api/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  });

  const wrap = (fn) => async (req, res) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message || String(e) });
    }
  };
  const id = (req) => Number(req.params.id);

  app.get('/api/info', wrap(() => ({ lanUrls: lanUrls(), aiEnabled: aiEnabled(), stats: store.stats() })));

  // ---- books ----
  const localiseCover = async (bookId, { refresh = false } = {}) => {
    const book = store.getBook(bookId);
    if (!book || (!refresh && isLocalCover(book.cover_url))) return book;
    const url = await findCover(book, COVERS_DIR);
    if (!url) return book;
    store.setBookCover(bookId, url);
    if (refresh && !store.countBooksWithCover(book.cover_url)) removeLocalCover(book.cover_url, COVERS_DIR);
    return store.getBook(bookId);
  };
  const wantsRefresh = (req) => req.query.refresh === '1';
  app.get('/api/books', wrap(() => store.listBooks()));
  const localiseInBackground = (bookId) =>
    localiseCover(bookId)
      .then((book) => isLocalCover(book?.cover_url) && broadcast({ type: 'library-changed' }))
      .catch((e) => console.error('cover download failed:', e.message));
  app.post('/api/books', wrap((req) => {
    const dup = store.recentDuplicateBook(req.body);
    if (dup) return store.getBook(dup);
    const bookId = store.saveBook(req.body);
    const book = store.getBook(bookId);
    localiseInBackground(bookId);
    broadcast({ type: 'book-added', book: { id: book.id, title: book.title } });
    return book;
  }));
  app.get('/api/books/:id', wrap((req) => store.getBook(id(req)) || Promise.reject(Object.assign(new Error('Not found'), { status: 404 }))));
  app.put('/api/books/:id', wrap((req) => {
    store.saveBook(req.body, id(req));
    broadcast({ type: 'library-changed' });
    localiseInBackground(id(req));
    return store.getBook(id(req));
  }));
  app.post('/api/books/:id/cover', wrap(async (req) => {
    const before = store.getBook(id(req));
    if (!before) throw Object.assign(new Error('Not found'), { status: 404 });
    const refresh = wantsRefresh(req);
    const book = await localiseCover(before.id, { refresh });
    if (refresh && book.cover_url === before.cover_url) throw new Error('No cover found online');
    if (!isLocalCover(book.cover_url)) throw new Error('No cover found');
    if (book.cover_url !== before.cover_url) broadcast({ type: 'library-changed' });
    return book;
  }));
  app.post('/api/covers/fetch-missing', wrap(async (req) => {
    const refresh = wantsRefresh(req);
    const books = store.listBooks().filter((b) => refresh || !isLocalCover(b.cover_url));
    let found = 0;
    for (const b of books) {
      const book = await localiseCover(b.id, { refresh });
      if (book.cover_url !== b.cover_url) found++;
    }
    if (found) broadcast({ type: 'library-changed' });
    return { checked: books.length, found };
  }));
  app.delete('/api/books/:id', wrap((req) => {
    store.deleteBook(id(req));
    broadcast({ type: 'library-changed' });
  }));
  app.post('/api/books/:id/recipes', wrap((req) => {
    const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
    const result = store.addRecipes(id(req), entries);
    const book = store.getBook(id(req));
    broadcast({ type: 'recipes-added', book: { id: book.id, title: book.title }, added: result.added, from: req.body.from || 'scan' });
    if (aiEnabled() && result.ids.length) {
      classifyBook(book.id, result.ids)
        .then((n) => n && broadcast({ type: 'library-changed' }))
        .catch((e) => console.error('course classification failed:', e.message));
    }
    return { ...result, total: book.recipes.length };
  }));
  const classifyBook = async (bookId, only = null, onBatch) => {
    const book = store.getBook(bookId);
    const todo = book.recipes.filter((r) => r.course_source !== 'user' && (!only || only.includes(r.id))).map((r) => ({ id: r.id, name: r.name }));
    if (!todo.length) return 0;
    return store.setCourses(await classify(todo, book, { onBatch }), 'ai');
  };
  const requireAi = () => {
    if (!aiEnabled()) throw new Error('AI is not set up on the server (set ANTHROPIC_API_KEY).');
  };
  app.post('/api/books/:id/courses', wrap(async (req) => {
    requireAi();
    const classified = await classifyBook(id(req));
    if (classified) broadcast({ type: 'library-changed' });
    return { classified };
  }));
  let recheckJob = null;
  app.post('/api/courses/recheck', wrap(() => {
    requireAi();
    if (jobs.get(recheckJob)?.status === 'working') return { job: recheckJob };
    const books = store.listBooks().map((b) => ({ id: b.id, title: b.title, count: store.getBook(b.id).recipes.filter((r) => r.course_source !== 'user').length }));
    const total = books.reduce((n, b) => n + b.count, 0);
    ({ job: recheckJob } = startJob(async (progress) => {
      let classified = 0;
      let before = 0;
      progress({ done: 0, total, book: '' });
      for (const b of books) {
        progress({ done: before, book: b.title });
        const onBatch = (n) => progress({ done: before + n });
        classified += await classifyBook(b.id, null, onBatch);
        before += b.count;
      }
      if (classified) broadcast({ type: 'library-changed' });
      return { classified };
    }));
    return { job: recheckJob };
  }));
  app.post('/api/demo', wrap(async () => {
    if (store.stats().demo) throw new Error('The demo books are already on the shelf.');
    const { seedDemo } = await import('./seed-demo.js');
    const r = seedDemo(store);
    broadcast({ type: 'library-changed' });
    return r;
  }));
  app.delete('/api/demo', wrap(() => {
    const removed = store.deleteDemo();
    broadcast({ type: 'library-changed' });
    return { removed };
  }));

  // ---- recipes & search ----
  app.put('/api/recipes/:id', wrap((req) => store.updateRecipe(id(req), req.body)));
  app.delete('/api/recipes/:id', wrap((req) => store.deleteRecipe(id(req))));
  app.post('/api/recipes/:id/cooked', wrap((req) => store.markCooked(id(req), req.body.cooked !== false)));
  app.post('/api/recipes/lookup', wrap((req) => {
    const ids = (req.body.ids || []).map(Number).filter(Boolean);
    return ids.length ? store.recipesWhere(`r.id IN (${ids.join(',')})`) : [];
  }));
  app.post('/api/recipes/tags', wrap((req) => {
    const updated = store.bulkTagRecipes(req.body.ids, { add: req.body.add, remove: req.body.remove });
    broadcast({ type: 'library-changed' });
    return { updated };
  }));
  app.get('/api/tags', wrap(() => store.listTags()));
  app.put('/api/tags/:tag', wrap((req) => {
    const result = store.renameTag(req.params.tag, req.body.name);
    broadcast({ type: 'library-changed' });
    return result;
  }));
  app.delete('/api/tags/:tag', wrap((req) => {
    const result = store.deleteTag(req.params.tag);
    broadcast({ type: 'library-changed' });
    return result;
  }));
  app.post('/api/search', wrap((req) => store.search(req.body || {})));
  app.get('/api/facets', wrap(() => store.facets()));

  // ---- planning ----
  const withRecipes = (slots) => store.recipesById(slots.map((s) => s.recipe_id));
  app.post('/api/plan/generate', wrap((req) => {
    const { theme = {}, slots = null } = req.body;
    const result = generatePlan(store.allRecipes(), theme, slots);
    return { ...result, recipes: withRecipes(result.slots) };
  }));
  app.post('/api/plan/reroll', wrap((req) => {
    const { theme = {}, slots = [], index } = req.body;
    const result = rerollSlot(store.allRecipes(), theme, slots, Number(index));
    return { ...result, recipes: withRecipes([result.slot]) };
  }));
  app.post('/api/plan/preview', wrap((req) => {
    // How many recipes would this theme give us? Used for the live counter in the theme builder.
    const rows = store.search({ filters: req.body.chips || [], limit: 100000 });
    const sample = rows.sort(() => Math.random() - 0.5).slice(0, 12).map((r) => r.name);
    return { count: rows.length, books: new Set(rows.map((r) => r.book_id)).size, sample };
  }));
  app.get('/api/plans', wrap(() => store.listPlans()));
  app.get('/api/plans/:id', wrap((req) => {
    const p = store.getPlan(id(req));
    if (!p) throw Object.assign(new Error('Not found'), { status: 404 });
    return { ...p, recipes: withRecipes(p.slots) };
  }));
  app.post('/api/plans', wrap((req) => store.getPlan(store.savePlan(req.body))));
  app.put('/api/plans/:id', wrap((req) => store.getPlan(store.savePlan(req.body, id(req)))));
  app.delete('/api/plans/:id', wrap((req) => store.deletePlan(id(req))));
  app.get('/api/current-plan', wrap(() => store.getCurrentPlan()));
  app.put('/api/current-plan', wrap((req) => {
    const { plan, client } = req.body;
    const problem = validatePlan(plan);
    if (problem) throw Object.assign(new Error(problem), { status: 400 });
    const version = store.saveCurrentPlan(plan);
    broadcast({ type: 'current-plan', version, client });
    return { version };
  }));
  app.get('/api/themes', wrap(() => store.listThemes()));
  app.post('/api/themes', wrap((req) => ({ id: store.saveTheme(req.body) })));
  app.delete('/api/themes/:id', wrap((req) => store.deleteTheme(id(req))));

  // ---- scanning ----
  app.get('/api/isbn/:isbn', wrap(async (req) => lookupIsbn(req.params.isbn)));
  app.post('/api/scan/parse', wrap((req) => ({ entries: parseIndexText(req.body.text || ''), via: 'ocr' })));
  // AI reads can take a while, so they run as background jobs. The phone gets a job id straight away
  // and checks back, which means a dropped Wi-Fi connection or a phone that went to sleep doesn't lose the result.
  const jobs = new Map();
  const startJob = (work) => {
    const jobId = crypto.randomUUID();
    const job = { status: 'working', started: Date.now() };
    jobs.set(jobId, job);
    work((fields) => {
      job.progress = { ...job.progress, ...fields };
    })
      .then((result) => Object.assign(job, { status: 'done', result }))
      .catch((e) => Object.assign(job, { status: 'error', error: e.message || String(e) }))
      .finally(() => setTimeout(() => jobs.delete(jobId), 30 * 60 * 1000).unref());
    return { job: jobId };
  };
  app.get('/api/jobs/:job', wrap((req) => {
    const job = jobs.get(req.params.job);
    if (!job) throw Object.assign(new Error('That reading job has expired. Please read the page again.'), { status: 404 });
    return job;
  }));
  app.post('/api/scan/index', wrap((req) => {
    if (!aiEnabled()) throw new Error('AI reading is not set up on the server (set ANTHROPIC_API_KEY). Use on-phone OCR instead.');
    return startJob(async () => ({ entries: await extractIndex(req.body.image), via: 'ai' }));
  }));
  app.post('/api/scan/book', wrap((req) => {
    if (!aiEnabled()) throw new Error('AI reading is not set up on the server (set ANTHROPIC_API_KEY).');
    return startJob(() => extractBook(req.body.image));
  }));
  app.post('/api/covers', wrap((req) => {
    const m = String(req.body.image || '').match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
    if (!m) throw new Error('Expected an image');
    const name = `${crypto.randomUUID()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.writeFileSync(path.join(COVERS_DIR, name), Buffer.from(m[2], 'base64'));
    return { url: `/covers/${name}` };
  }));

  // ---- backup ----
  app.get('/api/export', (req, res) => {
    res.set('Content-Disposition', `attachment; filename="recipe-monster-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(store.exportAll());
  });
  app.post('/api/import', wrap((req) => {
    const r = store.importAll(req.body);
    broadcast({ type: 'library-changed' });
    return r;
  }));

  app.get('/scan', (req, res) => res.redirect('/scan.html'));
  return app;
}

function hasHostname(u) {
  try {
    return Boolean(new URL(u).hostname);
  } catch {
    return false;
  }
}

export function lanUrls({ port = PORT, env = process.env } = {}) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.split(',').map((u) => u.trim().replace(/\/+$/, '')).filter(hasHostname);
  const scheme = env.TLS_CERT && env.TLS_KEY ? 'https' : 'http';
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`${scheme}://${a.address}:${port}`);
    }
  }
  // Prefer typical home-network ranges first.
  return urls.sort((a, b) => Number(/\/\/(192\.168|10\.)/.test(b)) - Number(/\/\/(192\.168|10\.)/.test(a)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const store = new Store(openDb());
  if ((process.env.SEED_DEMO === '1' || process.argv.includes('--demo')) && store.stats().books === 0) {
    const { seedDemo } = await import('./seed-demo.js');
    seedDemo(store);
  }
  const { TLS_CERT, TLS_KEY } = process.env;
  const tls = Boolean(TLS_CERT && TLS_KEY);
  const app = createApp(store);
  const server = tls
    ? https.createServer({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }, app)
    : http.createServer(app);
  if (tls) server.on('tlsClientError', (err, socket) => console.warn('TLS client error', socket.remoteAddress, err.code || err.message));
  if (process.env.LOG_REQUESTS === '1') {
    server.on('request', (req, res) => {
      res.on('finish', () => console.log(req.method, req.url, res.statusCode, req.socket.remoteAddress, String(req.headers['user-agent'] || '').slice(0, 60)));
    });
  }
  server.listen(PORT, '0.0.0.0', () => {
    const urls = lanUrls();
    console.log(`\n  🍲  Recipe Monster is hungry and listening!\n`);
    console.log(`  On this computer:  ${tls ? 'https' : 'http'}://localhost:${PORT}`);
    for (const u of urls) console.log(`  On your phone:     ${u}/scan.html`);
    console.log(`  AI page reading:   ${aiEnabled() ? 'ON (Claude vision)' : 'off: set ANTHROPIC_API_KEY to enable; on-phone OCR is used instead'}\n`);
  });
  // Node closes idle keep-alive connections after 5s by default. Safari (especially on iPhone) often reuses
  // a connection just as the server closes it, which shows up as "The network connection was lost".
  // Keep idle connections open for longer than browsers do, and allow slow uploads over patchy Wi-Fi.
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;
  server.requestTimeout = 10 * 60_000;
}
