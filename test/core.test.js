import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIndexText } from '../server/indexParser.js';
import { autoTags } from '../server/tagger.js';
import { normaliseIsbn } from '../server/isbn.js';
import { openDb, Store } from '../server/db.js';
import { generatePlan, rerollSlot } from '../server/planner.js';
import { seedDemo } from '../server/seed-demo.js';
import { lanUrls } from '../server/index.js';
import { downloadCover, findCover, isLocalCover } from '../server/covers.js';
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
  assert.equal(g.slots.length, 21);
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

const imgRes = (url, { type = 'image/jpeg', size = 2048, ok = true } = {}) => ({
  ok,
  url,
  headers: { get: () => type },
  arrayBuffer: async () => new ArrayBuffer(size),
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
