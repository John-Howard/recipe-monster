// Shared bits: API calls, the monster, toasts, modals, confetti and the theme-chip picker.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Phones on Wi-Fi drop connections more than you'd think (sleeping, switching to the camera, roaming
// between access points). Network-level failures are retried with a short back-off; real errors from
// the server (4xx/5xx) are not.
export async function api(path, { method = 'GET', body, retries = 3 } = {}) {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: payload !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: payload,
        cache: 'no-store',
      });
    } catch (err) {
      if (attempt < retries) {
        await waitForVisible();
        await sleep([600, 1500, 3500, 6000][attempt] ?? 6000);
        continue;
      }
      throw new Error(`Lost the connection to Recipe Monster (${location.host}). Check the computer running it is awake and your phone is on the same Wi-Fi, then try again.`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
    return data;
  }
}

// Don't burn retries while the phone is locked or the browser is in the background.
function waitForVisible() {
  if (document.visibilityState === 'visible') return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', on);
        resolve();
      }
    };
    document.addEventListener('visibilitychange', on);
  });
}

// Start a slow server job (AI reading) and keep checking until it finishes. Each check is a quick
// request, so a connection that drops mid-way just means the next check picks up the result.
export async function runJob(path, body, { onTick, timeoutMs = 5 * 60_000 } = {}) {
  const { job } = await api(path, { method: 'POST', body });
  const start = Date.now();
  let misses = 0;
  while (Date.now() - start < timeoutMs) {
    await sleep(1500);
    await waitForVisible();
    let j;
    try {
      j = await api(`/api/jobs/${job}`, { retries: 1 });
      misses = 0;
    } catch (e) {
      if (e.status) throw e; // the server answered with a real error (e.g. job expired)
      if (++misses >= 10) throw e; // about 30+ seconds without reaching the computer
      continue;
    }
    if (j.status === 'done') return j.result;
    if (j.status === 'error') throw new Error(j.error);
    onTick?.(Math.round((Date.now() - j.started) / 1000));
  }
  throw new Error('Reading took too long. Try again, or use a smaller/closer photo.');
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

const PALETTE = ['#e8603c', '#3fa66b', '#8a5bd6', '#2b9bb3', '#d6a21e', '#d64b7a', '#4e7ad6', '#c46a2b'];
export function bookColour(book) {
  if (book?.colour || book?.book_colour) return book.colour || book.book_colour;
  const s = String(book?.title || book?.book_title || book?.id || '');
  let n = 0;
  for (const c of s) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[n % PALETTE.length];
}

// ---------- the monster ----------
export function monsterSvg({ colour = 'var(--monster)', size = '', mood = 'happy' } = {}) {
  const mouth =
    mood === 'sad'
      ? '<path d="M44 84 q16 -10 32 0" fill="none" stroke="#2b2118" stroke-width="4" stroke-linecap="round"/>'
      : `<g class="jaw"><path d="M36 76 q24 26 48 0 z" fill="#7a2a1a" stroke="#2b2118" stroke-width="3.5" stroke-linejoin="round"/>
         <path d="M44 77 l4 7 l4 -7 M68 77 l4 7 l4 -7" fill="#fff" stroke="#2b2118" stroke-width="1.6" stroke-linejoin="round"/>
         <ellipse cx="60" cy="88" rx="9" ry="4" fill="#ff8a8a"/></g>`;
  return `<svg class="monster" viewBox="0 0 120 120" ${size ? `width="${size}" height="${size}"` : ''} aria-hidden="true">
    <g class="body">
      <path d="M30 34 l-8 -18 l18 10 M90 34 l8 -18 l-18 10" fill="${colour}" stroke="#2b2118" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M60 18 C 95 18 106 46 104 72 C 102 100 84 110 60 110 C 36 110 18 100 16 72 C 14 46 25 18 60 18 Z" fill="${colour}" stroke="#2b2118" stroke-width="4"/>
      <circle cx="30" cy="62" r="5" fill="#000" opacity=".08"/><circle cx="92" cy="52" r="7" fill="#000" opacity=".08"/><circle cx="84" cy="94" r="4" fill="#000" opacity=".08"/>
      <ellipse cx="34" cy="80" rx="7" ry="4" fill="#ff8a8a" opacity=".6"/><ellipse cx="86" cy="80" rx="7" ry="4" fill="#ff8a8a" opacity=".6"/>
      <g><circle cx="60" cy="50" r="20" fill="#fff" stroke="#2b2118" stroke-width="3.5"/>
        <circle cx="63" cy="53" r="9" fill="#2b2118"/><circle cx="66" cy="49" r="3.2" fill="#fff"/>
        <rect class="eyelid" x="38" y="29" width="44" height="42" rx="21" fill="${colour}" stroke="#2b2118" stroke-width="3.5"/></g>
      ${mouth}
      <path d="M14 70 q-10 6 -6 16 M106 70 q10 6 6 16" fill="none" stroke="#2b2118" stroke-width="4" stroke-linecap="round"/>
    </g>
  </svg>`;
}

export function chomp(el) {
  const m = el?.classList?.contains('monster') ? el : el?.querySelector?.('.monster');
  if (!m) return;
  m.classList.remove('chomp');
  void m.getBoundingClientRect();
  m.classList.add('chomp');
  setTimeout(() => m.classList.remove('chomp'), 1100);
}

export const QUIPS = {
  hello: [
    'What are we eating this week? I\'m <em>starving</em>.',
    'Feed me a theme and I\'ll cook up a week!',
    'Rumble rumble… was that me or the oven?',
    'I\'ve read every index in the house. Ask me anything.',
    'Pick a theme, any theme. I promise not to eat the books.',
  ],
  generated: ['Ta-da! A week of dinners, freshly plucked from your shelves.', 'Nom nom. That\'s a tasty-looking week.', 'Locked and loaded! Lock the ones you love, spin the rest.', 'Chef\'s kiss. Well, monster\'s kiss.'],
  empty: ['My tummy is empty! Scan some cookbook indexes to feed me.', 'No recipes yet… I\'m wasting away here!'],
  fed: ['NOM! Delicious index pages.', 'More recipes! *happy monster noises*', 'Mmm, crunchy page numbers.'],
};
export const quip = (k) => QUIPS[k][Math.floor(Math.random() * QUIPS[k].length)];

// ---------- toasts ----------
export function toast(msg, { error = false, monster = true, ms = 3800 } = {}) {
  let wrap = $('.toasts');
  if (!wrap) document.body.append((wrap = h('<div class="toasts" role="status" aria-live="polite"></div>')));
  const el = h(`<div class="toast ${error ? 'err' : ''}">${monster ? monsterSvg({ mood: error ? 'sad' : 'happy' }) : ''}<div>${msg}</div></div>`);
  wrap.append(el);
  if (!error) chomp(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(30px)';
    setTimeout(() => el.remove(), 300);
  }, ms);
}

