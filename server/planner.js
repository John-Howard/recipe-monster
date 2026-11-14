// Weekly menu generator: picks recipes that match a theme, fit the meal, and make a varied week.
import { applyFilters } from './db.js';
import { mealFits, mealAffinity, mainIngredient } from './tagger.js';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'dessert'];
const CUISINES = ['indian', 'italian', 'mexican', 'asian', 'middle eastern', 'spanish', 'french', 'british'];
const DAY_MS = 86400000;

export function emptySlots(days = 7, meals = ['dinner']) {
  const slots = [];
  for (let d = 0; d < days; d++) for (const meal of MEALS) if (meals.includes(meal)) slots.push({ day: d, meal, recipe_id: null, locked: false });
  return slots;
}

function cuisineOf(r) {
  const t = r.tags.map((x) => x.toLowerCase());
  return CUISINES.find((c) => t.includes(c)) || null;
}

function poolFor(recipes, theme, meal) {
  const themed = applyFilters(recipes, theme.chips || []);
  const strict = themed.filter((r) => mealFits(r, meal));
  return { themed, strict };
}

function weight(r, slot, picked, theme, now) {
  let w = mealAffinity(r, slot.meal);
  if (r.favourite) w *= 2.5;
  w *= 1 + (r.rating || 0) * 0.3;
  if (theme.avoidRecent !== false && r.last_cooked) {
    const age = (now - Date.parse(r.last_cooked)) / DAY_MS;
    if (age < 14) w *= 0.15;
    else if (age < 30) w *= 0.5;
  }
  if (!r.times_cooked) w *= theme.tryNew ? 2 : 1.15;

  const sameMeal = picked.filter((p) => p.slot.meal === slot.meal);
  const neighbours = sameMeal.filter((p) => Math.abs(p.slot.day - slot.day) === 1).map((p) => p.recipe);
  const ing = mainIngredient(r);
  if (ing !== 'other' && neighbours.some((n) => mainIngredient(n) === ing)) w *= 0.25;
  const ingCount = sameMeal.filter((p) => mainIngredient(p.recipe) === ing && ing !== 'other').length;
  if (ingCount >= 2) w *= 0.4;
  const cuisine = cuisineOf(r);
  if (cuisine && neighbours.some((n) => cuisineOf(n) === cuisine)) w *= 0.5;

  const bookUses = picked.filter((p) => p.recipe.book_id === r.book_id).length;
  if (theme.fewerBooks) w *= bookUses ? 5 : 1;
  else if (bookUses >= 2) w *= 0.6;
  return w;
}

function pickWeighted(cands, weights, rand) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return cands[Math.floor(rand() * cands.length)];
  let x = rand() * total;
  for (let i = 0; i < cands.length; i++) {
    x -= weights[i];
    if (x <= 0) return cands[i];
  }
  return cands[cands.length - 1];
}

function chooseFor(slot, recipes, theme, picked, usedIds, rand, warnings) {
  const { themed, strict } = poolFor(recipes, theme, slot.meal);
  let cands = strict.filter((r) => !usedIds.has(r.id));
  if (!cands.length && (slot.meal === 'dinner' || slot.meal === 'lunch')) {
    // Not enough meal-shaped recipes in the theme: loosen up rather than leave a gap.
    cands = themed.filter((r) => !usedIds.has(r.id) && mealFits(r, 'dinner'));
    if (!cands.length) cands = themed.filter((r) => !usedIds.has(r.id) && !r.tags.includes('sauces') && !r.tags.includes('drinks'));
    if (cands.length) warnings.add(`Ran short of ${slot.meal} ideas in this theme, so the monster improvised.`);
  }
  if (!cands.length) {
    // Allow repeats before giving up.
    cands = strict.length ? strict : [];
    if (cands.length) warnings.add(`Not enough different ${slot.meal} recipes for a whole week, so some repeat.`);
  }
  if (!cands.length) {
    warnings.add(`No ${slot.meal} recipes match this theme yet. Try loosening it, or scan more books!`);
    return null;
  }
  const now = Date.now();
  return pickWeighted(cands, cands.map((r) => weight(r, slot, picked, theme, now)), rand);
}

/**
 * Fill every unlocked slot. Locked slots (and their recipes) are kept and count towards variety.
 * @returns {{slots: object[], warnings: string[], poolSize: number}}
 */
export function generatePlan(recipes, theme = {}, slots = null, rand = Math.random) {
  const meals = theme.meals?.length ? theme.meals : ['dinner'];
  const days = Math.max(1, Math.min(14, Number(theme.days) || 7));
  const base = slots?.length ? slots : emptySlots(days, meals);
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const warnings = new Set();

  const picked = [];
  const usedIds = new Set();
  for (const s of base) {
    if (s.locked && byId.has(s.recipe_id)) {
      picked.push({ slot: s, recipe: byId.get(s.recipe_id) });
      usedIds.add(s.recipe_id);
    }
  }
  // Fill dinners first (they matter most), then the rest, in day order.
  const order = base
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !(s.locked && byId.has(s.recipe_id)))
    .sort((a, b) => (a.s.meal === 'dinner' ? 0 : 1) - (b.s.meal === 'dinner' ? 0 : 1) || a.s.day - b.s.day);

  const out = base.map((s) => ({ ...s }));
  for (const { s, i } of order) {
    const r = chooseFor(s, recipes, theme, picked, usedIds, rand, warnings);
    out[i] = { ...s, recipe_id: r ? r.id : null, locked: false, cooked: false };
    if (r) {
      picked.push({ slot: s, recipe: r });
      usedIds.add(r.id);
    }
  }
  const poolSize = applyFilters(recipes, theme.chips || []).length;
  return { slots: out, warnings: [...warnings], poolSize };
}

/** Pick a fresh recipe for one slot, avoiding everything else already in the plan. */
export function rerollSlot(recipes, theme = {}, slots = [], index, rand = Math.random) {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const target = slots[index];
  if (!target) throw new Error('No such slot');
  const picked = [];
  const usedIds = new Set();
  slots.forEach((s, i) => {
    if (s.recipe_id && byId.has(s.recipe_id)) {
      usedIds.add(s.recipe_id);
      if (i !== index) picked.push({ slot: s, recipe: byId.get(s.recipe_id) });
    }
  });
  const warnings = new Set();
  const r = chooseFor(target, recipes, theme, picked, usedIds, rand, warnings);
  return { slot: { ...target, recipe_id: r ? r.id : target.recipe_id, cooked: false }, warnings: [...warnings] };
}
