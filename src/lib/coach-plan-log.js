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
import { findOwn, foodFromPlanItem, planDiaryItem, planMark, itemKey } from './coach-plans.js';

/**
 * The client's own catalog, as the Foods page reads it (offline, the copy
 * kept on the device). A failed read stops here: with no catalog every item
 * would look new and be copied again.
 */
async function _catalog() {
  const [foods, recipes] = await Promise.all([NtApi.getFoods(), NtApi.getRecipes()]);
  return { foods: foods || [], recipes: recipes || [] };
}

/**
 * Log one meal of an accepted plan (Log This): its items not logged yet
 * (`logged`: "<meal>.<n>" keys). A food the client doesn't have is made
 * first; items sharing a source share the one copy.
 */
export async function logPlanMeal(rec, mealSlot, logged = new Set()) {
  const meal = (rec?.payload?.meals || []).find(m => m.meal === mealSlot);
  const todo = (meal?.items || []).map((item, i) => ({ item, i })).filter(({ i }) => !logged.has(itemKey(mealSlot, i)));
  if (!todo.length) return 0;
  const { addDiaryItem } = await import('../stores/diary.js');
  const cat = await _catalog();
  for (const { item, i } of todo) {
    let food = findOwn(item, cat);
    if (!food) {
      food = await NtApi.createFood({ ...foodFromPlanItem(item), created_at: new Date().toISOString() });
      cat.foods = [food, ...cat.foods];
    }
    await addDiaryItem(planDiaryItem(item, food, rec.id, mealSlot, i), mealSlot, rec.date);
  }
  return todo.length;
}

/** Log every item not logged yet (Log All). */
export async function logPlanAll(rec, logged = new Set()) {
  let n = 0;
  for (const m of rec?.payload?.meals || []) n += await logPlanMeal(rec, m.meal, logged);
  return n;
}

/**
 * One item, tapped: the usual add sheet (the Foods page's), filled in with
 * the plan's amount, adding to the plan's day and meal. A food the client
 * doesn't have is made when they add it, as with a search result.
 */
export async function openPlanItem(rec, mealSlot, index, item) {
  const cat = await _catalog();
  const own = findOwn(item, cat);
  const food = own
    ? { ...own, portion: item.portion, unit: item.unit || 'g', nutrition: { ...(item.nutrition || {}) } }
    : foodFromPlanItem(item);
  editorState.planLog = { food, quantity: item.quantity || 1, source: planMark(rec.id, mealSlot, index) };
  const { push } = await import('svelte-spa-router');
  push(`/foods?pick=1&meal=${mealSlot}&date=${rec.date}`);
}
