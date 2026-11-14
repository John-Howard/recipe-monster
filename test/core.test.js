import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIndexText } from '../server/indexParser.js';
import { autoTags, guessCourse, mealFits } from '../server/tagger.js';
import { applyCourseResults } from '../server/ai.js';
import http from 'node:http';
import { normaliseIsbn } from '../server/isbn.js';
import { openDb, Store } from '../server/db.js';
import { generatePlan, rerollSlot, emptySlots, isWeekend } from '../server/planner.js';
import { seedDemo } from '../server/seed-demo.js';
import { lanUrls, isCrossSite } from '../server/index.js';
import { downloadCover, findCover, isLocalCover, removeLocalCover } from '../server/covers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('index parser handles headings, sub-entries, wraps, markers and OCR digits', () => {
  const out = parseIndexText(`INDEX
A
Apple and blackberry crumble 145
asparagus, 12, 34, 56
Chicken
– and leek pie 45
roast chicken with lemon 46
Spiced lamb with apricots and
  couscous 98
Mushroom risotto (V) 23
Chocolate pots (GF) ..... l24
see also beans`);
  const byName = Object.fromEntries(out.map((e) => [e.name, e]));
  assert.equal(byName['Apple and blackberry crumble'].page, '145');
  assert.equal(byName['Chicken and leek pie'].page, '45');
  assert.ok(byName['Roast chicken with lemon']);
  assert.equal(byName['Spiced lamb with apricots and couscous'].page, '98');
  assert.deepEqual(byName['Mushroom risotto'].tags, ['vegetarian']);
  assert.equal(byName['Chocolate pots'].page, '124');
  assert.ok(!out.some((e) => /asparagus|see also/i.test(e.name)));
});

test('auto tagger', () => {
  assert.ok(autoTags('Chicken tikka masala').includes('curry'));
  assert.ok(autoTags('Lemon tart').includes('dessert'));
  assert.ok(!autoTags("Leek and goat's cheese tart").includes('dessert'));
  assert.ok(!autoTags('Banana pancakes').includes('dessert'));
  assert.ok(!autoTags('Yorkshire puddings').includes('dessert'));
  assert.ok(!autoTags('Mushroom stroganoff').includes('beef'));
});

test('ISBN validation', () => {
  assert.equal(normaliseIsbn('978-0-14-103614-4'), '9780141036144');
  assert.equal(normaliseIsbn('9780141036145'), null);
  assert.equal(normaliseIsbn('0-306-40615-2'), '0306406152');
});

function demoStore() {
  const s = new Store(openDb(':memory:'));
  seedDemo(s);
  return s;
}

test('search and theme filters combine (OR within a kind, AND across kinds, NOT)', () => {
  const s = demoStore();
  assert.ok(s.search({ q: 'curry' }).length >= 3);
  const veg = s.search({ filters: [{ type: 'tag', value: 'Vegetarian' }], limit: 1000 });
  const vegMartha = s.search({ filters: [{ type: 'tag', value: 'Vegetarian' }, { type: 'author', value: 'Martha Simmer' }], limit: 1000 });
  assert.ok(vegMartha.length > 0 && vegMartha.length < veg.length);
  assert.ok(vegMartha.every((r) => r.book_authors.includes('Martha Simmer')));
  const noChicken = s.search({ filters: [{ type: 'tag', value: 'chicken', exclude: true }], limit: 1000 });
  assert.ok(noChicken.every((r) => !r.tags.includes('chicken')));
});

