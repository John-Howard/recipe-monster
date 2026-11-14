import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const HOSTS = ['covers.openlibrary.org', 'books.google.com', 'books.googleusercontent.com'];
const HOST_SUFFIXES = ['.archive.org', '.googleusercontent.com'];
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_REDIRECTS = 3;
const MIN_BYTES = 1024;
const MAX_BYTES = 5 * 1024 * 1024;
const HEADERS = { 'User-Agent': 'RecipeMonster/1.0 (home cookbook catalogue)' };

export const isLocalCover = (url) => String(url || '').startsWith('/covers/');

export function isAllowedHost(host) {
  return HOSTS.includes(host) || host === 'archive.org' || HOST_SUFFIXES.some((s) => host.endsWith(s));
}

function secureUrl(raw) {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol) || !isAllowedHost(u.hostname)) return null;
    u.protocol = 'https:';
    return u;
  } catch {
    return null;
  }
}

async function fetchFollowing(target, fetch) {
  const signal = AbortSignal.timeout(8000);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(target.href, { headers: HEADERS, signal, redirect: 'manual' });
    if (!(res.status >= 300 && res.status < 400)) return res;
    const next = secureUrl(new URL(res.headers.get('location') || '', target).href);
    if (!next) return null;
    target = next;
  }
  return null;
}

export async function downloadCover(url, dir, { fetch = globalThis.fetch } = {}) {
  const target = secureUrl(url);
  if (!target) return null;
  try {
    const res = await fetchFollowing(target, fetch);
    if (!res?.ok) return null;
    const ext = EXTENSIONS[(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()];
    if (!ext) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_BYTES || buf.length > MAX_BYTES) return null;
    const name = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(dir, name), buf);
    return `/covers/${name}`;
  } catch {
    return null;
  }
}

async function searchCoverUrl(book, fetch) {
  const params = new URLSearchParams({ title: book.title, limit: '1', fields: 'cover_i' });
  const author = String(book.authors || '').split(',')[0].trim();
  if (author) params.set('author', author);
  try {
    const res = await fetch(`https://openlibrary.org/search.json?${params}`, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const id = (await res.json()).docs?.[0]?.cover_i;
    return id ? `https://covers.openlibrary.org/b/id/${id}-L.jpg` : null;
  } catch {
    return null;
  }
}

export async function findCover(book, dir, { fetch = globalThis.fetch } = {}) {
  const candidates = [];
  if (book.cover_url && !isLocalCover(book.cover_url)) candidates.push(() => book.cover_url);
  if (book.isbn) candidates.push(() => `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg?default=false`);
  if (book.title) candidates.push(() => searchCoverUrl(book, fetch));
  for (const next of candidates) {
    const url = await next();
    const local = url && (await downloadCover(url, dir, { fetch }));
    if (local) return local;
  }
  return null;
}
