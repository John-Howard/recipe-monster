import {
  api, runJob, $, $$, h, esc, debounce, toast, modal, confirmBox, confetti, chomp, monsterSvg, quip,
  chipInput, chipLabel, chipClass, bookColour, tagPills, MEAL_EMOJI, initThemeToggle, loadScript,
} from './ui.js';
import { play, initSoundToggle } from './sounds.js';
import { mountScanner } from './scanner.js';
import { loadTagList, tagEditor, manageTags, selectionBar } from './tags.js';

const MEALS = ['breakfast', 'lunch', 'starter', 'dinner', 'dessert'];
const SIDEBAR_MEALS = ['breakfast', 'lunch', 'dinner'];
const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', starter: 'Starter', dinner: 'Main', dessert: 'Pudding' };
const ADDABLE = ['starter', 'dessert'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const view = $('#view');
let facets = { tags: [], authors: [], books: [] };
let info = { stats: {} };

// ---------------- persistent working plan ----------------
const store = {
  get() {
    try {
      return JSON.parse(localStorage.getItem('rm-plan')) || null;
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      localStorage.setItem('rm-plan', JSON.stringify(v));
    } catch {}
  },
};
function nextMonday() {
  const d = new Date();
  const add = (8 - d.getDay()) % 7 || 0;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}
const blankPlan = () => ({
  name: '',
  planId: null,
  theme: { chips: [], meals: ['dinner'], starters: 'off', puddings: 'off', days: 7, fewerBooks: false, avoidRecent: true, tryNew: false, start: nextMonday() },
  slots: [],
  recipes: {},
  warnings: [],
});
const CLIENT_ID = Math.random().toString(36).slice(2);
function cleanPlan(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.slots) || !p.theme?.meals) return blankPlan();
  p.slots = p.slots.filter((s) => s && Number.isInteger(s.day) && s.day >= 0 && MEALS.includes(s.meal));
  return p;
}
let plan = cleanPlan(store.get());
let planVersion = 0;
let pushTimer = null;
let syncedJson = '';