test('planner fills a week without repeats, keeps locks, and rerolls', () => {
  const s = demoStore();
  const all = s.allRecipes();
  const theme = { meals: ['breakfast', 'dinner', 'dessert'], days: 7 };
  const g = generatePlan(all, theme);
  assert.equal(g.slots.length, 16);
  const ids = g.slots.map((x) => x.recipe_id);
  assert.ok(ids.every(Boolean));
  assert.equal(new Set(ids).size, ids.length);
  const byId = new Map(all.map((r) => [r.id, r]));
  for (const sl of g.slots.filter((x) => x.meal === 'breakfast')) assert.ok(byId.get(sl.recipe_id).tags.includes('breakfast'));
  g.slots[0].locked = true;
  const again = generatePlan(all, theme, g.slots);
  assert.equal(again.slots[0].recipe_id, g.slots[0].recipe_id);
  const r = rerollSlot(all, theme, again.slots, 3);
  assert.ok(!again.slots.some((x, i) => i !== 3 && x.recipe_id === r.slot.recipe_id));
});

test('adding recipes skips duplicates; export/import round-trips', () => {
  const s = new Store(openDb(':memory:'));
  const id = s.saveBook({ title: 'Test', authors: 'A. Cook', tags: ['Fast 800'] });
  assert.equal(s.addRecipes(id, [{ name: 'Soup', page: '1' }, { name: 'soup', page: '1' }]).added, 1);
  const dump = s.exportAll();
  const s2 = new Store(openDb(':memory:'));
  assert.deepEqual(s2.importAll(dump), { books: 1, recipes: 1 });
  assert.equal(s2.search({ filters: [{ type: 'tag', value: 'Fast 800' }] }).length, 1);
});

test('lanUrls uses PUBLIC_URL when set, stripping trailing slashes', () => {
  const env = { PUBLIC_URL: 'https://192.168.1.162:3443/, https://mac.local:3443' };
  assert.deepEqual(lanUrls({ env }), ['https://192.168.1.162:3443', 'https://mac.local:3443']);
});

test('lanUrls scans interfaces with http, or https when TLS is on', () => {
  const plain = lanUrls({ env: {}, port: 3000 });
  assert.ok(plain.every((u) => u.startsWith('http://') && u.endsWith(':3000')));
  const tls = lanUrls({ env: { TLS_CERT: 'c', TLS_KEY: 'k' }, port: 3000 });
  assert.ok(tls.every((u) => u.startsWith('https://')));
  assert.equal(tls.length, plain.length);
});

const streamOf = (chunks, spy = {}) => {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= chunks.length) return c.close();
      spy.pulled = ++i;
      c.enqueue(chunks[i - 1]);
    },
    cancel() {
      spy.cancelled = true;
    },
  });
};
const imgRes = (url, { type = 'image/jpeg', size = 2048, ok = true, length, spy } = {}) => ({
  ok,
  url,
  headers: { get: (h) => (h === 'content-length' ? length ?? null : type) },
  body: streamOf(size > 0 ? [new Uint8Array(size)] : [], spy),
});
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'covers-'));

test('isLocalCover recognises local paths', () => {
  assert.ok(isLocalCover('/covers/a.jpg'));
  assert.ok(!isLocalCover('https://x.com/a.jpg'));
  assert.ok(!isLocalCover(''));
});

test('downloadCover saves allowed images and upgrades http', async () => {
  const dir = tmpDir();
  const seen = [];
  const fetch = async (u) => (seen.push(u), imgRes(u));
  const url = await downloadCover('http://books.google.com/x?zoom=1', dir, { fetch });
  assert.match(url, /^\/covers\/[\w-]+\.jpg$/);
  assert.ok(seen[0].startsWith('https://books.google.com/'));
  assert.ok(fs.existsSync(path.join(dir, path.basename(url))));
});

