// SQLite storage using Node's built-in driver (no native build step needed).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { autoTags } from './tagger.js';

const DATA_DIR = process.env.RECIPE_MONSTER_DATA || path.resolve('data');

export function openDb(file = path.join(DATA_DIR, 'recipe-monster.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT DEFAULT '',
      authors TEXT DEFAULT '',
      isbn TEXT DEFAULT '',
      publisher TEXT DEFAULT '',
      year TEXT DEFAULT '',
      cover_url TEXT DEFAULT '',
      colour TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS book_tags (
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (book_id, tag)
    );
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      page TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      rating INTEGER DEFAULT 0,
      favourite INTEGER DEFAULT 0,
      times_cooked INTEGER DEFAULT 0,
      last_cooked TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS recipes_book ON recipes(book_id);
    CREATE TABLE IF NOT EXISTS recipe_tags (
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      source TEXT DEFAULT 'auto',
      PRIMARY KEY (recipe_id, tag)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS recipes_fts USING fts5(name, tags, book, authors, tokenize = 'porter unicode61');
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      week_start TEXT,
      theme_json TEXT DEFAULT '{}',
      slots_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS themes (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '🍽️',
      theme_json TEXT NOT NULL
    );
  `);
  return db;
}

const tidyTag = (t) => String(t || '').trim().replace(/\s+/g, ' ').slice(0, 60);
const uniq = (arr) => [...new Map(arr.filter(Boolean).map((t) => [t.toLowerCase(), t])).values()];

export function splitAuthors(s) {
  return String(s || '')
    .split(/\s*(?:,|;|&|\band\b)\s*/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

export class Store {
  constructor(db) {
    this.db = db;
  }

  tx(fn) {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- books ----------
  listBooks() {
    const books = this.db
      .prepare(
        `SELECT b.*, (SELECT COUNT(*) FROM recipes r WHERE r.book_id = b.id) AS recipe_count
         FROM books b ORDER BY b.title COLLATE NOCASE`
      )
      .all();
    const tags = this.db.prepare('SELECT book_id, tag FROM book_tags ORDER BY tag').all();
    const byBook = new Map();
    for (const t of tags) {
      if (!byBook.has(t.book_id)) byBook.set(t.book_id, []);
      byBook.get(t.book_id).push(t.tag);
    }
    return books.map((b) => ({ ...b, tags: byBook.get(b.id) || [] }));
  }

  getBook(id) {
    const b = this.db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    if (!b) return null;
    b.tags = this.db.prepare('SELECT tag FROM book_tags WHERE book_id = ? ORDER BY tag').all(id).map((r) => r.tag);
    b.recipes = this.recipesWhere('r.book_id = ?', [id], 'ORDER BY CAST(r.page AS INTEGER), r.name COLLATE NOCASE');
    return b;
  }

  countBooksWithCover(url) {
    return this.db.prepare('SELECT COUNT(*) AS n FROM books WHERE cover_url = ?').get(url).n;
  }

  setBookCover(id, url) {
    this.db.prepare('UPDATE books SET cover_url = ? WHERE id = ?').run(url, id);
  }

  saveBook(data, id = null) {
    const fields = ['title', 'subtitle', 'authors', 'isbn', 'publisher', 'year', 'cover_url', 'colour', 'notes'];
    const vals = fields.map((f) => String(data[f] ?? '').trim());
    if (!vals[0]) throw new Error('A book needs a title');
    return this.tx(() => {
      if (id) {
        const existing = this.db.prepare('SELECT * FROM books WHERE id = ?').get(id);
        if (!existing) throw new Error('Book not found');
        const merged = fields.map((f, i) => (data[f] === undefined ? existing[f] : vals[i]));
        this.db.prepare(`UPDATE books SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(...merged, id);
      } else {
        const r = this.db
          .prepare(`INSERT INTO books (${fields.join(', ')}, is_demo) VALUES (${fields.map(() => '?').join(', ')}, ?)`)
          .run(...vals, data.is_demo ? 1 : 0);
        id = Number(r.lastInsertRowid);
      }
      if (Array.isArray(data.tags)) {
        this.db.prepare('DELETE FROM book_tags WHERE book_id = ?').run(id);
        const ins = this.db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag) VALUES (?, ?)');
        for (const t of uniq(data.tags.map(tidyTag))) ins.run(id, t);
      }
      this.reindexBook(id);
      return id;
    });
  }

  // A phone that lost its connection may send "create this book" twice. Treat an identical book created in
  // the last few minutes as the same one.
  recentDuplicateBook({ title, isbn }) {
    const row = this.db
      .prepare(`SELECT id FROM books WHERE lower(title) = lower(?) AND isbn = ? AND created_at >= datetime('now', '-5 minutes') ORDER BY id DESC LIMIT 1`)
      .get(String(title || '').trim(), String(isbn || '').trim());
    return row ? row.id : null;
  }

  deleteBook(id) {
    this.tx(() => {
      const ids = this.db.prepare('SELECT id FROM recipes WHERE book_id = ?').all(id).map((r) => r.id);
      const del = this.db.prepare('DELETE FROM recipes_fts WHERE rowid = ?');
      for (const rid of ids) del.run(rid);
      this.db.prepare('DELETE FROM books WHERE id = ?').run(id);
    });
  }

  deleteDemo() {
    const ids = this.db.prepare('SELECT id FROM books WHERE is_demo = 1').all().map((r) => r.id);
    for (const id of ids) this.deleteBook(id);
    return ids.length;
  }

  // ---------- recipes ----------
  addRecipes(bookId, entries) {
    if (!this.db.prepare('SELECT 1 FROM books WHERE id = ?').get(bookId)) throw new Error('Book not found');
    return this.tx(() => {
      const existing = new Set(
        this.db
          .prepare(`SELECT lower(name) || '|' || page AS k FROM recipes WHERE book_id = ?`)
          .all(bookId)
          .map((r) => r.k)
      );
      const ins = this.db.prepare('INSERT INTO recipes (book_id, name, page) VALUES (?, ?, ?)');
      const added = [];
      let skipped = 0;
      for (const e of entries) {
        const name = String(e.name || '').trim().replace(/\s+/g, ' ');
        const page = String(e.page ?? '').trim();
        if (!name) continue;
        const key = `${name.toLowerCase()}|${page}`;
        if (existing.has(key)) {
          skipped++;
          continue;
        }
        existing.add(key);
        const id = Number(ins.run(bookId, name, page).lastInsertRowid);
        this.setRecipeTags(id, uniq([...(e.tags || []), ...autoTags(name)]), 'auto');
        added.push(id);
      }
      for (const id of added) this.reindexRecipe(id);
      return { added: added.length, skipped };
    });
  }

  updateRecipe(id, data) {
    const r = this.db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
    if (!r) throw new Error('Recipe not found');
    const next = {
      name: data.name !== undefined ? String(data.name).trim() || r.name : r.name,
      page: data.page !== undefined ? String(data.page).trim() : r.page,
      notes: data.notes !== undefined ? String(data.notes) : r.notes,
      rating: data.rating !== undefined ? Math.max(0, Math.min(5, Number(data.rating) || 0)) : r.rating,
      favourite: data.favourite !== undefined ? (data.favourite ? 1 : 0) : r.favourite,
    };
    this.tx(() => {
      this.db
        .prepare('UPDATE recipes SET name = ?, page = ?, notes = ?, rating = ?, favourite = ? WHERE id = ?')
        .run(next.name, next.page, next.notes, next.rating, next.favourite, id);
      if (Array.isArray(data.tags)) {
        this.db.prepare('DELETE FROM recipe_tags WHERE recipe_id = ?').run(id);
        this.setRecipeTags(id, uniq(data.tags.map(tidyTag)), 'user');
      } else if (data.name !== undefined && next.name !== r.name) {
        this.db.prepare("DELETE FROM recipe_tags WHERE recipe_id = ? AND source = 'auto'").run(id);
        this.setRecipeTags(id, autoTags(next.name), 'auto');
      }
      this.reindexRecipe(id);
    });
    return this.getRecipe(id);
  }

  markCooked(id, cooked = true) {
    if (cooked) {
      this.db
        .prepare("UPDATE recipes SET times_cooked = times_cooked + 1, last_cooked = date('now') WHERE id = ?")
        .run(id);
    } else {
      this.db.prepare('UPDATE recipes SET times_cooked = MAX(0, times_cooked - 1) WHERE id = ?').run(id);
    }
    return this.getRecipe(id);
  }

  deleteRecipe(id) {
    this.tx(() => {
      this.db.prepare('DELETE FROM recipes_fts WHERE rowid = ?').run(id);
      this.db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
    });
  }

  setRecipeTags(id, tags, source) {
    const ins = this.db.prepare('INSERT OR IGNORE INTO recipe_tags (recipe_id, tag, source) VALUES (?, ?, ?)');
    for (const t of tags) if (t) ins.run(id, t, source);
  }

  getRecipe(id) {
    return this.recipesWhere('r.id = ?', [id])[0] || null;
  }

  recipesWhere(where, params = [], tail = '') {
    const rows = this.db
      .prepare(
        `SELECT r.*, b.title AS book_title, b.authors AS book_authors, b.cover_url AS book_cover, b.colour AS book_colour,
           (SELECT group_concat(tag, '|') FROM recipe_tags WHERE recipe_id = r.id) AS rtags,
           (SELECT group_concat(tag, '|') FROM book_tags WHERE book_id = r.book_id) AS btags
         FROM recipes r JOIN books b ON b.id = r.book_id
         ${where ? 'WHERE ' + where : ''} ${tail}`
      )
      .all(...params);
    return rows.map(shapeRecipe);
  }

  allRecipes() {
    return this.recipesWhere('', []);
  }

  reindexRecipe(id) {
    const r = this.db
      .prepare(
        `SELECT r.id, r.name, b.title, b.authors,
           (SELECT group_concat(tag, ' ') FROM recipe_tags WHERE recipe_id = r.id) AS rt,
           (SELECT group_concat(tag, ' ') FROM book_tags WHERE book_id = r.book_id) AS bt
         FROM recipes r JOIN books b ON b.id = r.book_id WHERE r.id = ?`
      )
      .get(id);
    this.db.prepare('DELETE FROM recipes_fts WHERE rowid = ?').run(id);
    if (r) {
      this.db
        .prepare('INSERT INTO recipes_fts (rowid, name, tags, book, authors) VALUES (?, ?, ?, ?, ?)')
        .run(id, r.name, `${r.rt || ''} ${r.bt || ''}`, r.title, r.authors || '');
    }
  }

  reindexBook(bookId) {
    for (const { id } of this.db.prepare('SELECT id FROM recipes WHERE book_id = ?').all(bookId)) this.reindexRecipe(id);
  }

  // ---------- search ----------
  search({ q = '', filters = [], favourites = false, limit = 200 } = {}) {
    let ids = null;
    const text = String(q).trim();
    if (text) {
      const fts = text
        .replace(/["*^():]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => `"${w}"*`)
        .join(' ');
      if (fts) {
        try {
          ids = this.db
            .prepare('SELECT rowid FROM recipes_fts WHERE recipes_fts MATCH ? ORDER BY rank LIMIT 2000')
            .all(fts)
            .map((r) => r.rowid);
        } catch {
          ids = [];
        }
      }
    }
    let rows;
    if (ids) {
      if (!ids.length) return [];
      const order = new Map(ids.map((id, i) => [id, i]));
      rows = this.recipesWhere(`r.id IN (${ids.join(',')})`).sort((a, b) => order.get(a.id) - order.get(b.id));
    } else {
      rows = this.recipesWhere('', [], 'ORDER BY r.favourite DESC, r.rating DESC, r.name COLLATE NOCASE');
    }
    rows = applyFilters(rows, filters);
    if (favourites) rows = rows.filter((r) => r.favourite);
    return rows.slice(0, limit);
  }

  // Everything a theme chip can be made from, with counts.
  facets() {
    const tags = this.db
      .prepare(
        `SELECT MIN(tag) AS tag, COUNT(DISTINCT rid) AS n FROM (
           SELECT recipe_id AS rid, tag FROM recipe_tags
           UNION SELECT r.id AS rid, bt.tag FROM book_tags bt JOIN recipes r ON r.book_id = bt.book_id
         ) GROUP BY lower(tag) ORDER BY n DESC`
      )
      .all();
    const bookTags = this.db.prepare('SELECT DISTINCT tag FROM book_tags ORDER BY tag').all().map((r) => r.tag);
    const authorCounts = new Map();
    for (const b of this.listBooks()) {
      for (const a of splitAuthors(b.authors)) {
        const cur = authorCounts.get(a.toLowerCase()) || { value: a, n: 0, books: 0 };
        cur.n += b.recipe_count;
        cur.books += 1;
        authorCounts.set(a.toLowerCase(), cur);
      }
    }
    const books = this.listBooks().map((b) => ({ id: b.id, title: b.title, n: b.recipe_count, cover_url: b.cover_url, colour: b.colour }));
    return {
      tags: tags.map((t) => ({ value: t.tag, n: t.n, isBookTag: bookTags.some((b) => b.toLowerCase() === t.tag.toLowerCase()) })),
      authors: [...authorCounts.values()].sort((a, b) => b.n - a.n),
      books,
    };
  }

  stats() {
    const one = (sql) => this.db.prepare(sql).get().n;
    return {
      books: one('SELECT COUNT(*) AS n FROM books'),
      recipes: one('SELECT COUNT(*) AS n FROM recipes'),
      favourites: one('SELECT COUNT(*) AS n FROM recipes WHERE favourite = 1'),
      cooked: one('SELECT COALESCE(SUM(times_cooked), 0) AS n FROM recipes'),
      plans: one('SELECT COUNT(*) AS n FROM plans'),
      demo: one('SELECT COUNT(*) AS n FROM books WHERE is_demo = 1'),
    };
  }

  // ---------- plans & themes ----------
  listPlans() {
    return this.db
      .prepare('SELECT id, name, week_start, theme_json, slots_json, created_at, updated_at FROM plans ORDER BY updated_at DESC')
      .all()
      .map(shapePlan);
  }
  getPlan(id) {
    const p = this.db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
    return p ? shapePlan(p) : null;
  }
  savePlan({ name, week_start, theme, slots }, id = null) {
    const args = [String(name || 'My week').slice(0, 120), week_start || null, JSON.stringify(theme || {}), JSON.stringify(slots || [])];
    if (id) {
      this.db
        .prepare("UPDATE plans SET name = ?, week_start = ?, theme_json = ?, slots_json = ?, updated_at = datetime('now') WHERE id = ?")
        .run(...args, id);
      return id;
    }
    return Number(this.db.prepare('INSERT INTO plans (name, week_start, theme_json, slots_json) VALUES (?, ?, ?, ?)').run(...args).lastInsertRowid);
  }
  deletePlan(id) {
    this.db.prepare('DELETE FROM plans WHERE id = ?').run(id);
  }

  listThemes() {
    return this.db.prepare('SELECT * FROM themes ORDER BY name').all().map((t) => ({ ...t, theme: JSON.parse(t.theme_json) }));
  }
  saveTheme({ name, emoji, theme }) {
    return Number(
      this.db.prepare('INSERT INTO themes (name, emoji, theme_json) VALUES (?, ?, ?)').run(String(name).slice(0, 80), emoji || '🍽️', JSON.stringify(theme)).lastInsertRowid
    );
  }
  deleteTheme(id) {
    this.db.prepare('DELETE FROM themes WHERE id = ?').run(id);
  }

  // ---------- backup ----------
  exportAll() {
    const books = this.listBooks().map((b) => {
      const full = this.getBook(b.id);
      return {
        ...b,
        recipes: full.recipes.map((r) => ({
          name: r.name, page: r.page, notes: r.notes, rating: r.rating, favourite: r.favourite,
          times_cooked: r.times_cooked, last_cooked: r.last_cooked, tags: r.recipeTags,
        })),
      };
    });
    return { app: 'recipe-monster', version: 1, exported_at: new Date().toISOString(), books, plans: this.listPlans(), themes: this.listThemes() };
  }

  importAll(data) {
    let books = 0, recipes = 0;
    for (const b of data.books || []) {
      const id = this.saveBook({ ...b, tags: b.tags || [] });
      books++;
      const res = this.addRecipes(id, (b.recipes || []).map((r) => ({ name: r.name, page: r.page, tags: r.tags })));
      recipes += res.added;
      for (const r of b.recipes || []) {
        if (r.rating || r.favourite || r.notes || r.times_cooked) {
          const row = this.db.prepare('SELECT id FROM recipes WHERE book_id = ? AND name = ? AND page = ?').get(id, r.name, String(r.page ?? ''));
          if (row) {
            this.db
              .prepare('UPDATE recipes SET rating = ?, favourite = ?, notes = ?, times_cooked = ?, last_cooked = ? WHERE id = ?')
              .run(r.rating || 0, r.favourite ? 1 : 0, r.notes || '', r.times_cooked || 0, r.last_cooked || null, row.id);
          }
        }
      }
    }
    for (const t of data.themes || []) this.saveTheme(t);
    return { books, recipes };
  }
}

function shapeRecipe(r) {
  const recipeTags = r.rtags ? r.rtags.split('|') : [];
  const bookTags = r.btags ? r.btags.split('|') : [];
  const { rtags, btags, ...rest } = r;
  return { ...rest, recipeTags, bookTags, tags: uniq([...bookTags, ...recipeTags]) };
}

function shapePlan(p) {
  const { theme_json, slots_json, ...rest } = p;
  return { ...rest, theme: JSON.parse(theme_json || '{}'), slots: JSON.parse(slots_json || '[]') };
}

// A chip is {type: 'tag'|'author'|'book'|'text', value, exclude?}.
// Chips of the same type are OR'd together, different types are AND'd. Exclusions knock recipes out.
export function applyFilters(rows, chips = []) {
  if (!chips?.length) return rows;
  const include = chips.filter((c) => !c.exclude);
  const exclude = chips.filter((c) => c.exclude);
  const groups = new Map();
  for (const c of include) {
    if (!groups.has(c.type)) groups.set(c.type, []);
    groups.get(c.type).push(c);
  }
  return rows.filter(
    (r) => [...groups.values()].every((g) => g.some((c) => chipMatches(r, c))) && !exclude.some((c) => chipMatches(r, c))
  );
}

export function chipMatches(r, c) {
  const v = String(c.value ?? '').toLowerCase().trim();
  switch (c.type) {
    case 'tag':
      return r.tags.some((t) => t.toLowerCase() === v);
    case 'author':
      return splitAuthors(r.book_authors).some((a) => a.toLowerCase() === v || a.toLowerCase().includes(v));
    case 'book':
      return String(r.book_id) === String(c.value) || r.book_title.toLowerCase() === v;
    case 'text':
      return v.split(/\s+/).every((w) => `${r.name} ${r.tags.join(' ')} ${r.book_title}`.toLowerCase().includes(w));
    case 'favourite':
      return !!r.favourite;
    default:
      return true;
  }
}