async function pushPlan() {
  pushTimer = null;
  const json = JSON.stringify(plan);
  if (json === syncedJson) return;
  try {
    syncedJson = json;
    planVersion = (await api('/api/current-plan', { method: 'PUT', body: { plan, client: CLIENT_ID } })).version;
  } catch {}
}
function savePlanLocal() {
  store.set(plan);
  if (JSON.stringify(plan) === syncedJson) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushPlan, 400);
}
async function loadSharedPlan() {
  try {
    const remote = await api('/api/current-plan', { retries: 0 });
    planVersion = remote.version;
    if (remote.plan) {
      plan = cleanPlan(remote.plan);
      syncedJson = JSON.stringify(plan);
      store.set(plan);
    } else if (store.get()) await pushPlan();
  } catch {}
}
async function applyRemotePlan(version) {
  if (pushTimer || version <= planVersion) return;
  try {
    const remote = await api('/api/current-plan', { retries: 0 });
    if (pushTimer || !remote.plan || remote.version <= planVersion) return;
    planVersion = remote.version;
    const json = JSON.stringify(remote.plan);
    if (json === JSON.stringify(plan)) {
      syncedJson = json;
      return;
    }
    plan = cleanPlan(remote.plan);
    syncedJson = json;
    store.set(plan);
    const name = location.hash.replace(/^#\/?/, '').split('/')[0] || 'plan';
    if (name === 'plan' && !document.querySelector('.modal-back')) route();
  } catch {}
}

function normaliseTheme(t) {
  if (t.meals.includes('dessert')) {
    t.puddings = t.puddings && t.puddings !== 'off' ? t.puddings : 'weekends';
    t.meals = t.meals.filter((m) => m !== 'dessert');
    if (!t.meals.length) t.meals = ['dinner'];
  }
  t.starters ||= 'off';
  t.puddings ||= 'off';
}

const isWeekend = (start, d) => {
  const dow = (new Date(`${start || nextMonday()}T12:00:00`).getDay() + d) % 7;
  return dow === 0 || dow === 6;
};

function themeSlots(old = []) {
  const t = plan.theme;
  const on = { starter: t.starters === 'weekends', dessert: t.puddings === 'weekends' };
  const slots = [];
  for (let d = 0; d < t.days; d++) for (const m of MEALS) {
    if (m in on ? !on[m] || !isWeekend(t.start, d) : !t.meals.includes(m)) continue;
    slots.push(old.find((s) => s.day === d && s.meal === m && s.locked) || { day: d, meal: m, recipe_id: null, locked: false });
  }
  return slots;
}

async function refreshMeta() {
  [facets, info] = await Promise.all([api('/api/facets'), api('/api/info')]);
}

// ---------------- router ----------------
const routes = { plan: viewPlan, search: viewSearch, library: viewLibrary, plans: viewPlans, scan: viewScan };
async function route() {
  const [name, arg] = (location.hash.replace(/^#\/?/, '') || 'plan').split('/');
  const fn = routes[name] || viewPlan;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${routes[name] ? name : 'plan'}`));
  for (const m of $$('.modal-back')) m.remove();
  view.innerHTML = '';
  await fn(arg);
}

// ======================================================================
// PLAN
// ======================================================================
const TAG_EMOJI = [
  [/slimming/i, '🥗'], [/fast ?800|5:2|fasting/i, '⚡'], [/vegan/i, '🌱'], [/vegetarian|veg\b/i, '🥕'], [/quick|fast|speedy|minute/i, '⏱️'],
  [/batch/i, '📦'], [/slow/i, '🐢'], [/air ?fry/i, '💨'], [/family/i, '👨‍👩‍👧'], [/bak/i, '🧁'], [/entertain|party/i, '🥂'],
  [/low cal|healthy|light/i, '💚'], [/keto|low carb/i, '🥑'], [/curry|indian/i, '🍛'], [/italian|pasta/i, '🍝'], [/chicken/i, '🐔'],
  [/fish|seafood/i, '🐟'], [/beef/i, '🐄'], [/soup/i, '🥣'], [/dessert/i, '🍰'], [/asian/i, '🥢'], [/mexican/i, '🌮'],
];
const emojiFor = (s) => (TAG_EMOJI.find(([re]) => re.test(s)) || [null, '🍽️'])[1];

async function viewPlan() {
  await refreshMeta();
  normaliseTheme(plan.theme);
  const s = info.stats;
  const el = h(`<div>
    <section class="hero">
      ${monsterSvg()}
      <div><div class="bubble">${s.recipes ? (plan.slots.length ? 'Your week is looking tasty. Tweak away!' : quip('hello')) : quip('empty')}</div>
        <div class="stats"><span class="stat">📚 ${s.books} books</span><span class="stat">🍽️ ${s.recipes} recipes</span><span class="stat">❤️ ${s.favourites} favourites</span><span class="stat">✅ ${s.cooked} meals cooked</span></div>
      </div>
    </section>
    ${s.recipes ? '' : `<div class="banner">${monsterSvg({ size: 40 })}<span>No recipes yet! Scan your first cookbook index with your phone, or load some demo books to have a play.</span><span class="spacer"></span><a class="btn primary" href="#/scan">📱 Start scanning</a></div>`}
    <div class="planner-grid">
      <aside class="card theme-card">
        <h2>🎨 Theme my week</h2>
        <p class="muted small" style="margin:0">Tap themes to combine them. Same kind = either; different kinds = both. Click a chip to flip it to “not”.</p>
        <div class="quick-themes"></div>
        <div data-chips></div>
        <div class="match-meter"><span class="n" data-n>…</span> <span data-nlabel>recipes match</span><div class="ticker"><span data-ticker></span></div></div>
        <div><b>Meals</b></div>
        <div class="row" style="margin:.35rem 0 .7rem" data-meals></div>
        <div class="row" style="margin-bottom:.6rem">
          <label class="field" style="flex:1"><span>Week starting</span><input type="date" data-start value="${esc(plan.theme.start || nextMonday())}"></label>
          <label class="field" style="width:96px"><span>Days</span><select data-days>${[3, 4, 5, 6, 7, 10, 14].map((d) => `<option ${d === plan.theme.days ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        </div>
        <div class="opts">
          <label class="toggle"><input type="checkbox" data-weekend="starters" ${plan.theme.starters === 'weekends' ? 'checked' : ''}> 🥗 Starters at weekends</label>
          <label class="toggle"><input type="checkbox" data-weekend="puddings" ${plan.theme.puddings === 'weekends' ? 'checked' : ''}> 🍮 Puddings at weekends</label>
          <label class="toggle"><input type="checkbox" data-opt="fewerBooks" ${plan.theme.fewerBooks ? 'checked' : ''}> 📚 Fewer books off the shelf</label>
          <label class="toggle"><input type="checkbox" data-opt="avoidRecent" ${plan.theme.avoidRecent !== false ? 'checked' : ''}> 🔁 Skip things cooked recently</label>
          <label class="toggle"><input type="checkbox" data-opt="tryNew" ${plan.theme.tryNew ? 'checked' : ''}> ✨ Favour recipes I've never cooked</label>
        </div>
        <button class="btn primary big" style="width:100%" data-generate>🎲 Feed me a week!</button>
        <div class="row" style="margin-top:.6rem;justify-content:center"><button class="btn sm ghost" data-savetheme>⭐ Save this theme</button><button class="btn sm ghost" data-reset>↺ Clear theme</button></div>
      </aside>
      <section class="card board"></section>
    </div></div>`);
  view.append(el);

  // quick theme tiles
  const savedThemes = await api('/api/themes');
  const qt = $('.quick-themes', el);
  const tiles = [];
  for (const t of savedThemes) tiles.push({ label: t.name, emoji: t.emoji, sub: 'saved theme', replace: t.theme.chips, del: t.id });
  for (const t of facets.tags.filter((t) => t.isBookTag).slice(0, 6)) tiles.push({ label: t.value, emoji: emojiFor(t.value), sub: `${t.n} recipes`, chip: { type: 'tag', value: t.value } });
  for (const a of facets.authors.slice(0, 3)) tiles.push({ label: a.value, emoji: '👩‍🍳', sub: `${a.books} book${a.books > 1 ? 's' : ''}`, chip: { type: 'author', value: a.value } });
  for (const t of facets.tags.filter((t) => !t.isBookTag && t.n >= 3).slice(0, 3)) tiles.push({ label: t.value[0].toUpperCase() + t.value.slice(1), emoji: emojiFor(t.value), sub: `${t.n} recipes`, chip: { type: 'tag', value: t.value } });
  if (s.favourites) tiles.push({ label: 'Favourites', emoji: '❤️', sub: `${s.favourites} recipes`, chip: { type: 'favourite', value: 'yes' } });
  tiles.push({ label: 'Surprise me', emoji: '🎲', sub: 'random theme', surprise: true });
  tiles.forEach((t, i) => {
    const b = h(`<button class="qt c${i % 5}"><span class="e">${t.emoji}</span>${esc(t.label)}<small>${esc(t.sub)}</small>${t.del ? '<span class="del" title="Delete saved theme">✕</span>' : ''}</button>`);
    b.onclick = async (e) => {
      if (e.target.classList.contains('del')) {
        await api(`/api/themes/${t.del}`, { method: 'DELETE' });
        return route();
      }
      let chips = plan.theme.chips;
      if (t.replace) chips = structuredClone(t.replace);
      else if (t.surprise) {
        const pool = facets.tags.filter((x) => x.n >= 7);
        const pick = pool[Math.floor(Math.random() * pool.length)];
        chips = pick ? [{ type: 'tag', value: pick.value }] : [];
      } else {
        const i = chips.findIndex((c) => c.type === t.chip.type && c.value === t.chip.value);
        if (i >= 0) chips.splice(i, 1);
        else chips.push(t.chip);
      }
      plan.theme.chips = chips;
      chipper.set(chips);
      onThemeChange();
      b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12) rotate(2deg)' }, { transform: 'scale(1)' }], { duration: 300 });
    };
    qt.append(b);
  });

  const chipper = chipInput({ facets: () => facets, chips: plan.theme.chips, onChange: (c) => { plan.theme.chips = c; onThemeChange(); } });
  $('[data-chips]', el).append(chipper.el);

  let sampleNames = [];
  const refreshPreview = async () => {
    const r = await api('/api/plan/preview', { method: 'POST', body: { chips: plan.theme.chips } });
    sampleNames = r.sample;
    $('[data-n]', el).textContent = r.count;
    $('[data-nlabel]', el).textContent = `recipe${r.count === 1 ? '' : 's'} match${r.count === 1 ? 'es' : ''} from ${r.books} book${r.books === 1 ? '' : 's'}`;
    $('[data-ticker]', el).textContent = r.sample.join('  ·  ');
    $('[data-n]', el).animate([{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 250 });
  };
  const onThemeChange = debounce(() => {
    savePlanLocal();
    refreshPreview();
  }, 150);
  refreshPreview();

  const mealsEl = $('[data-meals]', el);
  const drawMeals = () => {
    mealsEl.innerHTML = '';
    for (const m of SIDEBAR_MEALS) {
      const on = plan.theme.meals.includes(m);
      const b = h(`<button class="chip ${on ? 'tag' : ''}" style="cursor:pointer;${on ? '' : 'background:var(--card);opacity:.7'}" aria-pressed="${on}">${MEAL_EMOJI[m]} ${MEAL_LABEL[m]}</button>`);
      b.onclick = () => {
        plan.theme.meals = on ? plan.theme.meals.filter((x) => x !== m) : SIDEBAR_MEALS.filter((x) => x === m || plan.theme.meals.includes(x));
        if (!plan.theme.meals.length) plan.theme.meals = ['dinner'];
        drawMeals();
        savePlanLocal();
      };
      mealsEl.append(b);
    }
  };
  drawMeals();
  $('[data-start]', el).onchange = (e) => { plan.theme.start = e.target.value; savePlanLocal(); drawBoard(); };
  $('[data-days]', el).onchange = (e) => { plan.theme.days = Number(e.target.value); savePlanLocal(); };
  $$('[data-weekend]', el).forEach((cb) => (cb.onchange = () => { plan.theme[cb.dataset.weekend] = cb.checked ? 'weekends' : 'off'; savePlanLocal(); }));
  $$('[data-opt]', el).forEach((cb) => (cb.onchange = () => { plan.theme[cb.dataset.opt] = cb.checked; savePlanLocal(); }));
  $('[data-reset]', el).onclick = () => { plan.theme.chips = []; chipper.set(plan.theme.chips); onThemeChange(); };
  $('[data-savetheme]', el).onclick = () => {
    if (!plan.theme.chips.length) return toast('Add some theme chips first!', { error: true });
    const form = h(`<form class="stack"><label class="field"><span>Name</span><input name="name" required value="${esc(plan.theme.chips.map((c) => c.exclude ? 'no ' + chipLabel(c) : chipLabel(c)).join(' + ').replace(/<[^>]+>/g, ''))}"></label>
      <label class="field"><span>Emoji</span><input name="emoji" value="${esc(emojiFor(plan.theme.chips.map((c) => c.value).join(' ')))}" maxlength="4" style="width:80px"></label>
      <button class="btn go">Save theme</button></form>`);
    const m = modal('⭐ Save theme', form);
    form.onsubmit = async (e) => {
      e.preventDefault();
      await api('/api/themes', { method: 'POST', body: { name: form.name.value, emoji: form.emoji.value, theme: { chips: plan.theme.chips } } });
      m.close();
      toast('Theme saved. Find it in the tiles!');
      route();
    };
  };

  // ---------------- the board ----------------
  const board = $('.board', el);
  const startDate = () => new Date(`${plan.theme.start || nextMonday()}T12:00:00`);

  function drawBoard(spin = false) {
    board.innerHTML = '';
    const head = h(`<div class="board-head"><h2>🗓️</h2><input class="plan-name" aria-label="Plan name" placeholder="Name this week…" value="${esc(plan.name)}">
      <span class="spacer"></span>
      <button class="btn sm" data-shuffle title="Re-roll everything that isn't locked">🎰 Spin unlocked</button>
      <button class="btn sm" data-shelf>📚 Shelf list</button>
      <button class="btn sm sun" data-save>💾 ${plan.planId ? 'Save' : 'Save plan'}</button>
      <button class="btn sm ghost" data-clear title="Start again">🗑️</button></div>`);
    board.append(head);
    $('.plan-name', head).oninput = (e) => { plan.name = e.target.value; savePlanLocal(); };
    $('[data-shuffle]', head).onclick = () => generate(true);
    $('[data-shelf]', head).onclick = shelfList;
    $('[data-save]', head).onclick = savePlan;
    $('[data-clear]', head).onclick = async () => {
      if (plan.slots.length && !(await confirmBox('Clear this week and start fresh?', { ok: 'Clear it', danger: true }))) return;
      const theme = plan.theme;
      plan = blankPlan();
      plan.theme = theme;
      savePlanLocal();
      drawBoard();
    };
    if (plan.warnings?.length) board.append(h(`<div class="warnings">🤔 ${plan.warnings.map(esc).join('<br>🤔 ')}</div>`));

    if (!plan.slots.length) {
      board.append(h(`<div class="board-empty">${monsterSvg()}<h3>Your week is an empty plate.</h3>
        <p class="muted">Pick a theme on the left and hit <b>Feed me a week!</b>, or build it yourself by clicking a day.</p>
        <button class="btn" data-blank>✏️ Start with a blank week</button></div>`));
      $('[data-blank]', board).onclick = () => {
        plan.slots = themeSlots();
        savePlanLocal();
        drawBoard();
      };
      return;
    }
    const days = Math.max(...plan.slots.map((s) => s.day)) + 1;
    const hasMain = plan.slots.some((s) => s.meal === 'dinner');
    const meals = MEALS.filter((m) => plan.slots.some((s) => s.meal === m) || (hasMain && ADDABLE.includes(m)));
    const grid = h(`<div class="week" style="--days:${days}"></div>`);
    grid.append(h('<div class="corner"></div>'));
    const today = new Date().toISOString().slice(0, 10);
    for (let d = 0; d < days; d++) {
      const dt = new Date(startDate());
      dt.setDate(dt.getDate() + d);
      const iso = dt.toISOString().slice(0, 10);
      grid.append(h(`<div class="dayhead ${iso === today ? 'today' : ''}">${DAY_NAMES[dt.getDay()]}<small>${dt.getDate()} ${dt.toLocaleString(undefined, { month: 'short' })}</small></div>`));
    }
    // On phones the grid collapses to one column, so emit cells day by day there.
    const narrow = matchMedia('(max-width: 760px)').matches;
    if (narrow) {
      grid.innerHTML = '';
      for (let d = 0; d < days; d++) {
        const dt = new Date(startDate());
        dt.setDate(dt.getDate() + d);
        grid.append(h(`<div class="dayhead">${DAY_NAMES[dt.getDay()]} <small style="display:inline">${dt.getDate()} ${dt.toLocaleString(undefined, { month: 'short' })}</small></div>`));
        for (const m of meals) appendSlot(grid, d, m, spin);
      }
    } else {
      for (const m of meals) {
        grid.append(h(`<div class="mealhead" data-meal="${m}"><span class="e">${MEAL_EMOJI[m]}</span>${MEAL_LABEL[m]}</div>`));
        for (let d = 0; d < days; d++) appendSlot(grid, d, m, spin);
      }
    }
    board.append(grid);
  }

  function appendSlot(grid, day, meal, spin) {
    const idx = plan.slots.findIndex((s) => s.day === day && s.meal === meal);
    if (idx < 0 && ADDABLE.includes(meal)) {
      const e = h(`<button class="addcourse" data-meal="${esc(meal)}" data-label="${MEAL_LABEL[meal]}">＋ ${MEAL_LABEL[meal].toLowerCase()}</button>`);
      e.onclick = () => {
        plan.slots.push({ day, meal, recipe_id: null, locked: false });
        reroll(plan.slots.length - 1);
      };
      grid.append(e);
      return;
    }
    if (idx < 0) {
      const e = h(`<div class="slot empty" data-meal="${esc(meal)}" data-label="${MEAL_LABEL[meal]}">＋</div>`);
      e.onclick = () => {
        plan.slots.push({ day, meal, recipe_id: null, locked: false });
        savePlanLocal();
        pickFor(plan.slots.length - 1);
      };
      grid.append(e);
      return;
    }
    const s = plan.slots[idx];
    const r = plan.recipes[s.recipe_id];
    if (!r) {
      const e = h(`<div class="slot empty ${ADDABLE.includes(meal) ? 'compact' : ''}" data-meal="${esc(meal)}" data-label="${MEAL_LABEL[meal]}" tabindex="0">＋ add ${MEAL_LABEL[meal].toLowerCase()}</div>`);
      e.onclick = () => pickFor(idx);
      wireDrop(e, idx);
      grid.append(e);
      return;
    }
    const el = h(`<div class="slot ${ADDABLE.includes(meal) ? 'compact' : ''} ${s.locked ? 'locked' : ''} ${s.cooked ? 'cooked' : ''}" draggable="true" data-meal="${esc(meal)}" data-label="${MEAL_LABEL[meal]}" style="--book:${bookColour(r)}">
      <div class="band"></div>
      ${s.locked ? '<span class="lockflag" title="Locked">🔒</span>' : ''}
      <div class="inner">
        <div class="name" title="Recipe details">${esc(r.name)}</div>
        <div class="src">📖 <b>${esc(r.book_title)}</b>${r.page ? ` · p.${esc(r.page)}` : ''}</div>
        ${ADDABLE.includes(meal) ? '' : `<div class="tags">${r.favourite ? '<span class="pill">❤️</span>' : ''}${tagPills(r, 3, false)}</div>`}
      </div>
      <div class="acts">
        <button class="icon-btn ${s.locked ? 'on' : ''}" data-a="lock" title="${s.locked ? 'Unlock' : 'Lock (keep when re-spinning)'}">${s.locked ? '🔒' : '🔓'}</button>
        <button class="icon-btn" data-a="roll" title="Spin for another">🎲</button>
        <button class="icon-btn" data-a="pick" title="Choose a recipe">🔍</button>
        <button class="icon-btn ${s.cooked ? 'on' : ''}" data-a="cooked" title="Cooked it!">✅</button>
        <button class="icon-btn" data-a="clear" title="Remove">✕</button>
      </div></div>`);
    el.onclick = async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (e.target.closest('.name')) return recipeModal(r);
      if (!a) return;
      if (a === 'lock') { s.locked = !s.locked; savePlanLocal(); drawBoard(); }
      if (a === 'roll') reroll(idx);
      if (a === 'pick') pickFor(idx);
      if (a === 'clear') { ADDABLE.includes(meal) ? plan.slots.splice(idx, 1) : Object.assign(s, { recipe_id: null, locked: false }); savePlanLocal(); drawBoard(); }
      if (a === 'cooked') {
        s.cooked = !s.cooked;
        const upd = await api(`/api/recipes/${Number(r.id)}/cooked`, { method: 'POST', body: { cooked: s.cooked } });
        plan.recipes[r.id] = upd;
        savePlanLocal();
        drawBoard();
        if (s.cooked) { toast(`Yum! Hope <b>${esc(r.name)}</b> was delicious.`); chomp($('.hero', view)); }
      }
    };
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(idx)); el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    wireDrop(el, idx);
    if (spin && !s.locked) spinSlot(el, r);
    grid.append(el);
  }

  function wireDrop(el, idx) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('dragover'); });
    el.addEventListener('dragleave', () => el.classList.remove('dragover'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('dragover');
      const from = Number(e.dataTransfer.getData('text/plain'));
      if (Number.isNaN(from) || from === idx) return;
      const a = plan.slots[from], b = plan.slots[idx];
      [a.recipe_id, b.recipe_id] = [b.recipe_id, a.recipe_id];
      [a.locked, b.locked] = [b.locked, a.locked];
      [a.cooked, b.cooked] = [b.cooked, a.cooked];
      savePlanLocal();
      drawBoard();
    });
  }

  let spinCount = 0;
  function spinSlot(el, r) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const nameEl = $('.name', el);
    const names = [...sampleNames, ...Object.values(plan.recipes).map((x) => x.name)];
    const delay = 450 + spinCount++ * 110;
    el.classList.add('spinning');
    const iv = setInterval(() => (nameEl.textContent = names[Math.floor(Math.random() * names.length)] || '…'), 70);
    setTimeout(() => {
      clearInterval(iv);
      nameEl.textContent = r.name;
      el.classList.remove('spinning');
      el.classList.add('landed');
      play('land');
    }, delay);
  }

  async function generate(keepLocks = false) {
    const btn = $('[data-generate]', el);
    btn.disabled = true;
    play('unlock');
    try {
      const body = { theme: plan.theme, slots: keepLocks && plan.slots.length ? plan.slots : null };
      if (!keepLocks && plan.slots.some((s) => s.locked)) {
        // Keep locked recipes even on a fresh generate, but rebuild the grid for the chosen days/meals.
        body.slots = themeSlots(plan.slots).map((s) => ({ ...s }));
      }
      const r = await api('/api/plan/generate', { method: 'POST', body });
      plan.slots = r.slots;
      plan.recipes = { ...plan.recipes, ...r.recipes };
      plan.warnings = r.warnings;
      if (!plan.name) plan.name = defaultName();
      savePlanLocal();
      spinCount = 0;
      drawBoard(true);
      const filled = r.slots.filter((s) => s.recipe_id).length;
      if (filled) {
        play('spin', 450 + filled * 110);
        setTimeout(() => {
          play('chomp');
          confetti();
          chomp($('.hero', view));
          $('.hero .bubble', view).innerHTML = quip('generated');
        }, 450 + filled * 110);
      }
      board.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      toast(esc(e.message), { error: true });
    } finally {
      btn.disabled = false;
    }
  }
  $('[data-generate]', el).onclick = () => generate(false);

  function defaultName() {
    const d = startDate();
    const themeName = plan.theme.chips.filter((c) => !c.exclude).map((c) => chipLabel(c).replace(/<[^>]+>/g, '')).slice(0, 2).join(' + ');
    return `${themeName ? themeName + ' · ' : ''}w/c ${d.getDate()} ${d.toLocaleString(undefined, { month: 'short' })}`;
  }

  async function reroll(idx) {
    play('unlock');
    try {
      const r = await api('/api/plan/reroll', { method: 'POST', body: { theme: plan.theme, slots: plan.slots, index: idx } });
      plan.slots[idx] = { ...r.slot, locked: false };
      plan.recipes = { ...plan.recipes, ...r.recipes };
      if (r.warnings.length) toast(esc(r.warnings[0]), { error: true });
      savePlanLocal();
      spinCount = 0;
      drawBoard();
      play('reroll');
      const cell = $$('.slot', board).find((c) => c.querySelector('.name')?.textContent === plan.recipes[plan.slots[idx].recipe_id]?.name);
      if (cell) spinSlot(cell, plan.recipes[plan.slots[idx].recipe_id]);
    } catch (e) {
      toast(esc(e.message), { error: true });
    }
  }

  function pickFor(idx) {
    const s = plan.slots[idx];
    recipePicker(`${MEAL_EMOJI[s.meal]} Choose ${MEAL_LABEL[s.meal].toLowerCase()}`, plan.theme.chips, s.meal, (r) => {
      s.recipe_id = r.id;
      s.cooked = false;
      plan.recipes[r.id] = r;
      savePlanLocal();
      drawBoard();
      toast(`Added <b>${esc(r.name)}</b>`);
    });
  }

  async function savePlan() {
    play('unlock');
    const body = { name: plan.name || defaultName(), week_start: plan.theme.start, theme: plan.theme, slots: plan.slots };
    try {
      const saved = plan.planId ? await api(`/api/plans/${plan.planId}`, { method: 'PUT', body }) : await api('/api/plans', { method: 'POST', body });
      plan.planId = saved.id;
      plan.name = saved.name;
      savePlanLocal();
      play('burp');
      toast(`💾 Saved “${esc(saved.name)}”`);
      drawBoard();
    } catch (e) {
      toast(esc(e.message), { error: true });
    }
  }

  function shelfList() {
    const byBook = new Map();
    plan.slots.forEach((s) => {
      const r = plan.recipes[s.recipe_id];
      if (!r) return;
      if (!byBook.has(r.book_id)) byBook.set(r.book_id, { r, items: [] });
      const dt = new Date(startDate());
      dt.setDate(dt.getDate() + s.day);
      byBook.get(r.book_id).items.push({ r, when: `${DAY_NAMES[dt.getDay()]} ${MEAL_LABEL[s.meal].toLowerCase()}` });
    });
    const body = h(`<div class="shelflist"><p class="muted">Pull these ${byBook.size} book${byBook.size === 1 ? '' : 's'} off the shelf. Pages in order, so you can pop in bookmarks.</p></div>`);
    for (const { r, items } of [...byBook.values()].sort((a, b) => b.items.length - a.items.length)) {
      items.sort((a, b) => (parseInt(a.r.page) || 0) - (parseInt(b.r.page) || 0));
      body.append(h(`<div class="bk"><h3><span class="sw" style="--book:${bookColour(r)}"></span>${esc(r.book_title)} <span class="muted small">${esc(r.book_authors || '')}</span></h3>
        <ul>${items.map((i) => `<li><b>p.${esc(i.r.page || '?')}</b> ${esc(i.r.name)} <span class="muted small">(${i.when})</span></li>`).join('')}</ul></div>`));
    }
    body.append(h('<div class="row no-print" style="justify-content:flex-end;margin-top:1rem"><button class="btn sun" onclick="window.print()">🖨️ Print</button></div>'));
    modal('📚 Your shelf list', body);
  }

  drawBoard();
}