test('downloadCover rejects disallowed hosts, bad types, sizes, failures and redirects', async () => {
  const dir = tmpDir();
  const never = async () => assert.fail('should not fetch');
  assert.equal(await downloadCover('https://evil.com/a.jpg', dir, { fetch: never }), null);
  assert.equal(await downloadCover('https://books.google.com.evil.com/a.jpg', dir, { fetch: never }), null);
  assert.equal(await downloadCover('/covers/a.jpg', dir, { fetch: never }), null);
  assert.equal(await downloadCover('https://covers.openlibrary.org/a', dir, { fetch: async (u) => imgRes(u, { type: 'text/html' }) }), null);
  assert.equal(await downloadCover('https://covers.openlibrary.org/a', dir, { fetch: async (u) => imgRes(u, { size: 100 }) }), null);
  assert.equal(await downloadCover('https://covers.openlibrary.org/a', dir, { fetch: async (u) => imgRes(u, { size: 6e6 }) }), null);
  assert.equal(await downloadCover('https://covers.openlibrary.org/a', dir, { fetch: async (u) => imgRes(u, { ok: false }) }), null);
  assert.equal(await downloadCover('https://covers.openlibrary.org/a', dir, { fetch: async () => { throw new Error('boom'); } }), null);
  assert.equal(await downloadCover('https://covers.openlibrary.org/a', dir, { fetch: async () => imgRes('https://ia800.us.archive.org/a.jpg') }) !== null, true);
  assert.equal(fs.readdirSync(dir).length, 1);
});

test('findCover falls back from cover_url to isbn to title search', async () => {
  const dir = tmpDir();
  const calls = [];
  const fetch = async (u) => {
    calls.push(u);
    if (u.includes('search.json')) return { ok: true, url: u, json: async () => ({ docs: [{ cover_i: 42 }] }) };
    if (u.includes('/b/id/42-L.jpg')) return imgRes(u);
    return imgRes(u, { ok: false });
  };
  const url = await findCover({ cover_url: 'https://books.google.com/x', isbn: '9780241446300', title: 'Salt Fat', authors: 'Samin Nosrat, Other' }, dir, { fetch });
  assert.ok(isLocalCover(url));
  assert.equal(calls[0], 'https://books.google.com/x');
  assert.ok(calls[1].startsWith('https://covers.openlibrary.org/b/isbn/9780241446300-L.jpg'));
  const search = calls.find((c) => c.includes('search.json'));
  assert.ok(search.includes('title=Salt+Fat') && search.includes('author=Samin+Nosrat'));
  assert.equal(await findCover({ title: 'X' }, dir, { fetch: async (u) => ({ ok: true, url: u, json: async () => ({ docs: [] }) }) }), null);
});

const redirect = (location) => ({ ok: false, status: 302, url: '', headers: { get: () => location } });

test('downloadCover validates redirect targets before requesting them', async () => {
  const dir = tmpDir();
  const seen = [];
  const bad = async (u) => (seen.push(u), redirect('http://192.168.1.1/x.jpg'));
  assert.equal(await downloadCover('https://covers.openlibrary.org/a', dir, { fetch: bad }), null);
  assert.deepEqual(seen, ['https://covers.openlibrary.org/a']);

  const good = async (u) => (u.includes('archive.org') ? imgRes(u) : redirect('https://ia800.us.archive.org/x.jpg'));
  assert.ok(isLocalCover(await downloadCover('https://covers.openlibrary.org/a', dir, { fetch: good })));

  const loop = async () => redirect('https://archive.org/again');
  assert.equal(await downloadCover('https://archive.org/a', dir, { fetch: loop }), null);
});

test('downloadCover caps size by Content-Length and while streaming', async () => {
  const dir = tmpDir();
  const spy = {};
  let declaredRes;
  const declared = async (u) => (declaredRes = imgRes(u, { length: String(6 * 1024 * 1024), spy }));
  assert.equal(await downloadCover('https://covers.openlibrary.org/a', dir, { fetch: declared }), null);
  assert.equal(declaredRes.body.locked, false);

  const streamed = async (u) => ({ ...imgRes(u), body: streamOf(Array.from({ length: 10 }, () => new Uint8Array(1024 * 1024)), spy) });
  assert.equal(await downloadCover('https://covers.openlibrary.org/a', dir, { fetch: streamed }), null);
  assert.equal(spy.cancelled, true);
  assert.ok(spy.pulled < 10);
  assert.equal(fs.readdirSync(dir).length, 0);
});

