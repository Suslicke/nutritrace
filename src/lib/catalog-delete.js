// Deletes one item from the Foods page catalogs by the kind it really is.
//
// #282: foods live in one table and meals (recipes included) in another,
// and each table numbers its rows on its own, so meal 1 and food 1 are
// different things. Sending a meal's id to the foods endpoint deleted
// whichever food had that number and left the meal in place. The Foods
// page's deletes (detail pane, long-press menu, Select Multiple) go through
// here so the id always reaches the endpoint for its own table.

const KIND_BY_TAB = { foodList: 'food', meals: 'meal', recipes: 'recipe' };

/** The kind of item a Foods page tab lists ('foodList' | 'meals' | 'recipes'). */
export function catalogKindForTab(tab) {
  return KIND_BY_TAB[tab] || null;
}

/**
 * @param {{ deleteFood: Function, deleteMeal: Function }} api
 * @param {'food'|'meal'|'recipe'} kind
 * @param {number|string} id
 */
export function deleteCatalogItem(api, kind, id) {
  if (kind === 'food') return api.deleteFood(id);
  if (kind === 'meal' || kind === 'recipe') return api.deleteMeal(id);
  // Never guess: an unknown kind could reach the wrong table.
  return Promise.reject(new Error(`Unknown item kind: ${kind}`));
}