// ---------------- reusable recipe picker (search modal) ----------------
// meal: the slot being filled. Results are limited to recipes that suit it (mains for the main meal,
// puddings for pudding…), with a switch to show everything for the odd exception.
const PICKER_MEAL_LABEL = { breakfast: 'breakfast recipes', lunch: 'lunch-type recipes', starter: 'starters', dinner: 'main meals', dessert: 'puddings' };
function recipePicker(title, themeChips, meal, onPick) {
  const body = h(`<div class="stack">
    <div class="searchbar"><input type="search" placeholder="Search recipes, ingredients, books…" aria-label="Search"><button class="btn go">Search</button></div>
    <div class="row" style="gap:1.2rem">
      ${meal ? `<label class="toggle"><input type="checkbox" checked data-meal> Only ${esc(PICKER_MEAL_LABEL[meal] || meal)}</label>` : ''}
      ${themeChips?.length ? '<label class="toggle"><input type="checkbox" checked data-theme> Stick to this week\'s theme</label>' : ''}
    </div>
    <div class="results" style="max-height:55vh;overflow:auto;padding:4px"></div></div>`);
  const m = modal(title, body, { wide: true });
  const input = $('input[type=search]', body);
  const results = $('.results', body);
  const run = debounce(async () => {
    const useTheme = $('[data-theme]', body)?.checked;
    const onlyMeal = $('[data-meal]', body)?.checked;
    const rows = await api('/api/search', { method: 'POST', body: { q: input.value, filters: useTheme ? themeChips : [], meal: onlyMeal ? meal : null, limit: 80 } });
    results.innerHTML = rows.length ? '' : `<p class="muted">No matches. Try fewer words${onlyMeal ? `, or untick “Only ${esc(PICKER_MEAL_LABEL[meal] || meal)}”` : ''}${useTheme ? ', or untick the theme' : ''}.</p>`;
    for (const r of rows) {
      const c = h(`<div class="rcard" style="--book:${bookColour(r)}"><div class="name">${esc(r.name)}</div>
        <div class="small muted">📖 ${esc(r.book_title)}${r.page ? ` · p.${esc(r.page)}` : ''}</div><div>${tagPills(r, 4)}</div>
        <div class="row"><span class="small muted">${r.favourite ? '❤️ ' : ''}${r.times_cooked ? `cooked ${esc(r.times_cooked)}×` : 'never cooked'}</span><span class="spacer"></span><button class="btn sm go">Use this</button></div></div>`);
      $('button', c).onclick = () => { m.close(); onPick(r); };
      results.append(c);
    }
  }, 200);
  input.oninput = run;
  $('.btn.go', body).onclick = run;
  $('[data-theme]', body)?.addEventListener('change', run);
  $('[data-meal]', body)?.addEventListener('change', run);
  run();
}