test('findCover ignores a local cover_url and removeLocalCover is safe', async () => {
  const dir = tmpDir();
  const calls = [];
  const fetch = async (u) => (calls.push(u), imgRes(u));
  const url = await findCover({ cover_url: '/covers/old.jpg', isbn: '9780141439518', title: 'T' }, dir, { fetch });
  assert.ok(isLocalCover(url));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('/b/isbn/'));

  const keep = path.join(dir, 'keep.jpg');
  fs.writeFileSync(keep, 'x');
  const outside = path.join(path.dirname(dir), 'outside-cover.jpg');
  fs.writeFileSync(outside, 'x');
  removeLocalCover('https://example.com/keep.jpg', dir);
  removeLocalCover(`/covers/../${path.basename(outside)}`, dir);
  removeLocalCover('/covers/sub/../keep.jpg', dir);
  removeLocalCover('/covers/missing.jpg', dir);
  assert.ok(fs.existsSync(keep) && fs.existsSync(outside));
  removeLocalCover('/covers/keep.jpg', dir);
  assert.ok(!fs.existsSync(keep));
  fs.rmSync(outside);
});

test('countBooksWithCover counts books sharing a cover', () => {
  const s = new Store(openDb(':memory:'));
  const a = s.saveBook({ title: 'A', cover_url: '/covers/x.jpg' });
  s.saveBook({ title: 'B', cover_url: '/covers/x.jpg' });
  assert.equal(s.countBooksWithCover('/covers/x.jpg'), 2);
  s.setBookCover(a, '/covers/y.jpg');
  assert.equal(s.countBooksWithCover('/covers/x.jpg'), 1);
  assert.equal(s.countBooksWithCover('/covers/none.jpg'), 0);
});

test('isCrossSite blocks cross-site browsers and foreign origins only', () => {
  assert.equal(isCrossSite({ 'sec-fetch-site': 'cross-site', host: 'a:3000' }), true);
  assert.equal(isCrossSite({ 'sec-fetch-site': 'same-origin', origin: 'https://evil.example', host: 'a:3000' }), false);
  for (const v of ['same-origin', 'none']) assert.equal(isCrossSite({ 'sec-fetch-site': v }), false);
  assert.equal(isCrossSite({ 'sec-fetch-site': 'same-site' }), true);
  assert.equal(isCrossSite({ origin: 'https://evil.example', host: 'a:3000' }), true);
  assert.equal(isCrossSite({ origin: 'http://a:3000', host: 'a:3000' }), false);
  assert.equal(isCrossSite({ origin: 'null', host: 'a:3000' }), true);
  assert.equal(isCrossSite({ host: 'a:3000' }), false);
});

const COURSE_CASES = {
  'Apricot cream cheese frostings': 'dessert',
  'Ginger chocolate ganache': 'dessert',
  Kombucha: 'other',
  'Blueberry chia pots': 'dessert',
  'Cream cheese spreads': 'other',
  'Bird seed crackers': 'other',
  'Trail mix': 'other',
  'Aubergine, vegetable and paneer curry': 'main',
  'Spinach dahl': 'main',
  'Smoked mackerel pâté': 'starter',
  'Celeriac and beetroot soup': 'starter',
  'Mackerel with quinoa tabbouleh': 'main',
  'Turkey and mushroom bolognese': 'main',
  'Kale and tofu scramble': 'main',
  'Roasted Jerusalem artichokes': 'side',
  'Green beans and edamame with anchovies': 'side',
  'Quick baked pears with ginger and walnuts': 'dessert',
  'Mango and lime chia pots': 'dessert',
  'Chocolate cherry coconut bars': 'dessert',
  'Horseradish cream cheese spread': 'other',
  'Slow roasted tomatoes': 'side',
  'Sweet potato wedges': 'side',
  'Honey mustard chicken': 'main',
  'Chicken and leek pie': 'main',
  'Banana pancakes': 'breakfast',
  'Green salad': 'side',
  'Lemon tart': 'dessert',
  'Sweet potato, kale and cod fishcakes': 'main',
  'Chocolate fruit kebabs': 'dessert',
  'Avocado lime tart': 'dessert',
  'Aubergine parmigiana': 'main',
  "Low-carb broccoli mac 'n' cheese": 'main',
  "Low-carb mac 'n' cheese": 'main',
  'Kefir and berry fool': 'dessert',
  'Peach and mint granita': 'dessert',
  'Ginger frozen yoghurt': 'dessert',
  'Chorizo and parsley muffins': 'other',
  'Cider vinegar tipple': 'other',
  'Tropical fruit, mint and cucumber cooler': 'other',
  'Garlic and parsley butter': 'other',
  'Vanilla cashew cream': 'other',
  'Tahini drizzle': 'other',
  'Vegetable bouillon': 'other',
  'Butter chicken': 'main',
  'Lemon drizzle cake': 'dessert',
};

