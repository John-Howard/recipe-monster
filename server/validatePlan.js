import { MEALS } from './planner.js';

const CHIP_TYPES = ['tag', 'author', 'book', 'text', 'favourite'];
const WEEKENDS = ['off', 'weekends'];
const MAX_BYTES = 500 * 1024;
const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
const isBoolOrNone = (b) => b === undefined || typeof b === 'boolean';

function validateTheme(t) {
  if (t === undefined) return null;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return 'theme must be an object';
  if (t.start !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(t.start)) return 'theme.start must be a YYYY-MM-DD date';
  if (t.days !== undefined && !isInt(t.days, 1, 14)) return 'theme.days must be a whole number from 1 to 14';
  if (t.meals !== undefined && !(Array.isArray(t.meals) && t.meals.every((m) => MEALS.includes(m)))) return 'theme.meals has an unknown meal';
  for (const k of ['starters', 'puddings']) {
    if (t[k] !== undefined && !WEEKENDS.includes(t[k])) return `theme.${k} must be off or weekends`;
  }
  if (t.chips === undefined) return null;
  if (!Array.isArray(t.chips)) return 'theme.chips must be an array';
  const badChip = t.chips.find((c) => !c || typeof c !== 'object' || !CHIP_TYPES.includes(c.type) || typeof c.value !== 'string' || c.value.length > 200);
  return badChip ? 'theme has an invalid chip' : null;
}

const badSlot = (s) =>
  !s || typeof s !== 'object' || !isInt(s.day, 0, 13) || !MEALS.includes(s.meal) ||
  !(s.recipe_id === null || s.recipe_id === undefined || Number.isInteger(s.recipe_id)) ||
  !isBoolOrNone(s.locked) || !isBoolOrNone(s.cooked);

export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return 'Plan must be an object';
  if (JSON.stringify(plan).length > MAX_BYTES) return 'Plan is too large';
  const themeError = validateTheme(plan.theme);
  if (themeError) return themeError;
  if (plan.recipes !== undefined && (!plan.recipes || typeof plan.recipes !== 'object' || Array.isArray(plan.recipes))) return 'recipes must be an object';
  if (plan.slots === undefined) return null;
  if (!Array.isArray(plan.slots) || plan.slots.length > 200) return 'slots must be an array of at most 200';
  return plan.slots.some(badSlot) ? 'plan has an invalid slot' : null;
}
