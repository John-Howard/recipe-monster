// Turn the OCR text of a cookbook index page into a list of {name, page, tags}.
//
// Cookbook indexes come in a few shapes, often mixed on the same page:
//   Beef stew with dumplings 112            <- plain entry
//   Chicken, 34, 56, 78                     <- ingredient heading with many pages (not a recipe)
//   chicken                                 <- heading on its own line...
//     – and leek pie 45                     <- ...with sub-entries that continue it
//     roast chicken with lemon 46           <- ...or stand on their own
//   Spiced lamb with apricots and           <- an entry wrapped onto two lines
//     couscous 98
//   Mushroom risotto (V) 23                 <- dietary markers
// This is heuristic: the scan screen always lets you review and fix the results before saving.

const CONNECTIVES = /^(and|with|in|on|&|or|of|for|au|à|a la|à la|alla|al|stuffed|baked|roast|roasted|braised|fried|grilled|glazed|-)\b/i;
const DIET_MARKERS = [
  [/\(\s*v\s*\)|\bV\b(?=\s*$)|\[v\]/i, 'vegetarian'],
  [/\(\s*vg\s*\)|\(\s*ve\s*\)|\bVG\b/i, 'vegan'],
  [/\(\s*gf\s*\)|\bGF\b/, 'gluten-free'],
  [/\(\s*df\s*\)|\bDF\b/, 'dairy-free'],
];
const SKIP = /^(index|contents|see also|see\b|continued|cont\.?|acknowledg|about the author|conversion|cup measurements)/i;

function fixOcrDigits(s) {
  // "l2" -> "12", "O8" -> "08", "1O4" -> "104", "S6" -> "56"  (only inside number-ish tokens)
  return s.replace(/\b[\dlIOoSB|]{1,4}\b/g, (tok) => {
    if (!/\d/.test(tok)) return tok;
    return tok.replace(/[lI|]/g, '1').replace(/[Oo]/g, '0').replace(/S/g, '5').replace(/B/g, '8');
  });
}

function cleanName(s) {
  let n = s
    .replace(/[.·•…_]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—~•*·,:;]+/, '')
    .replace(/[\s,.:;\-–—]+$/, '')
    .trim();
  if (n.length > 3 && n === n.toUpperCase()) n = n.toLowerCase();
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function extractMarkers(s) {
  const tags = [];
  let out = s;
  for (const [re, tag] of DIET_MARKERS) {
    if (re.test(out)) {
      tags.push(tag);
      out = out.replace(re, ' ');
    }
  }
  return { text: out.replace(/\(\s*\)/g, ' '), tags };
}

const PAGES_AT_END = /^(.*?)[\s,.…·:;\-–—]*((?:\d{1,4}(?:\s*[-–—]\s*\d{1,4})?[\s,;]*)+)$/;

export function parseIndexText(text) {
  const rawLines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\t/g, ' '))
    .filter((l) => l.trim());

  // Annotate each line: indentation, leading dash, trailing page numbers.
  const lines = rawLines.map((raw) => {
    const indent = raw.match(/^\s*/)[0].length;
    let s = fixOcrDigits(raw.trim());
    const { text: noMarks, tags } = extractMarkers(s);
    s = noMarks.trim();
    const dash = /^[-–—~•*]\s*/.test(s);
    const m = s.match(PAGES_AT_END);
    let name = s, pages = [];
    if (m && m[1].trim()) {
      name = m[1];
      pages = m[2].split(/[\s,;]+/).filter(Boolean).map((p) => p.split(/[-–—]/)[0]).filter((p) => /^\d+$/.test(p));
    }
    return { raw, indent, dash, name: name.trim(), pages, tags };
  });

  const out = [];
  let heading = null;
  let headingIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    let name = L.name;
    if (!name || SKIP.test(name)) continue;
    if (/^[A-Z]$/i.test(name) && !L.pages.length) continue; // section letter
    if (/^\d+$/.test(name)) continue; // stray page number / folio

    if (!L.pages.length) {
      // Either a heading, or a wrapped line whose page number is on the next line.
      const next = lines[i + 1];
      const looksWrapped =
        next && next.pages.length && !next.dash && (/^[a-z(&]/.test(next.name) || CONNECTIVES.test(next.name)) && name.split(' ').length >= 2;
      if (looksWrapped && !/[:]$/.test(name)) {
        next.name = `${name.replace(/[,\s]+$/, '')} ${next.name}`;
        next.tags = [...L.tags, ...next.tags];
        next.dash = L.dash;
        next.indent = L.indent;
        continue;
      }
      heading = cleanName(name.replace(/[:,]$/, ''));
      headingIndent = L.indent;
      continue;
    }

    // Ingredient-style heading with a list of page refs, e.g. "Chicken 12, 34, 56".
    const words = name.split(/\s+/).length;
    if (L.pages.length >= 3 && words <= 3 && !L.dash) {
      heading = cleanName(name.replace(/[:,]$/, ''));
      headingIndent = L.indent;
      continue;
    }

    const isSub = heading && (L.dash || (L.indent > headingIndent + 1) || /^[a-z]/.test(name) || CONNECTIVES.test(name));
    if (isSub) {
      const stripped = name.replace(/^[-–—~•*]\s*/, '');
      const headWord = heading.toLowerCase().split(/\s+/)[0].replace(/s$/, '');
      if (stripped.toLowerCase().includes(headWord)) {
        name = stripped; // "roast chicken with lemon" under "Chicken" already names itself
      } else if (L.dash || CONNECTIVES.test(stripped) || /^,/.test(stripped) || stripped.split(/\s+/).length <= 2) {
        name = `${heading} ${stripped.replace(/^,\s*/, '')}`;
      } else {
        name = stripped;
      }
    } else if (!/^[a-z]/.test(name)) {
      heading = null; // a new top-level entry ends the previous group
    }

    name = cleanName(name);
    if (name.length < 3 || /^\d/.test(name)) continue;
    out.push({ name, page: L.pages[0], tags: L.tags });
  }

  // De-duplicate (indexes often list a recipe under several headings).
  const seen = new Map();
  for (const e of out) {
    const key = `${e.name.toLowerCase().replace(/[^a-z0-9]/g, '')}|${e.page}`;
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.values()];
}