// ---------- modal ----------
export function modal(title, bodyEl, { wide = false, onClose } = {}) {
  const back = h(`<div class="modal-back"><div class="modal card ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></header></div></div>`);
  const box = back.firstElementChild;
  box.append(bodyEl);
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  back.addEventListener('mousedown', (e) => e.target === back && close());
  box.querySelector('[data-close]').onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  setTimeout(() => box.querySelector('input,button:not([data-close])')?.focus(), 50);
  return { close, el: box };
}

export function confirmBox(message, { ok = 'Yes', cancel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const body = h(`<div><p>${message}</p><div class="row" style="justify-content:flex-end">
      <button class="btn ghost" data-no>${cancel}</button><button class="btn ${danger ? 'primary' : 'go'}" data-yes>${ok}</button></div></div>`);
    let done = false;
    const m = modal('Are you sure?', body, { onClose: () => !done && resolve(false) });
    body.querySelector('[data-no]').onclick = () => m.close();
    body.querySelector('[data-yes]').onclick = () => {
      done = true;
      m.close();
      resolve(true);
    };
  });
}

// ---------- confetti ----------
export function confetti(n = 120) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  const dpr = devicePixelRatio || 1;
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  document.body.append(c);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const bits = ['🍅', '🥕', '🧀', '🍋', '🌶️', '🥦', '🍄', '🧄'];
  const parts = Array.from({ length: n }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 200,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 16,
    vy: -Math.random() * 14 - 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    emoji: Math.random() < 0.25 ? bits[Math.floor(Math.random() * bits.length)] : null,
    col: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    s: 6 + Math.random() * 6,
  }));
  let frame = 0;
  const tick = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.38;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      if (p.emoji) {
        ctx.font = '22px serif';
        ctx.fillText(p.emoji, -11, 8);
      } else {
        ctx.fillStyle = p.col;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      }
      ctx.restore();
    }
    if (++frame < 160) requestAnimationFrame(tick);
    else c.remove();
  };
  requestAnimationFrame(tick);
}