// ---------------- recipe details ----------------
function recipeModal(r, onChange) {
  const body = h(`<div class="stack">
    <div class="row"><span class="pill" style="background:${bookColour(r)};color:#fff">📖 ${esc(r.book_title)}</span><span class="muted">${r.page ? `page ${esc(r.page)}` : ''}${r.book_authors ? ` · ${esc(r.book_authors)}` : ''}</span></div>
    <label class="field"><span>Name</span><input name="name" value="${esc(r.name)}"></label>
    <div class="row"><label class="field" style="width:110px"><span>Page</span><input name="page" value="${esc(r.page)}"></label>
      <div><b class="small">Rating</b><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" class="${n <= r.rating ? 'on' : ''}">⭐</button>`).join('')}</div></div>
      <button type="button" class="heart ${r.favourite ? 'on' : ''}" data-fav title="Favourite">❤️</button>
      <span class="muted small">${r.times_cooked ? `Cooked ${esc(r.times_cooked)}× · last ${esc(r.last_cooked || '')}` : 'Never cooked yet'}</span></div>
    <label class="field"><span>Course</span><select name="course">${['starter', 'main', 'dessert', 'side', 'breakfast', 'snack', 'other'].map((c) => `<option ${c === r.course ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <div class="field"><span>Tags <span class="muted small">(Enter or comma to add; book tags: ${esc(r.bookTags.join(', ') || 'none')})</span></span><div data-tags></div></div>
    <label class="field"><span>Notes</span><textarea name="notes" rows="3" placeholder="e.g. Double the garlic. Kids loved it.">${esc(r.notes || '')}</textarea></label>
    <div class="row"><button class="btn ghost" data-del>🗑️ Delete recipe</button><span class="spacer"></span><button class="btn go" data-save>Save</button></div></div>`);
  const tagEd = tagEditor(r.recipeTags);
  $('[data-tags]', body).append(tagEd.el);
  loadTagList();
  let rating = r.rating, fav = r.favourite;
  $$('[data-star]', body).forEach((b) => (b.onclick = () => {
    rating = Number(b.dataset.star) === rating ? 0 : Number(b.dataset.star);
    $$('[data-star]', body).forEach((x) => x.classList.toggle('on', Number(x.dataset.star) <= rating));
  }));
  $('[data-fav]', body).onclick = (e) => { fav = !fav; e.currentTarget.classList.toggle('on', !!fav); };
  const m = modal('🍽️ Recipe', body);
  $('[data-save]', body).onclick = async () => {
    const upd = await api(`/api/recipes/${Number(r.id)}`, {
      method: 'PUT',
      body: { name: $('[name=name]', body).value, page: $('[name=page]', body).value, notes: $('[name=notes]', body).value, rating, favourite: fav,
        ...($('[name=course]', body).value !== r.course && { course: $('[name=course]', body).value }),
        tags: tagEd.get() },
    });
    if (plan.recipes[r.id]) { plan.recipes[r.id] = upd; savePlanLocal(); }
    m.close();
    toast('Saved!');
    onChange ? onChange(upd) : route();
  };
  $('[data-del]', body).onclick = async () => {
    if (!(await confirmBox(`Delete <b>${esc(r.name)}</b>?`, { ok: 'Delete', danger: true }))) return;
    await api(`/api/recipes/${Number(r.id)}`, { method: 'DELETE' });
    m.close();
    onChange ? onChange(null) : route();
  };
}