test('guessCourse classifies by name and tags', () => {
  for (const [name, course] of Object.entries(COURSE_CASES)) {
    assert.equal(guessCourse(name, autoTags(name)), course, name);
  }
});

test('mealFits uses course when present and falls back to tags otherwise', () => {
  const r = (course, tags = [], name = 'x') => ({ name, course, tags });
  assert.ok(mealFits(r('main'), 'dinner'));
  assert.ok(!mealFits(r('other'), 'dinner'));
  assert.ok(!mealFits(r('side'), 'dinner'));
  assert.ok(mealFits(r('dessert'), 'dessert'));
  assert.ok(!mealFits(r('main'), 'dessert'));
  assert.ok(mealFits(r('breakfast'), 'breakfast'));
  assert.ok(mealFits(r('starter'), 'lunch'));
  assert.ok(mealFits(r('side', ['salad']), 'lunch'));
  assert.ok(!mealFits(r('dessert'), 'lunch'));
  assert.ok(mealFits({ name: 'Pie', tags: ['pie'] }, 'dinner'));
  assert.ok(!mealFits({ name: 'Bread', tags: ['baking'] }, 'dinner'));
});

test('recipes get a rules course; user and ai courses survive renames', () => {
  const s = new Store(openDb(':memory:'));
  const b = s.saveBook({ title: 'T' });
  s.addRecipes(b, [{ name: 'Spinach dahl' }, { name: 'Kombucha' }]);
  const [dahl, kombucha] = s.getBook(b).recipes.sort((x, y) => x.name.localeCompare(y.name)).reverse();
  assert.equal(dahl.course, 'main');
  assert.equal(dahl.course_source, 'rules');
  assert.equal(s.updateRecipe(dahl.id, { name: 'Chocolate ganache' }).course, 'dessert');
  assert.equal(s.updateRecipe(kombucha.id, { course: 'main' }).course_source, 'user');
  assert.equal(s.updateRecipe(kombucha.id, { name: 'Kombucha 2' }).course, 'main');
  assert.equal(s.setCourses([{ id: kombucha.id, course: 'other' }, { id: dahl.id, course: 'starter' }], 'ai'), 1);
  assert.equal(s.getRecipe(dahl.id).course_source, 'ai');
  assert.equal(s.updateRecipe(dahl.id, { name: 'Spinach dahl soup' }).course, 'starter');
});

test('existing databases are migrated and backfilled with rules courses', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rm-')), 'old.db');
  const old = openDb(file);
  old.exec('ALTER TABLE recipes DROP COLUMN course; ALTER TABLE recipes DROP COLUMN course_source;');
  old.exec("INSERT INTO books (title) VALUES ('B'); INSERT INTO recipes (book_id, name) VALUES (1, 'Kombucha');");
  old.close();
  const s = new Store(openDb(file));
  const r = s.allRecipes()[0];
  assert.equal(r.course, 'other');
  assert.equal(r.course_source, 'rules');
});