// ---------- image helpers (used by the scanner) ----------
// rotate: clockwise degrees (0, 90, 180, 270) applied on top of the photo's own EXIF orientation.
export async function fileToDataUrl(file, { maxSide = 2000, quality = 0.85, grey = false, rotate = 0 } = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = bitmap.width, hgt = bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(w, hgt));
  const dw = Math.round(w * scale), dh = Math.round(hgt * scale);
  const turn = ((Number(rotate) % 360) + 360) % 360;
  const sideways = turn === 90 || turn === 270;
  const c = document.createElement('canvas');
  c.width = sideways ? dh : dw;
  c.height = sideways ? dw : dh;
  const ctx = c.getContext('2d');
  if (grey) ctx.filter = 'grayscale(1) contrast(1.25)';
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((turn * Math.PI) / 180);
  ctx.drawImage(bitmap, -dw / 2, -dh / 2, dw, dh);
  return c.toDataURL('image/jpeg', quality);
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.append(s);
  });
}

// ---------- the theme chip picker ----------
// chips: [{type:'tag'|'author'|'book'|'text'|'favourite', value, label?, exclude?}]
const KIND = { tag: 'tag', author: 'author', book: 'book', text: 'words', favourite: '' };
export function chipLabel(c) {
  if (c.type === 'favourite') return '❤️ Favourites';
  return esc(c.label || c.value);
}