// ======================================================================
// SEARCH
// ======================================================================
async function viewSearch() {
  await refreshMeta();
  const chips = [];
  const el = h(`<div class="stack">
    <div class="row"><h1 style="margin:0">🔎 Find a recipe</h1><span class="spacer"></span><span class="muted" data-count></span></div>
    <div class="searchbar"><input type="search" placeholder="Try “chicken curry”, “lentil”, “pie”…" aria-label="Search recipes" autofocus><label class="toggle"><input type="checkbox" data-fav> ❤️ only</label></div>
    <div data-chips></div>
    <label class="toggle"><input type="checkbox" data-all> Select all</label>
    <div class="results"></div></div>`);
  const selection = new Set();
  let shown = [];
  const bar = selectionBar(selection, (rerun = true) => (rerun ? run() : draw()));
  el.append(bar);
  loadTagList();
  view.append(el);
  const input = $('input[type=search]', el);
  const chipper = chipInput({ facets: () => facets, chips, placeholder: 'Filter by diet, author, book…', onChange: () => run() });
  $('[data-chips]', el).append(chipper.el);
  const results = $('.results', el);
  const run = debounce(async () => {
    const rows = await api('/api/search', { method: 'POST', body: { q: input.value, filters: chips, favourites: $('[data-fav]', el).checked, limit: 300 } });
    $('[data-count]', el).textContent = `${rows.length}${rows.length === 300 ? '+' : ''} recipes`;
    shown = rows;
    draw();
  }, 180);
  const draw = () => {
    results.innerHTML = '';
    if (!shown.length) results.append(h(`<div class="board-empty" style="grid-column:1/-1">${monsterSvg({ mood: 'sad' })}<p>Nothing tasty here. Try another word?</p></div>`));
    for (const r of shown) results.append(resultCard(r, run, selection, () => bar.update()));
    $('[data-all]', el).checked = shown.length > 0 && shown.every((r) => selection.has(r.id));
    bar.update();
  };
  $('[data-all]', el).onchange = (e) => {
    for (const r of shown) e.target.checked ? selection.add(r.id) : selection.delete(r.id);
    draw();
  };
  input.oninput = run;
  $('[data-fav]', el).onchange = run;
  run();
}