test('backup keeps courses and still imports old backups without them', () => {
  const s = new Store(openDb(':memory:'));
  const b = s.saveBook({ title: 'T' });
  s.addRecipes(b, [{ name: 'Kombucha' }]);
  s.updateRecipe(s.allRecipes()[0].id, { course: 'main' });
  const dump = s.exportAll();
  const s2 = new Store(openDb(':memory:'));
  s2.importAll(dump);
  assert.deepEqual([s2.allRecipes()[0].course, s2.allRecipes()[0].course_source], ['main', 'user']);
  for (const r of dump.books[0].recipes) { delete r.course; delete r.course_source; }
  const s3 = new Store(openDb(':memory:'));
  s3.importAll(dump);
  assert.equal(s3.allRecipes()[0].course, 'other');
});

test('applyCourseResults keeps only known ids and valid courses', () => {
  const batch = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
  assert.deepEqual(
    applyCourseResults(batch, [{ id: 1, course: 'main' }, { id: 2, course: 'bogus' }, { id: 3, course: 'side' }, { id: 1, course: 'side' }]),
    [{ id: 1, course: 'main' }]
  );
});

test('course routes need AI and classify non-user recipes', async () => {
  const { createApp } = await import('../server/index.js');
  const s = new Store(openDb(':memory:'));
  const b = s.saveBook({ title: 'T' });
  s.addRecipes(b, [{ name: 'Kombucha' }, { name: 'Mine' }]);
  const mine = s.allRecipes().find((r) => r.name === 'Mine');
  s.updateRecipe(mine.id, { course: 'side' });
  const seen = [];
  const classify = async (recipes) => (seen.push(...recipes.map((r) => r.name)), recipes.map((r) => ({ id: r.id, course: 'starter' })));
  const server = http.createServer(createApp(s, { classify }));
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const post = (p) => fetch(url + p, { method: 'POST' }).then(async (r) => [r.status, await r.json()]);
  const saved = process.env.ANTHROPIC_API_KEY;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    assert.equal((await post(`/api/books/${b}/courses`))[0], 400);
    process.env.ANTHROPIC_API_KEY = 'x';
    assert.deepEqual(await post(`/api/books/${b}/courses`), [200, { classified: 1 }]);
    assert.deepEqual(seen, ['Kombucha']);
    assert.deepEqual(await post('/api/courses/recheck'), [200, { classified: 1 }]);
    assert.equal(s.getRecipe(mine.id).course, 'side');
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
    server.close();
  }
});

const rec = (id, name, course, tags = []) => ({ id, name, course, tags, book_id: id, favourite: 0, rating: 0, times_cooked: 0, last_cooked: null });

test('isWeekend counts Saturday and Sunday from the start date, defaulting to a Monday start', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((d) => isWeekend('2026-11-09', d)), [false, false, false, false, false, true, true]);
  assert.deepEqual([0, 1, 2].map((d) => isWeekend('2026-11-14', d)), [true, true, false]);
  assert.deepEqual([0, 5, 6, 7].map((d) => isWeekend(undefined, d)), [false, true, true, false]);
});

test('starters and puddings appear only on weekend days when enabled', () => {
  const theme = { meals: ['dinner'], days: 7, start: '2026-11-09' };
  const meals = (t) => emptySlots(7, t.meals, t).filter((x) => x.meal !== 'dinner').map((x) => `${x.day}${x.meal}`);
  assert.deepEqual(meals(theme), []);
  assert.deepEqual(meals({ ...theme, starters: 'weekends', puddings: 'weekends' }), ['5starter', '5dessert', '6starter', '6dessert']);
  const recipes = [rec(1, 'Chicken pie', 'main', ['chicken']), rec(2, 'Leek soup', 'starter', ['soup']), rec(3, 'Berry fool', 'dessert')];
  const g = generatePlan(recipes, { ...theme, starters: 'weekends' });
  assert.deepEqual(g.slots.filter((x) => x.meal === 'starter').map((x) => x.day), [5, 6]);
  assert.equal(g.slots.filter((x) => x.meal === 'dessert').length, 0);
});

