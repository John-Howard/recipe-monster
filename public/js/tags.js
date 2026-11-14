import { api, $, $$, h, esc, toast, modal, confirmBox } from './ui.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const counts = (t) => [t.recipes && plural(t.recipes, 'recipe'), t.books && plural(t.books, 'book')].filter(Boolean).join(' · ') || 'unused';

export async function loadTagList() {
  let list = $('#tag-list');
  if (!list) {
    list = h('<datalist id="tag-list"></datalist>');
    document.body.append(list);
  }
  try {
    const tags = await api('/api/tags');
    list.innerHTML = tags.map((t) => `<option value="${esc(t.tag)}"></option>`).join('');
  } catch {}
}

export function tagEditor(initial = []) {
  const tags = [...initial];
  const el = h('<div class="tagedit"><span data-pills></span><input list="tag-list" placeholder="Add a tag…" aria-label="Add a tag"></div>');
  const input = $('input', el);
  const draw = () => {
    $('[data-pills]', el).innerHTML = tags
      .map((t, i) => `<span class="pill">${esc(t)} <button type="button" class="pillx" data-x="${i}" aria-label="Remove ${esc(t)}">×</button></span>`)
      .join(' ');
  };
  const add = (raw) => {
    const t = raw.trim().replace(/\s+/g, ' ');
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
  };
  el.addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    tags.splice(Number(x.dataset.x), 1);
    draw();
  });
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add(input.value);
      input.value = '';
      draw();
    } else if (e.key === 'Backspace' && !input.value) {
      tags.pop();
      draw();
    }
  };
  input.oninput = () => {
    if (!input.value.includes(',')) return;
    const parts = input.value.split(',');
    input.value = parts.pop();
    parts.forEach(add);
    draw();
  };
  draw();
  return { el, get: () => (add(input.value), input.value = '', draw(), [...tags]) };
}

export function manageTags(onChange) {
  const body = h(`<div class="stack"><input type="search" data-f placeholder="Filter tags…" aria-label="Filter tags"><div class="taglist" data-list></div></div>`);
  const m = modal('🏷️ Manage tags', body);
  let tags = [];
  const draw = () => {
    const q = $('[data-f]', body).value.trim().toLowerCase();
    const rows = tags.filter((t) => t.tag.toLowerCase().includes(q)).slice(0, 300);
    $('[data-list]', body).innerHTML = rows.length
      ? rows.map((t, i) => `<div class="tagrow" data-i="${i}"><span class="pill">${esc(t.tag)}</span>
          <span class="muted small">${counts(t)}</span><span class="spacer"></span>
          <button class="btn sm" data-rename>Rename</button><button class="btn sm ghost" data-delete>Delete</button></div>`).join('')
      : '<p class="muted">No tags found.</p>';
    $$('.tagrow', body).forEach((row) => wire(row, rows[Number(row.dataset.i)]));
  };
  const reload = async () => {
    tags = await api('/api/tags');
    draw();
    loadTagList();
    onChange?.();
  };
  const rename = async (t, name) => {
    const clean = name.trim();
    if (!clean || clean === t.tag) return draw();
    const target = tags.find((x) => x.tag.toLowerCase() === clean.toLowerCase() && x.tag.toLowerCase() !== t.tag.toLowerCase());
    if (target && !(await confirmBox(`Merge <b>${esc(t.tag)}</b> into <b>${esc(target.tag)}</b>?`, { ok: 'Merge' }))) return draw();
    try {
      const r = await api(`/api/tags/${encodeURIComponent(t.tag)}`, { method: 'PUT', body: { name: target?.tag ?? clean } });
      toast(`Updated ${counts(r)}`);
      await reload();
    } catch (e) {
      toast(esc(e.message), { error: true });
    }
  };
  const wire = (row, t) => {
    $('[data-rename]', row).onclick = () => {
      row.innerHTML = `<input value="${esc(t.tag)}" aria-label="New name"><button class="btn sm go" data-ok>Save</button><button class="btn sm ghost" data-no>Cancel</button>`;
      const input = $('input', row);
      input.focus();
      input.select();
      $('[data-ok]', row).onclick = () => rename(t, input.value);
      $('[data-no]', row).onclick = draw;
      input.onkeydown = (e) => e.key === 'Enter' && rename(t, input.value);
    };
    $('[data-delete]', row).onclick = async () => {
      if (!(await confirmBox(`Delete <b>${esc(t.tag)}</b> from ${counts(t)}?`, { ok: 'Delete', danger: true }))) return;
      try {
        await api(`/api/tags/${encodeURIComponent(t.tag)}`, { method: 'DELETE' });
        await reload();
      } catch (e) {
        toast(esc(e.message), { error: true });
      }
    };
  };
  $('[data-f]', body).oninput = draw;
  reload().catch((e) => toast(esc(e.message), { error: true }));
  return m;
}

export function selectionBar(selection, onDone) {
  const el = h(`<div class="selbar" hidden><b data-n></b><input list="tag-list" placeholder="Tag…" aria-label="Tag">
    <button class="btn sm go" data-add>Add tag</button><button class="btn sm" data-remove>Remove tag</button><button class="btn sm ghost" data-clear>Clear</button></div>`);
  const apply = async (key) => {
    const tag = $('input', el).value.trim();
    if (!tag) return toast('Type a tag first', { error: true });
    try {
      const r = await api('/api/recipes/tags', { method: 'POST', body: { ids: [...selection], [key]: [tag] } });
      toast(`Tagged ${plural(r.updated, 'recipe')}`);
      selection.clear();
      $('input', el).value = '';
      loadTagList();
      onDone();
    } catch (e) {
      toast(esc(e.message), { error: true });
    }
  };
  $('[data-add]', el).onclick = () => apply('add');
  $('[data-remove]', el).onclick = () => apply('remove');
  $('[data-clear]', el).onclick = () => {
    selection.clear();
    onDone(false);
  };
  el.update = () => {
    el.hidden = !selection.size;
    $('[data-n]', el).textContent = `${selection.size} selected`;
  };
  return el;
}