function resultCard(r, refresh, selection, onSelect) {
  const c = h(`<div class="rcard" style="--book:${bookColour(r)}">
    <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" class="pick" aria-label="Select ${esc(r.name)}" ${selection.has(r.id) ? 'checked' : ''}><div class="name" style="flex:1;cursor:pointer">${esc(r.name)}</div>
      <button class="heart ${r.favourite ? 'on' : ''}" title="Favourite">❤️</button></div>
    <div class="small muted">📖 <b>${esc(r.book_title)}</b>${r.page ? ` · p.${esc(r.page)}` : ''}</div>
    <div>${tagPills(r, 4)}</div>
    <div class="row"><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" class="${n <= r.rating ? 'on' : ''}" aria-label="${n} stars">⭐</button>`).join('')}</div>
      <span class="spacer"></span><button class="btn sm sun" data-add>＋ Plan</button></div></div>`);
  $('.pick', c).onchange = (e) => {
    e.target.checked ? selection.add(r.id) : selection.delete(r.id);
    onSelect();
  };
  $('.heart', c).onclick = async (e) => {
    const upd = await api(`/api/recipes/${Number(r.id)}`, { method: 'PUT', body: { favourite: !r.favourite } });
    Object.assign(r, upd);
    e.currentTarget.classList.toggle('on', !!r.favourite);
    if (r.favourite) toast(`❤️ Loving <b>${esc(r.name)}</b>`);
  };
  $$('[data-star]', c).forEach((b) => (b.onclick = async () => {
    const n = Number(b.dataset.star);
    const upd = await api(`/api/recipes/${Number(r.id)}`, { method: 'PUT', body: { rating: n === r.rating ? 0 : n } });
    Object.assign(r, upd);
    $$('[data-star]', c).forEach((x) => x.classList.toggle('on', Number(x.dataset.star) <= r.rating));
  }));
  $('.name', c).onclick = () => recipeModal(r, (upd) => (upd ? (Object.assign(r, upd), c.replaceWith(resultCard(r, refresh, selection, onSelect))) : c.remove()));
  $('[data-add]', c).onclick = () => addToPlan(r);
  return c;
}

function addToPlan(r) {
  if (!plan.slots.length) {
    plan.slots = themeSlots();
  }
  const days = Math.max(...plan.slots.map((s) => s.day)) + 1;
  const meals = MEALS.filter((m) => plan.slots.some((s) => s.meal === m));
  const start = new Date(`${plan.theme.start || nextMonday()}T12:00:00`);
  const body = h(`<div><p>Where should <b>${esc(r.name)}</b> go? <span class="muted small">(Filled slots get replaced; locked ones are marked 🔒.)</span></p>
    <div class="week" style="--days:${days};grid-template-columns:80px repeat(${days},minmax(70px,1fr))"></div></div>`);
  const g = $('.week', body);
  g.append(h('<div></div>'));
  for (let d = 0; d < days; d++) {
    const dt = new Date(start);
    dt.setDate(dt.getDate() + d);
    g.append(h(`<div class="dayhead">${DAY_NAMES[dt.getDay()]}</div>`));
  }
  const m = modal('📅 Add to plan', body, { wide: true });
  for (const meal of meals) {
    g.append(h(`<div class="mealhead">${MEAL_EMOJI[meal]}</div>`));
    for (let d = 0; d < days; d++) {
      const idx = plan.slots.findIndex((s) => s.day === d && s.meal === meal);
      const s = plan.slots[idx];
      const cur = s && plan.recipes[s.recipe_id];
      const b = h(`<button class="slot ${cur ? '' : 'empty'}" style="min-height:64px;padding:.3rem;font-size:.75rem;cursor:pointer">${s?.locked ? '🔒 ' : ''}${cur ? esc(cur.name) : '＋'}</button>`);
      b.onclick = () => {
        let i = idx;
        if (i < 0) { plan.slots.push({ day: d, meal, recipe_id: null, locked: false }); i = plan.slots.length - 1; }
        Object.assign(plan.slots[i], { recipe_id: r.id, cooked: false });
        plan.recipes[r.id] = r;
        savePlanLocal();
        m.close();
        toast(`📅 <b>${esc(r.name)}</b> is on the menu! <a href="#/plan">See week</a>`);
      };
      g.append(b);
    }
  }
}

// ======================================================================
// LIBRARY
// ======================================================================
async function viewLibrary(bookId) {
  await refreshMeta();
  const books = await api('/api/books');
  const el = h(`<div>
    <div class="row" style="margin-bottom:1rem"><h1 style="margin:0">📚 The bookshelf</h1><span class="spacer"></span>
      <input type="search" placeholder="Find a book…" style="width:220px" data-f aria-label="Filter books">
      <a class="btn primary" href="#/scan">📱 Scan a book</a>
      <button class="btn" data-more>⋯</button></div>
    ${info.stats.demo ? `<div class="banner">🧪 You've got ${info.stats.demo} demo books on the shelf. <span class="spacer"></span><button class="btn sm" data-nodemo>Remove demo books</button></div>` : ''}
    <div class="shelf"></div></div>`);
  view.append(el);
  const shelf = $('.shelf', el);
  const draw = () => {
    const q = $('[data-f]', el).value.toLowerCase();
    shelf.innerHTML = '';
    const add = h(`<div class="bookcard addbook"><div class="cover">＋</div><div class="meta">Add a book</div></div>`);
    add.onclick = () => (location.hash = '#/scan');
    shelf.append(add);
    for (const b of books.filter((b) => !q || `${b.title} ${b.authors} ${b.tags.join(' ')}`.toLowerCase().includes(q))) {
      const c = h(`<div class="bookcard" tabindex="0"><div class="cover" style="--book:${bookColour(b)}">${b.cover_url ? `<img src="${esc(b.cover_url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
        <span class="count">${b.recipe_count}</span>${b.cover_url ? '' : `<div class="t">${esc(b.title)}<small>${esc(b.authors)}</small></div>`}</div>
        <div class="meta">${esc(b.title)}</div><div class="tags">${b.tags.map((t) => `<span class="pill">${esc(t)}</span>`).join('')}${b.is_demo ? '<span class="pill">demo</span>' : ''}</div></div>`);
      c.onclick = () => bookModal(b.id);
      c.onkeydown = (e) => e.key === 'Enter' && bookModal(b.id);
      shelf.append(c);
    }
  };
  $('[data-f]', el).oninput = draw;
  draw();
  $('[data-nodemo]', el)?.addEventListener('click', async () => {
    if (!(await confirmBox('Remove all the demo books and their recipes?', { ok: 'Remove', danger: true }))) return;
    await api('/api/demo', { method: 'DELETE' });
    toast('Demo books gone. Time to scan the real ones!');
    route();
  });
  $('[data-more]', el).onclick = () => {
    const body = h(`<div class="stack">
      <a class="btn" href="/api/export" download>⬇️ Download a backup (JSON)</a>
      <label class="btn" style="position:relative;overflow:hidden">⬆️ Restore / import a backup<input type="file" accept="application/json" style="position:absolute;inset:0;opacity:0"></label>
      <button class="btn" data-tags>🏷️ Manage tags</button>
      <button class="btn" data-demo>🧪 Load demo books</button>
      <button class="btn" data-covers>🖼️ Download missing covers</button>
      <button class="btn" data-refreshcovers>🌐 Refresh all covers from the internet</button>
      ${info.aiEnabled ? '<button class="btn" data-courses>🍽️ Re-check courses with AI</button>' : ''}</div>`);
    const m = modal('Library tools', body);
    $('input', body).onchange = async (e) => {
      const data = JSON.parse(await e.target.files[0].text());
      const r = await api('/api/import', { method: 'POST', body: data });
      m.close();
      toast(`Imported ${r.books} books and ${r.recipes} recipes`);
      route();
    };
    $('[data-tags]', body).onclick = () => {
      m.close();
      manageTags(() => refreshMeta());
    };
    $('[data-covers]', body).onclick = async (e) => {
      e.target.disabled = true;
      toast('Looking for covers…');
      try {
        const r = await api('/api/covers/fetch-missing', { method: 'POST' });
        toast(`Found ${r.found} of ${r.checked} covers`);
      } catch (err) {
        toast(esc(err.message), { error: true });
      }
      m.close();
      route();
    };
    $('[data-courses]', body)?.addEventListener('click', async (e) => {
      const count = books.reduce((n, b) => n + b.recipe_count, 0);
      if (!(await confirmBox(`Ask Claude to re-check the course of ${count} recipes? Courses you set yourself are kept.`, { ok: 'Re-check' }))) return;
      e.target.disabled = true;
      const view = h('<div class="stack"><progress max="1" value="0"></progress><div data-status>Starting…</div><small>You can close this; I\'ll let you know when it\'s done.</small></div>');
      body.replaceChildren(view);
      const onTick = (secs, p) => {
        if (!p?.total) return;
        $('progress', view).value = p.done / p.total;
        $('[data-status]', view).innerHTML = `Checking ${esc(p.book)} — ${p.done} of ${p.total} recipes · ${secs}s`;
      };
      try {
        const r = await runJob('/api/courses/recheck', {}, { onTick, timeoutMs: 30 * 60_000 });
        toast(`Re-checked ${r.classified} recipe courses`);
      } catch (err) {
        toast(esc(err.message), { error: true });
      }
      m.close();
      route();
    });
    $('[data-refreshcovers]', body).onclick = async (e) => {
      if (!(await confirmBox('Refresh every cover from the internet? Your own cover photos will be replaced wherever an online cover is found.', { ok: 'Refresh', danger: true }))) return;
      e.target.disabled = true;
      toast('Refreshing covers…');
      try {
        const r = await api('/api/covers/fetch-missing?refresh=1', { method: 'POST' });
        toast(`Replaced ${r.found} of ${r.checked} covers`);
      } catch (err) {
        toast(esc(err.message), { error: true });
      }
      m.close();
      route();
    };
    $('[data-demo]', body).onclick = async () => {
      try {
        const r = await api('/api/demo', { method: 'POST' });
        toast(`Loaded ${r.books} demo books with ${r.recipes} recipes`);
      } catch (err) {
        toast(esc(err.message), { error: true });
      }
      m.close();
      route();
    };
  };
  if (bookId) bookModal(Number(bookId));
}

