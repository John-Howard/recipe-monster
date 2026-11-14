// The scan flow: pick/create a book (barcode, cover photo or typing), photograph index pages,
// review what was read, save. Works on a phone (camera) or a computer (file upload).
import { api, h, esc, $, $$, toast, modal, chomp, confetti, monsterSvg, quip, fileToDataUrl, loadScript, bookColour } from './ui.js';

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
  const pageNo = (p) => state.pages.filter((x) => !x.deleted && x.file).indexOf(p) + 1;

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
      const live = state.pages.filter((p) => !p.deleted);
      const n = live.reduce((a, p) => a + (p.entries?.length || 0), 0);
      const busy = live.some((p) => p.busy);
      next.disabled = !n || busy;
      count.textContent = n ? `${n} recipes found so far${busy ? '…' : ''}` : busy ? 'Reading…' : '';
    };

    const drawPage = (p) => {
      if (p.deleted) return;
      if (!p.el) {
        p.el = h(`<div class="pagethumb" tabindex="0" title="Tap to check, rotate or delete this page">
          <img alt="Index page"><span class="pno"></span>
          <div class="pagetools">
            <button class="icon-btn" data-rot="270" aria-label="Rotate left and read again">↺</button>
            <button class="icon-btn" data-rot="90" aria-label="Rotate right and read again">↻</button>
            <button class="icon-btn" data-del aria-label="Delete this page">🗑️</button>
          </div>
          <div class="status"></div><div class="bar"></div></div>`);
        pagesEl.append(p.el);
        p.el.addEventListener('click', (e) => {
          const t = e.target.closest('button');
          if (t?.dataset.rot) return rotatePage(p, Number(t.dataset.rot));
          if (t?.hasAttribute('data-del')) return deletePage(p);
          if (t?.hasAttribute('data-retry')) return processPage(p);
          inspectPage(p);
        });
        p.el.addEventListener('keydown', (e) => e.key === 'Enter' && e.target === p.el && inspectPage(p));
      }
      const img = $('img', p.el);
      if (p.thumb) img.src = p.thumb;
      img.classList.toggle('hidden', !p.thumb);
      $('.pno', p.el).textContent = p.file ? `Page ${pageNo(p)}` : '📋 Pasted';
      p.el.classList.toggle('busy', !!p.busy);
      p.el.classList.toggle('bad', !p.busy && !p.error && p.entries.length < 3);
      $$('[data-rot]', p.el).forEach((b) => (b.disabled = !!p.busy || !p.file));
      $('.status', p.el).innerHTML = p.error
        ? `⚠️ Failed <button class="btn sm" data-retry style="padding:0 .4rem">Retry</button>`
        : p.busy
          ? esc(p.label || 'Reading…')
          : `${p.entries.length < 3 ? '🤔' : '✅'} ${p.entries.length} recipe${p.entries.length === 1 ? '' : 's'}${p.rotation ? ` · ↻${p.rotation}°` : ''}`;
      $('.bar', p.el).style.width = p.busy ? `${Math.round((p.progress || 0.05) * 100)}%` : '0';
      p.el.title = p.error || 'Tap to check, rotate or delete this page';
      refresh();
    };

    const redrawAll = () => state.pages.forEach(drawPage);

    function deletePage(p, { silent = false } = {}) {
      p.deleted = true;
      p.run = (p.run || 0) + 1; // any read still in flight for this page is ignored
      p.el?.remove();
      p.el = null;
      state.pages = state.pages.filter((x) => x !== p);
      redrawAll();
      refresh();
      if (!silent) toast(`🗑️ Page and its ${p.entries.length} recipe${p.entries.length === 1 ? '' : 's'} removed. Snap it again whenever you're ready.`, { monster: false });
    }

    async function rotatePage(p, by) {
      if (!p.file || p.busy) return;
      p.rotation = (((p.rotation || 0) + by) % 360 + 360) % 360;
      p.autoRotated = true; // the person chose this way up: don't second-guess it
      p.thumb = await fileToDataUrl(p.file, { maxSide: 400, quality: 0.7, rotate: p.rotation });
      drawPage(p);
      return processPage(p);
    }

    // OCR one image at a given rotation. Returns {text, confidence, entries}.
    async function ocrOnce(p, rotation, run, labelPrefix = 'Reading') {
      const image = await fileToDataUrl(p.file, { maxSide: 2400, grey: true, quality: 0.92, rotate: rotation });
      const res = await window.Tesseract.recognize(image, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text' && p.run === run) {
            p.progress = m.progress;
            p.label = `${labelPrefix} ${Math.round(m.progress * 100)}%`;
            drawPage(p);
          }
        },
      });
      const text = res.data.text;
      const entries = (await api('/api/scan/parse', { method: 'POST', body: { text } })).entries;
      return { text, confidence: res.data.confidence || 0, entries };
    }
    const score = (r) => r.entries.length * 10 + r.confidence;
    const looksWrong = (r) => r.entries.length < 3 || r.confidence < 45;

    async function processPage(p) {
      if (p.deleted) return;
      const run = (p.run = (p.run || 0) + 1);
      const stale = () => p.deleted || p.run !== run;
      p.busy = true;
      p.error = null;
      p.progress = 0.05;
      p.label = 'Reading…';
      p.entries = [];
      drawPage(p);
      try {
        if (!p.file) {
          // Pasted text: just parse it again.
          p.entries = (await api('/api/scan/parse', { method: 'POST', body: { text: p.text || '' } })).entries;
        } else if (state.mode === 'ai') {
          p.label = '🤖 Reading…';
          drawPage(p);
          const image = await fileToDataUrl(p.file, { maxSide: 2000, rotate: p.rotation || 0 });
          const r = await api('/api/scan/index', { method: 'POST', body: { image } });
          if (stale()) return;
          p.entries = r.entries;
          p.text = '';
          p.via = 'ai';
        } else {
          p.label = 'Loading OCR…';
          drawPage(p);
          await loadScript(TESSERACT);
          let best = await ocrOnce(p, p.rotation || 0, run);
          // Gibberish usually means the photo is sideways or upside down: try the other ways up.
          if (looksWrong(best) && !p.autoRotated) {
            let bestRot = p.rotation || 0;
            for (const extra of [90, 270, 180]) {
              if (stale()) return;
              const rot = ((p.rotation || 0) + extra) % 360;
              p.label = `Trying ↻${rot}°…`;
              drawPage(p);
              const r = await ocrOnce(p, rot, run, `Trying ↻${rot}°`);
              if (score(r) > score(best)) {
                best = r;
                bestRot = rot;
              }
              if (!looksWrong(best)) break;
            }
            p.autoRotated = true;
            if (bestRot !== (p.rotation || 0)) {
              p.rotation = bestRot;
              p.thumb = await fileToDataUrl(p.file, { maxSide: 400, quality: 0.7, rotate: bestRot });
              toast(`🔄 Page ${pageNo(p)} was the wrong way up, so I turned it ${bestRot}°.`, { monster: false });
            }
          }
          if (stale()) return;
          p.text = best.text;
          p.confidence = best.confidence;
          p.entries = best.entries;
          p.via = 'ocr';
        }
        p.busy = false;
        drawPage(p);
        if (!p.entries.length) toast(`Hmm, I couldn't find any recipes on page ${pageNo(p)}. Tap it to rotate, re-read or delete it.`, { error: true });
      } catch (err) {
        if (stale()) return;
        p.busy = false;
        p.error = err.message;
        drawPage(p);
        toast(esc(err.message), { error: true });
      }
    }

    // Close-up of one page: what was read, plus delete / rotate / re-read / fix the raw text.
    function inspectPage(p) {
      const ai = !!state.info?.aiEnabled;
      const body = h(`<div class="stack">
        ${p.thumb ? `<div class="inspect-img"><img alt="Index page photo"></div>` : ''}
        <div class="row">
          ${p.file ? `<button class="btn sm" data-rot="270">↺ Rotate left</button><button class="btn sm" data-rot="90">↻ Rotate right</button><button class="btn sm" data-rot="180">⤵ Upside down</button>` : ''}
          ${p.file ? `<button class="btn sm" data-again>🔁 Read again</button>` : ''}
          ${p.file && ai && state.mode !== 'ai' ? `<button class="btn sm plum" data-ai>🤖 Read with AI</button>` : ''}
          <span class="spacer"></span><button class="btn sm primary" data-del>🗑️ Delete page</button>
        </div>
        <div class="muted small">${p.busy ? 'Still reading…' : `Found <b>${p.entries.length}</b> recipe${p.entries.length === 1 ? '' : 's'}${p.via === 'ocr' && p.confidence != null ? ` · OCR confidence ${Math.round(p.confidence)}%` : ''}${p.rotation ? ` · rotated ${p.rotation}°` : ''}.`}
          ${p.entries.length ? '' : ' If it looks like nonsense, rotate it, re-read it, or delete it and take a new photo.'}</div>
        <div class="inspect-list">${p.entries.map((e) => `<div><b>${esc(e.page)}</b> ${esc(e.name)}</div>`).join('') || '<div class="muted">Nothing usable yet.</div>'}</div>
        ${p.text !== undefined && p.via !== 'ai' ? `<details ${p.file ? '' : 'open'}><summary class="small"><b>✏️ Fix the raw text</b> <span class="muted">(edit what the OCR read, then re-parse)</span></summary>
          <textarea rows="10" data-text style="margin-top:.4rem;font-family:ui-monospace,monospace;font-size:.85rem"></textarea>
          <button class="btn sm go" data-reparse style="margin-top:.4rem">Re-read this text</button></details>` : ''}
      </div>`);
      if (p.thumb) $('img', body).src = p.thumb;
      const ta = $('[data-text]', body);
      if (ta) ta.value = p.text || '';
      const m = modal(p.file ? `📄 Page ${pageNo(p)}` : '📋 Pasted text', body);
      $$('[data-rot]', body).forEach((b) => (b.onclick = () => { m.close(); rotatePage(p, Number(b.dataset.rot)); }));
      $('[data-again]', body)?.addEventListener('click', () => { m.close(); p.autoRotated = false; processPage(p); });
      $('[data-ai]', body)?.addEventListener('click', () => {
        m.close();
        state.mode = 'ai';
        $$('[data-mode]', el).forEach((x) => x.classList.toggle('on', x.dataset.mode === 'ai'));
        processPage(p);
      });
      $('[data-del]', body).onclick = () => { m.close(); deletePage(p); };
      $('[data-reparse]', body)?.addEventListener('click', async () => {
        p.text = ta.value;
        p.entries = (await api('/api/scan/parse', { method: 'POST', body: { text: p.text } })).entries;
        p.error = null;
        drawPage(p);
        m.close();
        toast(`Re-read: ${p.entries.length} recipes.`, { monster: false });
      });
    }

    // Process one page at a time so a phone doesn't run out of memory.
    let queue = Promise.resolve();
    const addFiles = async (files) => {
      for (const file of files) {
        const p = { file, entries: [], busy: true, label: 'Waiting…', rotation: 0 };
        state.pages.push(p);
        p.thumb = await fileToDataUrl(file, { maxSide: 400, quality: 0.7 });
        drawPage(p);
        queue = queue.then(() => (p.deleted ? null : processPage(p)));
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
        const p = { entries: r.entries, text, thumb: '', busy: false, via: 'paste' };
        state.pages.push(p);
        drawPage(p);
        box.remove();
      };
    };
    $$('[data-mode]', el).forEach((b) => (b.onclick = () => {
      state.mode = b.dataset.mode;
      $$('[data-mode]', el).forEach((x) => x.classList.toggle('on', x === b));
    }));
    $('[data-back]', el).onclick = () => {
      state.pages.forEach((p) => (p.deleted = true));
      state.pages = [];
      setStep(1);
    };
    next.onclick = () => setStep(3);
    for (const p of state.pages) {
      p.el = null;
      drawPage(p);
    }
    if (state.inspectOnReturn) {
      const p = state.inspectOnReturn;
      state.inspectOnReturn = null;
      if (state.pages.includes(p)) inspectPage(p);
    }
  }

  // ---------------- step 3: review ----------------
  // Entries stay attached to the page they came from, so a bad page can be thrown away
  // (or sent back for a re-read) without losing the corrections made to the others.
  function stepReview() {
    const el = h(`<div class="stack">
      <h2>Here's what I read</h2>
      <p class="muted">Fix any typos and remove anything that isn't a recipe. If a whole page came out as nonsense, delete that page or send it back to rotate and re-read it.</p>
      <div class="row"><input type="search" placeholder="Filter…" data-f style="flex:1"><button class="btn sm ghost" data-add>+ Add a line</button></div>
      <div class="review"></div>
      <div class="row" style="position:sticky;bottom:0;background:var(--card);padding:.6rem 0;border-top:2px dashed var(--soft-line)">
        <button class="btn ghost" data-back>← Pages</button><span class="spacer"></span>
        <button class="btn primary big" data-save></button></div>
    </div>`);
    stage.append(el);
    const list = $('.review', el);
    const save = $('[data-save]', el);
    state.manual = state.manual || [];

    // Work out which entries are duplicates of an earlier page's entry.
    const groups = () => {
      const seen = new Set();
      const out = [];
      const pages = state.pages.filter((p) => !p.deleted && !p.busy);
      const withManual = state.manual.length ? [{ manual: true, entries: state.manual }, ...pages] : pages;
      for (const p of withManual) {
        const items = [];
        for (const e of p.entries) {
          if (e.keep === undefined) e.keep = true;
          const k = `${e.name.trim().toLowerCase()}|${String(e.page).trim()}`;
          const dup = !p.manual && e.name.trim() && seen.has(k);
          if (e.name.trim()) seen.add(k);
          items.push({ e, dup });
        }
        out.push({ p, items });
      }
      return out;
    };
    const kept = () => groups().flatMap((g) => g.items.filter((i) => !i.dup && i.e.keep && i.e.name.trim()).map((i) => i.e));
    const updateCount = () => {
      const n = kept().length;
      save.textContent = `🍴 Feed me ${n} recipe${n === 1 ? '' : 's'}`;
      save.disabled = !n;
    };
    const draw = () => {
      const q = $('[data-f]', el).value.toLowerCase();
      list.innerHTML = '';
      const gs = groups();
      if (!gs.some((g) => g.items.length)) {
        list.append(h('<p class="muted">No recipes left. Go back and add or re-read some pages.</p>'));
      }
      for (const { p, items } of gs) {
        const n = items.filter((i) => !i.dup && i.e.keep).length;
        const head = h(`<div class="revpage">
          ${p.thumb ? '<img alt="">' : `<span class="revicon">${p.manual ? '✍️' : '📋'}</span>`}
          <div style="flex:1 1 150px;min-width:0"><b>${p.manual ? 'Added by hand' : p.file ? `Page ${pageNo(p)}` : 'Pasted text'}</b>
            <div class="small muted">${n} recipe${n === 1 ? '' : 's'}${items.some((i) => i.dup) ? ` · ${items.filter((i) => i.dup).length} already on another page` : ''}</div></div>
          ${p.manual ? '' : `<div class="row" style="gap:.4rem;margin-left:auto">${p.file ? '<button class="btn sm" data-fix title="Rotate or read this page again">🔁 Re-read</button>' : ''}<button class="btn sm ghost" data-delpage title="Remove this page and all its recipes">🗑️ Delete page</button></div>`}
        </div>`);
        if (p.thumb) $('img', head).src = p.thumb;
        $('[data-fix]', head)?.addEventListener('click', () => {
          state.inspectOnReturn = p;
          setStep(2);
        });
        $('[data-delpage]', head)?.addEventListener('click', () => {
          p.deleted = true;
          state.pages = state.pages.filter((x) => x !== p);
          toast(`🗑️ Removed that page and its ${p.entries.length} recipes.`, { monster: false });
          draw();
        });
        list.append(head);
        for (const { e, dup } of items) {
          if (q && !e.name.toLowerCase().includes(q)) continue;
          const row = h(`<div class="rev ${e.keep && !dup ? '' : 'off'}" ${dup ? 'title="Also on an earlier page, so it will only be saved once"' : ''}>
            <input value="${esc(e.name)}" aria-label="Recipe name" ${dup ? 'disabled' : ''}><input value="${esc(e.page)}" aria-label="Page" inputmode="numeric" ${dup ? 'disabled' : ''}>
            <button class="icon-btn" aria-label="${e.keep ? 'Remove' : 'Keep'}" ${dup ? 'disabled' : ''}>${dup ? '⧉' : e.keep ? '✕' : '↺'}</button></div>`);
          const [nm, pg] = $$('input', row);
          nm.oninput = () => { e.name = nm.value; updateCount(); };
          pg.oninput = () => (e.page = pg.value);
          $('button', row).onclick = () => {
            e.keep = !e.keep;
            draw();
          };
          list.append(row);
        }
      }
      updateCount();
    };
    $('[data-f]', el).oninput = draw;
    $('[data-add]', el).onclick = () => {
      state.manual.unshift({ name: '', page: '', keep: true });
      $('[data-f]', el).value = '';
      draw();
      $('.rev input', list)?.focus();
    };
    $('[data-back]', el).onclick = () => setStep(2);
    save.onclick = async () => {
      save.disabled = true;
      try {
        const entries = kept().map(({ name, page, tags }) => ({ name: name.trim(), page: String(page).trim(), tags }));
        const r = await api(`/api/books/${state.book.id}/recipes`, { method: 'POST', body: { entries, from: compact ? 'phone' : 'computer' } });
        state.result = r;
        state.manual = [];
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
      state.pages.forEach((p) => (p.deleted = true));
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