test('a legacy dessert meal in a theme turns on weekend puddings', () => {
  const recipes = [rec(1, 'Chicken pie', 'main'), rec(3, 'Berry fool', 'dessert'), rec(4, 'Lemon tart', 'dessert')];
  const g = generatePlan(recipes, { meals: ['dinner', 'dessert'], days: 7, start: '2026-11-09' });
  assert.deepEqual(g.slots.filter((x) => x.meal === 'dessert').map((x) => x.day), [5, 6]);
  assert.equal(g.slots.filter((x) => x.meal === 'dinner').length, 7);
});

test('starters avoid the main ingredient of the same evening', () => {
  const main = rec(1, 'Roast chicken', 'main', ['chicken']);
  const chickenSoup = rec(2, 'Chicken broth', 'starter', ['chicken']);
  const veg = rec(3, 'Beetroot dip', 'starter', ['dip']);
  for (const pool of [[chickenSoup, veg], [veg, chickenSoup]]) {
    const g = generatePlan([main, ...pool], { meals: ['dinner'], days: 1, start: '2026-11-14', starters: 'weekends' }, null, () => 0.5);
    assert.equal(g.slots.find((x) => x.meal === 'starter').recipe_id, 3);
  }
});

test('puddings after a heavy main lean light, and reroll keeps that', () => {
  const main = rec(1, 'Chicken and leek pie', 'main', ['pie', 'chicken']);
  const heavy = rec(2, 'Treacle tart', 'dessert');
  const light = rec(3, 'Berry fool', 'dessert');
  for (const pool of [[heavy, light], [light, heavy]]) {
    const theme = { meals: ['dinner'], days: 1, start: '2026-11-14', puddings: 'weekends' };
    const g = generatePlan([main, ...pool], theme, null, () => 0.5);
    assert.equal(g.slots.find((x) => x.meal === 'dessert').recipe_id, 3);
    const idx = g.slots.findIndex((x) => x.meal === 'dessert');
    g.slots[idx].recipe_id = null;
    assert.equal(rerollSlot([main, ...pool], theme, g.slots, idx, () => 0.5).slot.recipe_id, 3);
  }
});

test('mealFits handles starters', () => {
  assert.ok(mealFits({ name: 'x', course: 'starter', tags: [] }, 'starter'));
  assert.ok(!mealFits({ name: 'x', course: 'main', tags: [] }, 'starter'));
  assert.ok(mealFits({ name: 'Leek soup', tags: ['soup'] }, 'starter'));
  assert.ok(mealFits({ name: 'Smoked mackerel pate', tags: [] }, 'starter'));
  assert.ok(!mealFits({ name: 'Chicken pie', tags: ['pie'] }, 'starter'));
});

test('current plan versions increment and survive backup', () => {
  const s = new Store(openDb(':memory:'));
  assert.deepEqual(s.getCurrentPlan(), { plan: null, version: 0 });
  assert.equal(s.saveCurrentPlan({ name: 'A' }), 1);
  assert.equal(s.saveCurrentPlan({ name: 'B' }), 2);
  assert.deepEqual(s.getCurrentPlan(), { plan: { name: 'B' }, version: 2 });
  const s2 = new Store(openDb(':memory:'));
  s2.importAll(s.exportAll());
  assert.equal(s2.getCurrentPlan().plan.name, 'B');
  s2.importAll({ books: [] });
  assert.equal(s2.getCurrentPlan().plan.name, 'B');
});