async function bookModal(id) {
  const b = await api(`/api/books/${id}`);
  const body = h(`<div class="stack">
    <form class="stack" data-meta>
      <div class="row" style="align-items:flex-start;gap:1rem">
        <div class="cover" style="width:110px;flex:none;--book:${bookColour(b)}">${b.cover_url ? `<img src="${esc(b.cover_url)}" alt="">` : `<div class="t">${esc(b.title)}</div>`}</div>
        <div class="stack" style="flex:1;min-width:220px">
          <label class="field"><span>Title</span><input name="title" value="${esc(b.title)}" required></label>
          <label class="field"><span>Author(s)</span><input name="authors" value="${esc(b.authors)}"></label>
          <div class="row"><label class="field" style="flex:1"><span>ISBN</span><input name="isbn" value="${esc(b.isbn)}"></label>
            <label class="field" style="flex:1"><span>Year</span><input name="year" value="${esc(b.year)}"></label>
            <label class="field" style="width:70px"><span>Colour</span><input name="colour" type="color" value="${bookColour(b)}" style="padding:0;height:42px"></label></div>
          <label class="field"><span>Diet / theme tags <span class="muted small">(comma separated, e.g. Slimming World, Fast 800)</span></span><input name="tags" value="${esc(b.tags.join(', '))}"></label>
          <label class="field"><span>Cover image URL</span><span class="row"><input name="cover_url" value="${esc(b.cover_url)}" style="flex:1"><button type="button" class="btn sm" data-findcover>🔎 Find cover</button>${b.cover_url.startsWith('/covers/') ? '<button type="button" class="btn sm" data-replacecover>🌐 Replace with online cover</button>' : ''}</span></label>
        </div></div>
      <div class="row"><button type="button" class="btn ghost" data-delbook>🗑️ Delete book</button><span class="spacer"></span>
        <a class="btn sun" href="#/scan/${b.id}">📸 Scan more index pages</a><button class="btn go">Save details</button></div>
    </form>
    <hr style="border:none;border-top:2px dashed var(--soft-line);width:100%">
    <div class="row"><h3 style="margin:0">${b.recipes.length} recipes</h3><span class="spacer"></span><input type="search" placeholder="Filter…" style="width:200px" data-rf><button class="btn sm" data-addr>＋ Add recipes</button></div>
    <div style="max-height:45vh;overflow:auto"><table class="recipes"><tbody></tbody></table></div></div>`);
  const m = modal('📖 Book', body, { wide: true });
  const tbody = $('tbody', body);
  const drawRecipes = () => {
    const q = $('[data-rf]', body).value.toLowerCase();
    tbody.innerHTML = '';
    for (const r of b.recipes.filter((r) => !q || r.name.toLowerCase().includes(q))) {
      const tr = h(`<tr><td><input value="${esc(r.name)}" aria-label="Name"></td><td class="pg"><input value="${esc(r.page)}" aria-label="Page"></td>
        <td class="small muted">${tagPills(r, 3)}</td><td class="act"><button class="icon-btn" title="Delete">✕</button></td></tr>`);
      const [n, p] = $$('input', tr);
      const saveRow = debounce(async () => {
        const upd = await api(`/api/recipes/${Number(r.id)}`, { method: 'PUT', body: { name: n.value, page: p.value } });
        Object.assign(r, upd);
      }, 500);
      n.oninput = p.oninput = saveRow;
      $('button', tr).onclick = async () => {
        await api(`/api/recipes/${Number(r.id)}`, { method: 'DELETE' });
        b.recipes = b.recipes.filter((x) => x.id !== r.id);
        tr.remove();
      };
      tbody.append(tr);
    }
  };
  $('[data-rf]', body).oninput = drawRecipes;
  drawRecipes();
  $('[data-meta]', body).onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.tags = fd.tags.split(',').map((t) => t.trim()).filter(Boolean);
    await api(`/api/books/${b.id}`, { method: 'PUT', body: fd });
    toast('Book saved');
    m.close();
    route();
  };
  $('[data-findcover]', body).onclick = async (e) => {
    e.target.disabled = true;
    try {
      const upd = await api(`/api/books/${b.id}/cover`, { method: 'POST' });
      $('[name=cover_url]', body).value = upd.cover_url;
      $('.cover', body).innerHTML = `<img src="${esc(upd.cover_url)}" alt="">`;
      toast('Cover downloaded');
    } catch (err) {
      toast(esc(err.message), { error: true });
    }
    e.target.disabled = false;
  };
  $('[data-replacecover]', body)?.addEventListener('click', async (e) => {
    if (!(await confirmBox('Replace this cover with one from the internet? Your current photo will be deleted.', { ok: 'Replace', danger: true }))) return;
    e.target.disabled = true;
    try {
      const upd = await api(`/api/books/${b.id}/cover?refresh=1`, { method: 'POST' });
      $('[name=cover_url]', body).value = upd.cover_url;
      $('.cover', body).innerHTML = `<img src="${esc(upd.cover_url)}" alt="">`;
      toast('Cover replaced');
    } catch {
      toast('Nothing found online, so your current cover was kept', { error: true });
    }
    e.target.disabled = false;
  });
  $('[data-delbook]', body).onclick = async () => {
    if (!(await confirmBox(`Delete <b>${esc(b.title)}</b> and its ${b.recipes.length} recipes?`, { ok: 'Delete', danger: true }))) return;
    await api(`/api/books/${b.id}`, { method: 'DELETE' });
    m.close();
    route();
  };
  $('[data-addr]', body).onclick = () => {
    const box = h(`<div class="stack"><p class="muted small">One recipe per line with the page number at the end, e.g. <code>Chicken and leek pie 45</code>. Pasting a whole index works too.</p>
      <textarea rows="10"></textarea><button class="btn go">Add them</button></div>`);
    const m2 = modal('＋ Add recipes', box);
    $('button', box).onclick = async () => {
      const { entries } = await api('/api/scan/parse', { method: 'POST', body: { text: $('textarea', box).value } });
      const r = await api(`/api/books/${b.id}/recipes`, { method: 'POST', body: { entries, from: 'typed' } });
      m2.close();
      m.close();
      toast(`Added ${r.added} recipes`);
      bookModal(b.id);
    };
  };
  m.el.querySelector('a[href^="#/scan"]').onclick = () => m.close();
}