export function chipInput({ facets, chips = [], placeholder = 'Add a diet, author, book, ingredient…', onChange }) {
  const el = h(`<div class="chip-input"><div class="box"></div><div class="suggest hidden" role="listbox"></div></div>`);
  const box = el.querySelector('.box');
  const sug = el.querySelector('.suggest');
  const input = h(`<input type="text" placeholder="${esc(placeholder)}" aria-label="Add a theme filter" autocomplete="off">`);
  let hl = 0;
  let options = [];

  const render = () => {
    box.innerHTML = '';
    chips.forEach((c, i) => {
      const chip = h(`<span class="chip ${c.type} ${c.exclude ? 'exclude' : ''}" title="Click to switch between 'include' and 'leave out'">
        ${KIND[c.type] ? `<span class="kind">${c.exclude ? 'not ' : ''}${KIND[c.type]}</span>` : ''}${chipLabel(c)}
        <button aria-label="Remove">✕</button></span>`);
      chip.onclick = (e) => {
        if (e.target.closest('button')) {
          chips.splice(i, 1);
        } else {
          c.exclude = !c.exclude;
        }
        render();
        onChange?.(chips);
      };
      box.append(chip);
    });
    box.append(input);
  };

  const add = (c) => {
    if (!chips.some((x) => x.type === c.type && String(x.value).toLowerCase() === String(c.value).toLowerCase())) chips.push(c);
    input.value = '';
    sug.classList.add('hidden');
    render();
    onChange?.(chips);
    input.focus();
  };

  const showSuggest = () => {
    const f = facets();
    const q = input.value.trim().toLowerCase();
    const match = (s) => !q || String(s).toLowerCase().includes(q);
    const groups = [
      ['Diets & tags', f.tags.filter((t) => match(t.value)).slice(0, q ? 8 : 10).map((t) => ({ type: 'tag', value: t.value, n: t.n, star: t.isBookTag }))],
      ['Authors', f.authors.filter((a) => match(a.value)).slice(0, 6).map((a) => ({ type: 'author', value: a.value, n: a.n }))],
      ['Books', f.books.filter((b) => match(b.title)).slice(0, 6).map((b) => ({ type: 'book', value: String(b.id), label: b.title, n: b.n }))],
    ];
    options = [];
    sug.innerHTML = '';
    if (q) {
      const o = { type: 'text', value: input.value.trim() };
      options.push(o);
      sug.append(h(`<div class="opt" data-i="0"><span>🔎 Recipes mentioning “<b>${esc(o.value)}</b>”</span></div>`));
    }
    if (!q && !chips.some((c) => c.type === 'favourite')) {
      options.push({ type: 'favourite', value: 'yes' });
      sug.append(h(`<div class="opt" data-i="${options.length - 1}"><span>❤️ Only my favourites</span></div>`));
    }
    for (const [name, opts] of groups) {
      if (!opts.length) continue;
      sug.append(h(`<div class="grp">${name}</div>`));
      for (const o of opts) {
        options.push(o);
        sug.append(h(`<div class="opt" data-i="${options.length - 1}"><span>${o.star ? '⭐ ' : ''}${esc(o.label || o.value)}</span><span class="muted small">${o.n}</span></div>`));
      }
    }
    hl = 0;
    highlight();
    sug.classList.toggle('hidden', !options.length);
  };
  const highlight = () => $$('.opt', sug).forEach((o) => o.classList.toggle('hl', Number(o.dataset.i) === hl));

  sug.addEventListener('mousedown', (e) => {
    const o = e.target.closest('.opt');
    if (o) {
      e.preventDefault();
      add(options[Number(o.dataset.i)]);
    }
  });
  input.addEventListener('focus', showSuggest);
  input.addEventListener('input', showSuggest);
  input.addEventListener('blur', () => setTimeout(() => sug.classList.add('hidden'), 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { hl = Math.min(options.length - 1, hl + 1); highlight(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hl = Math.max(0, hl - 1); highlight(); e.preventDefault(); }
    else if (e.key === 'Enter' && options[hl]) { add(options[hl]); e.preventDefault(); }
    else if (e.key === 'Backspace' && !input.value && chips.length) { chips.pop(); render(); onChange?.(chips); }
  });
  box.addEventListener('click', (e) => e.target === box && input.focus());
  render();
  return {
    el,
    set(next) {
      chips = next;
      render();
    },
    get: () => chips,
  };
}

export const MEAL_EMOJI = { breakfast: '🍳', lunch: '🥪', starter: '🥗', dinner: '🍲', dessert: '🍰' };
export const DIET_TAGS = new Set(['vegetarian', 'vegan', 'gluten-free', 'dairy-free']);

export function tagPills(r, max = 3, showCourse = true) {
  const shown = [...new Map([...r.bookTags.slice(0, 1), ...r.recipeTags].map((t) => [t.toLowerCase(), t])).values()].slice(0, max);
  const course = showCourse && r.course ? `<span class="pill">${esc(r.course)}</span> ` : '';
  return course + shown.map((t) => `<span class="pill ${DIET_TAGS.has(t.toLowerCase()) ? 'diet' : ''}">${esc(t)}</span>`).join(' ');
}

export function initThemeToggle(btn) {
  const apply = (t) => {
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    btn.textContent = (t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark' ? '🌙' : '☀️';
  };
  let t = null;
  try { t = localStorage.getItem('rm-theme'); } catch {}
  apply(t);
  btn.onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('rm-theme', next); } catch {}
    apply(next);
  };
}