test('current plan route saves, validates and broadcasts', async () => {
  const { createApp } = await import('../server/index.js');
  const s = new Store(openDb(':memory:'));
  const server = http.createServer(createApp(s));
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const put = (body) => fetch(`${url}/api/current-plan`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ac = new AbortController();
  try {
    const events = await fetch(`${url}/api/events`, { signal: ac.signal });
    const reader = events.body.getReader();
    await reader.read();
    assert.deepEqual(await (await fetch(`${url}/api/current-plan`)).json(), { plan: null, version: 0 });
    assert.equal((await put({ plan: 'x', client: 'a' })).status, 400);
    assert.equal((await put({ plan: [], client: 'a' })).status, 400);
    assert.deepEqual(await (await put({ plan: { name: 'Week' }, client: 'a' })).json(), { version: 1 });
    assert.deepEqual(await (await fetch(`${url}/api/current-plan`)).json(), { plan: { name: 'Week' }, version: 1 });
    const { value } = await reader.read();
    assert.deepEqual(JSON.parse(new TextDecoder().decode(value).replace(/^data: /, '')), { type: 'current-plan', version: 1, client: 'a' });
  } finally {
    ac.abort();
    server.closeAllConnections();
    server.close();
  }
});

test('validatePlan accepts real plans and rejects malformed ones', async () => {
  const { validatePlan } = await import('../server/validatePlan.js');
  const good = {
    name: 'Week',
    theme: { start: '2026-11-09', days: 7, meals: ['dinner'], starters: 'off', puddings: 'weekends', chips: [{ type: 'tag', value: 'soup' }] },
    slots: [{ day: 0, meal: 'dinner', recipe_id: 3, locked: false, cooked: false }, { day: 13, meal: 'dessert', recipe_id: null }],
    recipes: {},
  };
  assert.equal(validatePlan(good), null);
  assert.equal(validatePlan({}), null);
  const bad = (patch) => validatePlan({ ...good, theme: { ...good.theme, ...patch.theme }, ...(patch.slots && { slots: patch.slots }) });
  for (const p of [null, 'x', []]) assert.match(validatePlan(p), /object/);
  assert.match(bad({ theme: { start: '"><x>' } }), /start/);
  assert.match(bad({ theme: { days: 15 } }), /days/);
  assert.match(bad({ theme: { days: 1.5 } }), /days/);
  assert.match(bad({ theme: { meals: ['brunch'] } }), /meals/);
  assert.match(bad({ theme: { starters: 'always' } }), /starters/);
  assert.match(bad({ theme: { puddings: 1 } }), /puddings/);
  assert.match(bad({ theme: { chips: [{ type: 'x"y', value: 'a' }] } }), /chip/);
  assert.match(bad({ theme: { chips: [{ type: 'tag', value: 'a'.repeat(201) }] } }), /chip/);
  assert.match(bad({ theme: { chips: 'no' } }), /chips/);
  assert.match(bad({ slots: [{ day: 14, meal: 'dinner', recipe_id: 1 }] }), /slot/);
  assert.match(bad({ slots: [{ day: 0, meal: 'x', recipe_id: 1 }] }), /slot/);
  assert.match(bad({ slots: [{ day: 0, meal: 'dinner', recipe_id: '1' }] }), /slot/);
  assert.match(bad({ slots: [{ day: 0, meal: 'dinner', recipe_id: 1, locked: 'yes' }] }), /slot/);
  assert.match(bad({ slots: Array(201).fill({ day: 0, meal: 'dinner', recipe_id: 1 }) }), /slots/);
  assert.match(validatePlan({ ...good, name: 'a'.repeat(600000) }), /large/);
});

test('current plan route and import reject invalid plans', async () => {
  const { createApp } = await import('../server/index.js');
  const s = new Store(openDb(':memory:'));
  const server = http.createServer(createApp(s));
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://localhost:${server.address().port}/api/current-plan`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: { theme: { start: '"><x>' } } }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /start/);
    s.importAll({ books: [], current_plan: { theme: { days: 99 } } });
    assert.equal(s.getCurrentPlan().plan, null);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
