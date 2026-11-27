// Look up a book by ISBN using Open Library, falling back to Google Books.

export function normaliseIsbn(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^0-9X]/g, '');
  if (s.length === 13 && /^\d{13}$/.test(s)) {
    const sum = [...s.slice(0, 12)].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === Number(s[12]) ? s : null;
  }
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((a, c, i) => a + (c === 'X' ? 10 : Number(c)) * (10 - i), 0);
    return sum % 11 === 0 ? s : null;
  }
  return null;
}

export function googleBooksUrl(isbn, key = process.env.GOOGLE_BOOKS_API_KEY) {
  const base = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`;
  return key ? `${base}&key=${encodeURIComponent(key)}` : base;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'RecipeMonster/1.0 (home cookbook catalogue)' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

export async function lookupIsbn(raw) {
  const isbn = normaliseIsbn(raw);
  if (!isbn) throw new Error("That doesn't look like a valid ISBN");
  const errors = [];
  try {
    const data = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    const b = data[`ISBN:${isbn}`];
    if (b) {
      return {
        source: 'Open Library',
        isbn,
        title: b.title || '',
        subtitle: b.subtitle || '',
        authors: (b.authors || []).map((a) => a.name).join(', '),
        publisher: (b.publishers || []).map((p) => p.name).join(', '),
        year: (String(b.publish_date || '').match(/\d{4}/) || [''])[0],
        cover_url: b.cover?.large || b.cover?.medium || '',
      };
    }
  } catch (e) {
    errors.push(e.message);
  }
  try {
    const data = await getJson(googleBooksUrl(isbn));
    const v = data.items?.[0]?.volumeInfo;
    if (v) {
      return {
        source: 'Google Books',
        isbn,
        title: v.title || '',
        subtitle: v.subtitle || '',
        authors: (v.authors || []).join(', '),
        publisher: v.publisher || '',
        year: (String(v.publishedDate || '').match(/\d{4}/) || [''])[0],
        cover_url: (v.imageLinks?.thumbnail || '').replace(/^http:/, 'https:').replace('&edge=curl', ''),
      };
    }
  } catch (e) {
    errors.push(e.message);
  }
  const err = new Error(errors.length ? `Lookup failed (${errors.join('; ')})` : 'No book found for that ISBN, so fill in the details by hand.');
  err.isbn = isbn;
  throw err;
}