// ======================================================================
// SAVED PLANS
// ======================================================================
async function viewPlans() {
  const plans = await api('/api/plans');
  const el = h(`<div><div class="row" style="margin-bottom:1rem"><h1 style="margin:0">🗂️ Saved weeks</h1><span class="spacer"></span><a class="btn primary" href="#/plan">＋ Plan a new week</a></div><div class="plans"></div></div>`);
  view.append(el);
  const list = $('.plans', el);
  if (!plans.length) list.append(h(`<div class="board-empty card" style="grid-column:1/-1">${monsterSvg()}<p>No saved weeks yet. Plan one and hit 💾 Save.</p></div>`));
  for (const p of plans) {
    const full = await api(`/api/plans/${p.id}`);
    const filled = full.slots.filter((s) => full.recipes[s.recipe_id]);
    const c = h(`<div class="card plancard"><h3>${esc(p.name)}</h3><div class="small muted">${p.week_start ? `Week of ${esc(p.week_start)} · ` : ''}${filled.length} meals · ${new Set(filled.map((s) => full.recipes[s.recipe_id].book_id)).size} books</div>
      <div class="mini">${filled.slice(0, 14).map((s) => `<i title="${esc(full.recipes[s.recipe_id].name)}" style="--book:${bookColour(full.recipes[s.recipe_id])}"></i>`).join('')}</div>
      <div class="small">${(p.theme.chips || []).map((ch) => `<span class="chip ${chipClass(ch)} ${ch.exclude ? 'exclude' : ''}" style="font-size:.72rem">${chipLabel(ch)}</span>`).join(' ')}</div>
      <div class="row" style="margin-top:.8rem"><button class="btn sm go" data-open>Open</button><button class="btn sm" data-copy>Use again</button><span class="spacer"></span><button class="btn sm ghost" data-del>🗑️</button></div></div>`);
    $('[data-open]', c).onclick = () => {
      plan = cleanPlan({ name: full.name, planId: full.id, theme: { ...blankPlan().theme, ...full.theme }, slots: full.slots, recipes: full.recipes, warnings: [] });
      savePlanLocal();
      location.hash = '#/plan';
    };
    $('[data-copy]', c).onclick = () => {
      plan = { name: '', planId: null, theme: { ...blankPlan().theme, ...full.theme, start: nextMonday() }, slots: full.slots.map((s) => ({ ...s, cooked: false })), recipes: full.recipes, warnings: [] };
      plan = cleanPlan(plan);
      savePlanLocal();
      toast('Copied into a new week. Tweak away!');
      location.hash = '#/plan';
    };
    $('[data-del]', c).onclick = async () => {
      if (!(await confirmBox(`Delete “${esc(p.name)}”?`, { ok: 'Delete', danger: true }))) return;
      await api(`/api/plans/${p.id}`, { method: 'DELETE' });
      if (plan.planId === p.id) { plan.planId = null; savePlanLocal(); }
      c.remove();
    };
    list.append(c);
  }
}

// ======================================================================
// SCAN (desktop: QR code for the phone + the same flow in-browser)
// ======================================================================
async function viewScan(bookId) {
  await refreshMeta();
  const urls = info.lanUrls || [];
  const phoneUrl = (urls[0] || location.origin) + `/scan.html${bookId ? `#book=${bookId}` : ''}`;
  const el = h(`<div class="stack">
    <div class="planner-grid" style="grid-template-columns:minmax(280px,360px) 1fr">
      <aside class="card stack" style="text-align:center">
        <h2>📱 Scan with your phone</h2>
        <p class="muted small">Point your phone's camera at this code (same Wi-Fi as this computer). Everything you scan pops up here instantly.</p>
        <div><div class="qr" data-qr></div></div>
        <code class="small" style="word-break:break-all">${esc(phoneUrl)}</code>
        ${urls.length > 1 ? `<details class="small"><summary>Other addresses</summary>${urls.slice(1).map((u) => `<div><code>${esc(u)}/scan.html</code></div>`).join('')}</details>` : ''}
        ${urls.length ? '' : '<p class="small muted">Couldn\'t detect a network address, so open this computer\'s IP address on port ' + esc(location.port || '80') + ' from your phone.</p>'}
        <div class="small" style="text-align:left;background:var(--bg-2);padding:.7rem;border-radius:12px">
          <b>Tips for great scans</b><ul style="margin:.3rem 0 0;padding-left:1.1rem">
          <li>Good light, no shadows from your phone</li><li>One index page per photo, filling the frame</li><li>Hold the book flat (a heavy mug helps!)</li>
          <li>${info.aiEnabled ? '🤖 AI reading is <b>on</b>: it copes with columns & sub-entries' : '📱 Using on-phone OCR. Set <code>ANTHROPIC_API_KEY</code> on the server for much smarter AI reading'}</li></ul></div>
      </aside>
      <section data-scanner></section>
    </div></div>`);
  view.append(el);
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js');
    const qr = window.qrcode(0, 'M');
    qr.addData(phoneUrl);
    qr.make();
    $('[data-qr]', el).innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
  } catch {
    $('[data-qr]', el).innerHTML = '<p class="small" style="line-height:1.3;color:#2b2118">QR code needs an internet connection. Type the address below into your phone instead.</p>';
  }
  mountScanner($('[data-scanner]', el), { bookId });
}

// ---------------- live updates from the phone ----------------
function listen() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'recipes-added' && ev.from === 'phone') {
      toast(`📱 Your phone just fed me <b>${ev.added}</b> recipes from <b>${esc(ev.book.title)}</b>!`, { ms: 6000 });
      confetti(60);
    } else if (ev.type === 'book-added') {
      toast(`📚 New book on the shelf: <b>${esc(ev.book.title)}</b>`);
    }
    if (ev.type === 'current-plan' && ev.client !== CLIENT_ID) applyRemotePlan(ev.version);
    if (['recipes-added', 'library-changed', 'book-added'].includes(ev.type)) {
      refreshMeta().catch(() => {});
      const name = location.hash.replace(/^#\/?/, '').split('/')[0];
      if (name === 'library' && !document.querySelector('.modal-back')) route();
    }
  };
}

initThemeToggle($('.theme-toggle:not(.sound-toggle)'));
initSoundToggle($('.sound-toggle'));
$('.brand').innerHTML = `${monsterSvg()}<b>Recipe <span>Monster</span></b>`;
window.addEventListener('hashchange', route);
listen();
loadSharedPlan().then(route);
