/**
 * coach-plan-log.js: logging a coach's day plan, on the client's device.
 *
 * Everything goes through the Diary's own add path (addDiaryItem), so a
 * logged plan item is an ordinary diary item: totals, Statistics, sync, the
 * API and the meal.logged webhook see what a manual add makes. A food the
 * client doesn't have yet (the coach's, or from Open Food Facts) is copied
 * into their catalog first, remembering where it came from (a coach's food
 * or recipe by source, an Open Food Facts product by its barcode), as
 * adding a search result does. Works offline wherever the Diary does.
 */
import { NtApi } from './api.js';
import { editorState } from '../stores/editorState.js';
import { findOwn, foodFromPlanItem, planDiaryItem, planMark } from './coach-plans.js';

/** The client's own catalog, as the Foods page reads it. */
async function _catalog() {
  const [foods, recipes] = await Promise.all([
    NtApi.getFoods().catch(() => []),
    NtApi.getRecipes().catch(() => []),
  ]);
  return { foods: foods || [], recipes: recipes || [] };
}

/**
 * The client's food (or recipe) for each item, made when they don't have
 * it. Items sharing a source share the one copy.
 */
async function _foodsFor(items) {
  const cat = await _catalog();
  const out = [];
  for (const item of items) {
    let food = findOwn(item, cat);
    if (!food) {
      const { id: _drop, ...rest } = foodFromPlanItem(item);
      food = await NtApi.createFood({ ...rest, created_at: new Date().toISOString() });
      cat.foods = [food, ...cat.foods];
    }
    out.push(food);
  }
  return out;
}

/** Log one meal of an accepted plan (Log This). */
export async function logPlanMeal(rec, mealSlot) {
  const meal = (rec?.payload?.meals || []).find(m => m.meal === mealSlot);
  if (!meal?.items?.length) return 0;
  const { addDiaryItem } = await import('../stores/diary.js');
  const foods = await _foodsFor(meal.items);
  for (let i = 0; i < meal.items.length; i++) {
    await addDiaryItem(planDiaryItem(meal.items[i], foods[i], rec.id), mealSlot, rec.date);
  }
  return meal.items.length;
}

/** Log every meal not logged yet (Log All). */
export async function logPlanAll(rec, logged = new Set()) {
  let n = 0;
  for (const m of rec?.payload?.meals || []) {
    if (!logged.has(m.meal)) n += await logPlanMeal(rec, m.meal);
  }
  return n;
}

/**
 * One item, tapped: the usual add sheet (the Foods page's), filled in with
 * the plan's amount, adding to the plan's day and meal. A food the client
 * doesn't have is made when they add it, as with a search result.
 */
export async function openPlanItem(rec, mealSlot, item) {
  const cat = await _catalog();
  const own = findOwn(item, cat);
  const food = own
    ? { ...own, portion: item.portion, unit: item.unit || 'g', nutrition: { ...(item.nutrition || {}) } }
    : foodFromPlanItem(item);
  editorState.planLog = { food, quantity: item.quantity || 1, source: planMark(rec.id) };
  const { push } = await import('svelte-spa-router');
  push(`/foods?pick=1&meal=${mealSlot}&date=${rec.date}`);
}
