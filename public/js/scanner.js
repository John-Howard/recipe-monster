// The scan flow: pick/create a book (barcode, cover photo or typing), photograph index pages,
// review what was read, save. Works on a phone (camera) or a computer (file upload).
import { api, h, esc, $, $$, toast, chomp, confetti, monsterSvg, quip, fileToDataUrl, loadScript, bookColour } from './ui.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const ZXING = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
const COMMON_TAGS = ['Slimming World', 'Fast 800', '5:2 diet', 'Low calorie', 'Vegetarian', 'Vegan', 'Quick', 'Batch cooking', 'Slow cooker', 'Air fryer', 'Family favourites', 'Baking', 'Entertaining', 'Healthy'];

export function mountScanner(root, { bookId = null, compact = false } = {}) {
  const state = { step: 1, book: null, info: null, pages: [], entries: [], mode: 'ai', books: [] };
  root.innerHTML = '';
  const wrap = h(`<div class="scan-wrap">
    <div class="steps"><div class="st" data-s="1">1 · Book</div><div class="st" data-s="2">2 · Index pages</div><div class="st" data-s="3">3 · Check & save</div></div>
    <div class="card stage"></div></div>`);
  root.append(wrap);
  const stage = $('.stage', wrap);

  const setStep = (n) => {
    state.step = n;
    $$('.st', wrap).forEach((s) => {
      const k = Number(s.dataset.s);
      s.classList.toggle('on', k === n);
      s.classList.toggle('done', k < n);
    });
    stage.innerHTML = '';
    ({ 1: stepBook, 2: stepPages, 3: stepReview, 4: stepDone })[n]();
    if (!compact) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---------------- step 1: which book? ----------------
  async function stepBook() {
    stage.append(h(`<div><h2>Which cookbook are we feeding me?</h2><p class="muted">Scan the barcode on the back, snap the cover, or pick one you've already added.</p></div>`));
    const choices = h(`<div class="bigchoices">
      <label class="bigchoice"><span class="e">🏷️</span>Scan barcode<small>Photo of the ISBN barcode</small><input type="file" accept="image/*" capture="environment" data-barcode></label>
      ${state.info?.aiEnabled ? `<label class="bigchoice"><span class="e">📸</span>Photo of cover<small>AI reads title & author</small><input type="file" accept="image/*" capture="environment" data-cover></label>` : ''}
      <button class="bigchoice" data-manual><span class="e">✍️</span>Type it in<small>Or enter an ISBN</small></button>
    </div>`);
    stage.append(choices);
    const status = h('<p class="muted small" aria-live="polite"></p>');
    stage.append(status);

    $('[data-barcode]', choices).onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      status.textContent = '🔍 Looking for a barcode…';
      try {
        const isbn = await readBarcode(file);
        if (!isbn) throw new Error("Couldn't spot a barcode. Try again closer up, or type the ISBN.");
        status.textContent = `📚 Found ISBN ${isbn}, looking it up…`;
        let meta = { isbn };
        try {
          meta = await api(`/api/isbn/${isbn}`);
        } catch (err) {
          toast(`${esc(err.message)}<br><small>Fill in the rest by hand.</small>`, { error: true });
        }
        bookForm(meta);
      } catch (err) {
        status.textContent = '';
        toast(esc(err.message), { error: true });
      }
    };
    const coverInput = $('[data-cover]', choices);
    if (coverInput)
      coverInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        status.textContent = '🤖 Reading the cover…';
        try {
          const image = await fileToDataUrl(file, { maxSide: 1400 });
          const [meta, cover] = await Promise.all([api('/api/scan/book', { method: 'POST', body: { image } }), api('/api/covers', { method: 'POST', body: { image } })]);
          bookForm({ ...meta, authors: (meta.authors || []).join(', '), cover_url: cover.url, tags: meta.suggested_tags });
        } catch (err) {
          status.textContent = '';
          toast(esc(err.message), { error: true });
        }
      };
    $('[data-manual]', choices).onclick = () => bookForm({});

    try {
      state.books = await api('/api/books');
    } catch {
      state.books = [];
    }
    if (state.books.length) {
      stage.append(h('<h3 style="margin-top:1.4rem">…or add pages to a book you already have</h3>'));
      const filter = h('<input type="search" placeholder="Find a book…" aria-label="Find a book" style="margin-bottom:.5rem">');
      const list = h('<div class="booklist"></div>');
      const draw = () => {
        const q = filter.value.toLowerCase();
        list.innerHTML = '';
        for (const b of state.books.filter((b) => !q || `${b.title} ${b.authors}`.toLowerCase().includes(q))) {
          const row = h(`<div class="bookrow" tabindex="0"><span class="sw" style="--book:${bookColour(b)};${b.cover_url ? `background-image:url('${esc(b.cover_url)}')` : ''}"></span>
            <div><b>${esc(b.title)}</b><div class="small muted">${esc(b.authors || '')} · ${b.recipe_count} recipes</div></div></div>`);
          row.onclick = row.onkeydown = (e) => {
            if (e.type === 'keydown' && e.key !== 'Enter') return;
            state.book = b;
            setStep(2);
          };
          list.append(row);
        }
      };
      filter.oninput = draw;
      draw();
      stage.append(filter, list);
    }
  }

  async function bookForm(meta) {
    stage.innerHTML = '';
    const existing = state.books.find((b) => meta.isbn && b.isbn === meta.isbn);
    if (existing) {
      toast(`You already have <b>${esc(existing.title)}</b>. Let's add more pages to it.`);
      state.book = existing;
      return setStep(2);
    }
    const tags = new Set(meta.tags || []);
    let allTags = COMMON_TAGS;
    try {
      const f = await api('/api/facets');
      allTags = [...new Set([...COMMON_TAGS, ...f.tags.filter((t) => t.isBookTag).map((t) => t.value)])];
    } catch {}
    for (const t of tags) if (!allTags.includes(t)) allTags.push(t);
    const form = h(`<form class="stack">
      <h2>${meta.title ? 'Is this the one?' : 'Tell me about the book'}</h2>
      <div class="row" style="align-items:flex-start;gap:1rem">
        <div style="width:110px;flex:none">
          <div class="cover" style="--book:${bookColour(meta)}">${meta.cover_url ? `<img src="${esc(meta.cover_url)}" alt="">` : '<div class="t">📖</div>'}</div>
          <label class="btn sm ghost" style="margin-top:.4rem;width:100%;position:relative;overflow:hidden">📷 Cover<input type="file" accept="image/*" capture="environment" data-coverphoto style="position:absolute;inset:0;opacity:0"></label>
        </div>
        <div class="stack" style="flex:1;min-width:200px">
          <label class="field"><span>Title *</span><input name="title" required value="${esc(meta.title || '')}"></label>
          <label class="field"><span>Author(s)</span><input name="authors" value="${esc(meta.authors || '')}" placeholder="e.g. Jane Smith, Joe Bloggs"></label>
        </div>
      </div>
      <div class="row" style="align-items:flex-start">
        <label class="field" style="flex:2;min-width:160px"><span>Subtitle</span><input name="subtitle" value="${esc(meta.subtitle || '')}"></label>
        <label class="field" style="flex:1;min-width:120px"><span>ISBN</span><input name="isbn" value="${esc(meta.isbn || '')}" inputmode="numeric"></label>
      </div>
      <div class="row" style="align-items:flex-start">
        <label class="field" style="flex:2;min-width:160px"><span>Publisher</span><input name="publisher" value="${esc(meta.publisher || '')}"></label>
        <label class="field" style="flex:1;min-width:90px"><span>Year</span><input name="year" value="${esc(meta.year || '')}" inputmode="numeric"></label>
      </div>
      <div><b>Diet / theme tags</b> <span class="muted small">(every recipe in the book gets these)</span>
        <div class="tagpick" style="margin-top:.4rem"></div>
        <div class="row" style="margin-top:.4rem"><input data-newtag placeholder="Add your own tag…" style="flex:1"><button type="button" class="btn sm" data-addtag>Add</button></div>
      </div>
      <div class="row"><button type="button" class="btn ghost" data-back>← Back</button>
        <button type="button" class="btn ghost" data-lookup>🔎 Lookup ISBN</button>
        <span class="spacer"></span><button class="btn go big">Save book →</button></div>
    </form>`);
    let coverUrl = meta.cover_url || '';
    const drawTags = () => {
      const tp = $('.tagpick', form);
      tp.innerHTML = '';
      for (const t of allTags) {
        const c = h(`<span class="chip ${tags.has(t) ? 'on' : ''}" role="checkbox" aria-checked="${tags.has(t)}" tabindex="0">${esc(t)}</span>`);
        c.onclick = () => {
          tags.has(t) ? tags.delete(t) : tags.add(t);
          drawTags();
        };
        tp.append(c);
      }
    };
    drawTags();
    $('[data-addtag]', form).onclick = () => {
      const v = $('[data-newtag]', form).value.trim();
      if (v) {
        if (!allTags.includes(v)) allTags.push(v);
        tags.add(v);
        $('[data-newtag]', form).value = '';
        drawTags();
      }
    };
    $('[data-back]', form).onclick = () => setStep(1);
    $('[data-lookup]', form).onclick = async () => {
      const isbn = form.isbn.value.trim();
      if (!isbn) return toast('Type an ISBN first', { error: true });
      try {
        const m = await api(`/api/isbn/${encodeURIComponent(isbn)}`);
        bookForm({ ...m, tags: [...tags] });
      } catch (e) {
        toast(esc(e.message), { error: true });
      }
    };
    $('[data-coverphoto]', form).onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const image = await fileToDataUrl(f, { maxSide: 900 });
        coverUrl = (await api('/api/covers', { method: 'POST', body: { image } })).url;
        $('.cover', form).innerHTML = `<img src="${coverUrl}" alt="">`;
      } catch (err) {
        toast(esc(err.message), { error: true });
      }
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      try {
        state.book = await api('/api/books', { method: 'POST', body: { ...fd, cover_url: coverUrl, tags: [...tags] } });
        toast(`📚 <b>${esc(state.book.title)}</b> is on the shelf!`);
        setStep(2);
      } catch (err) {
        toast(esc(err.message), { error: true });
      }
    };
    stage.append(form);
  }

  // ---------------- step 2: index pages ----------------
  function stepPages() {
    const b = state.book;
    const ai = !!state.info?.aiEnabled;
    if (!ai) state.mode = 'ocr';
    const el = h(`<div class="stack">
      <div class="row"><span class="sw" style="width:28px;height:38px;border:2px solid var(--line);border-radius:3px 6px 6px 3px;background:${bookColour(b)}"></span>
        <div><h2 style="margin:0">${esc(b.title)}</h2><div class="muted small">${esc(b.authors || '')}</div></div></div>
      <p>Photograph each page of the index. Lay the book flat, fill the frame with the page, and avoid shadows. One page per photo works best.</p>
      <div class="bigchoices">
        <label class="bigchoice"><span class="e">📸</span>Take photo<small>Uses your camera</small><input type="file" accept="image/*" capture="environment" data-take></label>
        <label class="bigchoice"><span class="e">🖼️</span>Choose photos<small>Pick several at once</small><input type="file" accept="image/*" multiple data-pick></label>
        <button class="bigchoice" data-paste><span class="e">📋</span>Paste text<small>Already have it typed?</small></button>
      </div>
      <div class="row small">
        <span class="muted">Reading with:</span>
        <div class="seg" role="radiogroup">
          <button data-mode="ai" class="${state.mode === 'ai' ? 'on' : ''}" ${ai ? '' : 'disabled title="Set ANTHROPIC_API_KEY on the server to enable"'}>🤖 AI (best)</button>
          <button data-mode="ocr" class="${state.mode === 'ocr' ? 'on' : ''}">📱 On-device OCR</button>
        </div>
      </div>
      <div class="pages"></div>
      <div class="row"><button class="btn ghost" data-back>← Change book</button><span class="spacer"></span>
        <span class="muted small" data-count></span><button class="btn go big" data-next disabled>Check recipes →</button></div>
    </div>`);
    stage.append(el);
    const pagesEl = $('.pages', el);
    const next = $('[data-next]', el);
    const count = $('[data-count]', el);
    const refresh = () => {
      const n = state.pages.reduce((a, p) => a + (p.entries?.length || 0), 0);
      const busy = state.pages.some((p) => p.busy);
      next.disabled = !n || busy;
      count.textContent = n ? `${n} recipes found so far${busy ? '…' : ''}` : busy ? 'Reading…' : '';
    };
    const drawPage = (p) => {
      if (!p.el) {
        p.el = h(`<div class="pagethumb"><img alt="Index page"><div class="status"></div><div class="bar"></div></div>`);
        pagesEl.append(p.el);
      }
      $('img', p.el).src = p.thumb || '';
      p.el.classList.toggle('busy', !!p.busy);
      $('.status', p.el).innerHTML = p.error ? `⚠️ <button class="btn sm" style="padding:0 .4rem">Retry</button>` : p.busy ? esc(p.label || 'Reading…') : `✅ ${p.entries.length} recipes`;
      $('.bar', p.el).style.width = p.busy ? `${Math.round((p.progress || 0.05) * 100)}%` : '0';
      const retry = $('.status button', p.el);
      if (retry) retry.onclick = () => processPage(p);
      if (p.error) p.el.title = p.error;
      refresh();
    };

    const processPage = async (p) => {
      p.busy = true;
      p.error = null;
      p.progress = 0.05;
      p.label = 'Reading…';
      drawPage(p);
      try {
        if (state.mode === 'ai') {
          p.label = '🤖 Reading…';
          drawPage(p);
          const image = await fileToDataUrl(p.file, { maxSide: 2000 });
          const r = await api('/api/scan/index', { method: 'POST', body: { image } });
          p.entries = r.entries;
        } else {
          p.label = 'Loading OCR…';
          drawPage(p);
          await loadScript(TESSERACT);
          const image = await fileToDataUrl(p.file, { maxSide: 2400, grey: true, quality: 0.92 });
          const res = await window.Tesseract.recognize(image, 'eng', {
            logger: (m) => {
              if (m.status === 'recognizing text') {
                p.progress = m.progress;
                p.label = `Reading ${Math.round(m.progress * 100)}%`;
                drawPage(p);
              }
            },
          });
          p.text = res.data.text;
          p.entries = (await api('/api/scan/parse', { method: 'POST', body: { text: p.text } })).entries;
        }
        p.busy = false;
        drawPage(p);
        if (!p.entries.length) toast("Hmm, I couldn't find any recipes on that page. Try a sharper, closer photo.", { error: true });
      } catch (err) {
        p.busy = false;
        p.error = err.message;
        drawPage(p);
        toast(esc(err.message), { error: true });
      }
    };

    // Process one page at a time so a phone doesn't run out of memory.
    let queue = Promise.resolve();
    const addFiles = async (files) => {
      for (const file of files) {
        const p = { file, entries: [], busy: true, label: 'Waiting…' };
        state.pages.push(p);
        p.thumb = await fileToDataUrl(file, { maxSide: 400, quality: 0.7 });
        drawPage(p);
        queue = queue.then(() => processPage(p));
      }
    };
    $('[data-take]', el).onchange = (e) => {
      addFiles([...e.target.files]);
      e.target.value = '';
    };
    $('[data-pick]', el).onchange = (e) => {
      addFiles([...e.target.files]);
      e.target.value = '';
    };
    $('[data-paste]', el).onclick = () => {
      const box = h(`<div class="stack"><textarea rows="8" placeholder="Paste the index text here: one recipe per line, page numbers at the end."></textarea>
        <button class="btn go">Read it</button></div>`);
      el.insertBefore(box, pagesEl);
      $('button', box).onclick = async () => {
        const text = $('textarea', box).value;
        const r = await api('/api/scan/parse', { method: 'POST', body: { text } });
        const p = { entries: r.entries, thumb: '', busy: false };
        state.pages.push(p);
        drawPage(p);
        $('img', p.el).replaceWith(h('<div style="display:grid;place-items:center;height:100%;font-size:2rem">📋</div>'));
        box.remove();
      };
    };
    $$('[data-mode]', el).forEach((b) => (b.onclick = () => {
      state.mode = b.dataset.mode;
      $$('[data-mode]', el).forEach((x) => x.classList.toggle('on', x === b));
    }));
    $('[data-back]', el).onclick = () => {
      state.pages = [];
      setStep(1);
    };
    next.onclick = () => {
      const seen = new Set();
      state.entries = [];
      for (const p of state.pages) {
        for (const e of p.entries || []) {
          const k = `${e.name.toLowerCase()}|${e.page}`;
          if (seen.has(k)) continue;
          seen.add(k);
          state.entries.push({ ...e, keep: true });
        }
      }
      state.entries.sort((a, b) => a.name.localeCompare(b.name));
      setStep(3);
    };
    for (const p of state.pages) {
      p.el = null;
      drawPage(p);
    }
  }

  // ---------------- step 3: review ----------------
  function stepReview() {
    const el = h(`<div class="stack">
      <h2>Here's what I read</h2>
      <p class="muted">Fix any typos, untick anything that isn't a recipe, then feed it to me.</p>
      <div class="row"><input type="search" placeholder="Filter…" data-f style="flex:1"><button class="btn sm ghost" data-add>+ Add a line</button></div>
      <div class="review"></div>
      <div class="row" style="position:sticky;bottom:0;background:var(--card);padding:.6rem 0;border-top:2px dashed var(--soft-line)">
        <button class="btn ghost" data-back>← More pages</button><span class="spacer"></span>
        <button class="btn primary big" data-save></button></div>
    </div>`);
    stage.append(el);
    const list = $('.review', el);
    const save = $('[data-save]', el);
    const updateCount = () => {
      const n = state.entries.filter((e) => e.keep && e.name.trim()).length;
      save.textContent = `🍴 Feed me ${n} recipe${n === 1 ? '' : 's'}`;
      save.disabled = !n;
    };
    const draw = () => {
      const q = $('[data-f]', el).value.toLowerCase();
      list.innerHTML = '';
      state.entries.forEach((e) => {
        if (q && !e.name.toLowerCase().includes(q)) return;
        const row = h(`<div class="rev ${e.keep ? '' : 'off'}"><input value="${esc(e.name)}" aria-label="Recipe name"><input value="${esc(e.page)}" aria-label="Page" inputmode="numeric">
          <button class="icon-btn" aria-label="${e.keep ? 'Remove' : 'Keep'}">${e.keep ? '✕' : '↺'}</button></div>`);
        const [n, pg] = $$('input', row);
        n.oninput = () => { e.name = n.value; updateCount(); };
        pg.oninput = () => (e.page = pg.value);
        $('button', row).onclick = () => {
          e.keep = !e.keep;
          draw();
        };
        list.append(row);
      });
      updateCount();
    };
    $('[data-f]', el).oninput = draw;
    $('[data-add]', el).onclick = () => {
      state.entries.unshift({ name: '', page: '', keep: true });
      $('[data-f]', el).value = '';
      draw();
      $('input', list).focus();
    };
    $('[data-back]', el).onclick = () => setStep(2);
    save.onclick = async () => {
      save.disabled = true;
      try {
        const entries = state.entries.filter((e) => e.keep && e.name.trim()).map(({ name, page, tags }) => ({ name, page, tags }));
        const r = await api(`/api/books/${state.book.id}/recipes`, { method: 'POST', body: { entries, from: compact ? 'phone' : 'computer' } });
        state.result = r;
        setStep(4);
      } catch (err) {
        save.disabled = false;
        toast(esc(err.message), { error: true });
      }
    };
    draw();
  }

  // ---------------- step 4: done! ----------------
  function stepDone() {
    const r = state.result;
    const el = h(`<div class="success">${monsterSvg()}
      <div class="num">+${r.added}</div><h2>${quip('fed')}</h2>
      <p class="muted">${esc(state.book.title)} now has ${r.total} recipes.${r.skipped ? ` (${r.skipped} were already there.)` : ''}</p>
      <div class="row" style="justify-content:center"><button class="btn sun" data-more>📸 More pages for this book</button><button class="btn go" data-new>📚 Another book</button></div></div>`);
    stage.append(el);
    chomp(el);
    confetti();
    $('[data-more]', el).onclick = () => {
      state.pages = [];
      setStep(2);
    };
    $('[data-new]', el).onclick = () => {
      state.pages = [];
      state.book = null;
      setStep(1);
    };
  }

  (async () => {
    try {
      state.info = await api('/api/info');
    } catch {
      state.info = { aiEnabled: false };
    }
    if (bookId) {
      try {
        state.book = await api(`/api/books/${bookId}`);
        return setStep(2);
      } catch {}
    }
    setStep(1);
  })();
}

// ---------- barcode reading ----------
async function readBarcode(file) {
  const fromText = (s) => {
    const d = String(s || '').replace(/[^0-9X]/gi, '');
    return /^(97[89]\d{10}|\d{9}[\dX])$/i.test(d) ? d : null;
  };
  if ('BarcodeDetector' in window) {
    try {
      const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
      const bmp = await createImageBitmap(file);
      const codes = await det.detect(bmp);
      for (const c of codes) {
        const isbn = fromText(c.rawValue);
        if (isbn) return isbn;
      }
    } catch {}
  }
  try {
    await loadScript(ZXING);
    const ZX = window.ZXing;
    const url = await fileToDataUrl(file, { maxSide: 1600 });
    const hints = new Map();
    hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A]);
    hints.set(ZX.DecodeHintType.TRY_HARDER, true);
    const reader = new ZX.BrowserMultiFormatReader(hints);
    const res = await reader.decodeFromImageUrl(url);
    return fromText(res.getText());
  } catch {
    return null;
  }
}
