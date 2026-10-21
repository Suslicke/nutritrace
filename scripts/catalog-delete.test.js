/**
 * #282: deleting a meal from the Foods page's desktop pane sent the meal's id
 * to DELETE /api/foods/:id, which hid whichever food had that number and left
 * the meal. Deletes on the Foods page now pick the endpoint by what the item
 * is. Unit checks of the picker, plus text checks of the wiring (no browser).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deleteCatalogItem, catalogKindForTab } from '../src/lib/catalog-delete.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const sheet = read('../src/components/ui/FoodDetailSheet.svelte');
const foods = read('../src/routes/Foods.svelte');
const confirmStore = read('../src/stores/confirmDialog.js');
const en = JSON.parse(read('../src/i18n/en.json'));

function fakeApi() {
  const calls = [];
  return {
    calls,
    deleteFood: async id => { calls.push(['food', id]); return { ok: true }; },
    deleteMeal: async id => { calls.push(['meal', id]); return { ok: true }; },
  };
}

test('a meal or recipe is deleted as a meal, a food as a food', async () => {
  for (const [kind, table] of [['food', 'food'], ['meal', 'meal'], ['recipe', 'meal']]) {
    const api = fakeApi();
    await deleteCatalogItem(api, kind, 1);
    assert.deepEqual(api.calls, [[table, 1]], kind);
  }
});

test('an unknown kind deletes nothing and fails', async () => {
  for (const kind of [undefined, null, '', 'foodList', 'meals']) {
    const api = fakeApi();
    await assert.rejects(deleteCatalogItem(api, kind, 1));
    assert.deepEqual(api.calls, [], String(kind));
  }
});

test('each Foods tab maps to the kind it lists', () => {
  assert.equal(catalogKindForTab('foodList'), 'food');
  assert.equal(catalogKindForTab('meals'), 'meal');
  assert.equal(catalogKindForTab('recipes'), 'recipe');
  assert.equal(catalogKindForTab('nope'), null);
});

test('the detail sheet deletes by its kind, never always as a food', () => {
  assert.match(sheet, /export let kind = 'food';/);
  assert.match(sheet, /await deleteCatalogItem\(NtApi, itemKind, target\.id\)/);
  assert.doesNotMatch(sheet, /NtApi\.deleteFood\(/);
});

test('the desktop pane tells the sheet what it shows', () => {
  const pane = foods.match(/<FoodDetailSheet\s+embedded=\{true\}[\s\S]*?\/>/);
  assert.ok(pane, 'pane FoodDetailSheet found');
  assert.match(pane[0], /kind=\{_paneKind\}/);
  assert.match(foods, /_paneKind = 'meal'; _paneFood = food;/);
  assert.match(foods, /_paneKind = 'recipe'; _paneFood = food;/);
  assert.match(foods, /_paneKind = 'food';\s+_paneFood = food;/);
});

test('every item put in the pane comes with its kind', () => {
  const sets = [...foods.matchAll(/([\s\S]{0,60})\b_paneFood = (?!null)/g)];
  assert.ok(sets.length >= 3);
  for (const m of sets) assert.match(m[1], /_paneKind = '(food|meal|recipe)';\s*$/, m[0]);
});

test("someone else's shared item offers no Delete in the sheet", () => {
  assert.match(sheet, /\$: _canDelete = !!_displayFood\?\.id && _displayFood\?\._shared_by == null;/);
  assert.match(sheet, /if \(!_canDelete\) return;/);
  const buttons = [...sheet.matchAll(/\{#if _canDelete\}\s*<button class="btn btn-secondary danger-btn"/g)];
  assert.equal(buttons.length, (sheet.match(/danger-btn"/g) || []).length, 'every Delete button is gated');
});

test('Select Multiple deletes each item by its kind too', () => {
  const fn = foods.match(/async function confirmBulkDelete\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /deleteCatalogItem\(NtApi, catalogKindForTab\(store\), id\)/);
});

test('the long-press Delete reports a failed delete instead of staying silent', () => {
  const fn = foods.match(/async function deleteItem\(item\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /deleteCatalogItem\(NtApi, catalogKindForTab\(currentStore\), item\.id\)/);
  assert.match(fn, /catch \(e\) \{\s+showError\(/);
  assert.ok(fn.indexOf('return;') < fn.indexOf("showSuccess("), 'no success toast after a failure');
});

test('the confirm dialog gets option names it understands, so the button says Delete', () => {
  const sig = confirmStore.match(/export function confirmDialog\(\{([\s\S]*?)\}\s*=/)[1];
  const accepted = [...sig.matchAll(/(\w+)\s*=/g)].map(m => m[1]);
  const call = sheet.match(/confirmDialog\(\{([\s\S]*?)\}\);/)[1];
  const passed = [...call.matchAll(/^\s*(\w+):/gm)].map(m => m[1]);
  for (const name of passed) assert.ok(accepted.includes(name), `confirmDialog does not take ${name}`);
  assert.ok(passed.includes('confirmText'));
});

test('meal and recipe wording exists in English', () => {
  const d = en.foods.detail;
  for (const k of ['delete_meal_aria', 'delete_meal_confirm_title', 'delete_meal_confirm_body', 'meal_deleted',
    'delete_recipe_aria', 'delete_recipe_confirm_title', 'delete_recipe_confirm_body', 'recipe_deleted']) {
    assert.equal(typeof d[k], 'string', k);
  }
  assert.match(d.delete_meal_confirm_title, /meal/);
  assert.match(d.delete_recipe_confirm_title, /recipe/);
});
