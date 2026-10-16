/**
 * item-source.js: which food, meal or recipe a diary item was logged from.
 *
 * Items carry two ids. food_server_id is the server's id of the source row.
 * id is whatever the logging device used: the server's id on the web, the
 * phone's own row id in the Android app. food_server_id null (the key there,
 * the value null) means the item was logged on a phone before its source
 * reached the server, so its id is that phone's own and means nothing
 * anywhere else. The phone fills food_server_id in once the source syncs.
 * Items from before food_server_id existed have no key, and keep their old
 * reading: id is the server's on the web, the phone's own on a phone.
 *
 * Returns { serverId } or { localId, unsent } (a row of this device's own
 * database), or null when the item names no row this device can find.
 */
export function itemSourceRef(item, { native = false } = {}) {
  if (!item || typeof item !== 'object') return null;
  const fsid = item.food_server_id;
  if (typeof fsid === 'number') return { serverId: fsid };
  if (typeof item.id !== 'number') return null;
  if (fsid === null) return native ? { localId: item.id, unsent: true } : null;
  return native ? { localId: item.id, unsent: false } : { serverId: item.id };
}

const _norm = s => String(s || '').trim().toLowerCase();

/**
 * The photo of the food, meal or recipe a diary item (or a meal's
 * ingredient) came from, out of the catalogue this device has loaded
 * (Foods: Yesterday's Meals and a meal's items), found the way the diary
 * finds it (server/lib/diary-helpers.js freshenItemImages, db-native.js
 * _freshenItemImages): a recipe among meals and recipes, anything else
 * among foods; by its source's id with the same name first, then by name
 * and brand (foods only), then by name. Names are trimmed and compared
 * case-insensitively, and only rows with a photo count. Falls back to the
 * item's own imgUrl.
 * catalogue: { foods, meals } (meals with the recipes); native: the rows
 * are the Android app's (their server id in server_id); mine: the
 * phone's install ids (db-native.js dbOwnInstallIds).
 */
export function catalogImgFor(item, { foods = [], meals = [] } = {}, { native = false, mine = null } = {}) {
  if (!item || typeof item !== 'object') return '';
  const pool = (item.is_recipe ? meals : foods).filter(f => f && f.imgUrl);
  const name = _norm(item.name), brand = _norm(item.brand);
  const ref = itemSourceRef(item, { native });
  // A browser's rows carry the server's id as id; the phone's, as server_id.
  const serverIdOf = f => ('server_id' in f ? f.server_id : f.id);
  let m = null;
  if (ref?.serverId != null) m = pool.find(f => serverIdOf(f) === ref.serverId && _norm(f.name) === name);
  // The phone's own id: an item logged before its row went up names only
  // a row still waiting to go up, and only on the phone that logged it
  // (`mine`, this database's install ids, when known).
  else if (ref?.localId != null && !(ref.unsent && item.food_device && !mine?.has(item.food_device))) {
    m = pool.find(f => f.id === ref.localId && _norm(f.name) === name && (!ref.unsent || f.server_id == null));
  }
  if (!m && name) {
    if (!item.is_recipe) m = pool.find(f => _norm(f.name) === name && _norm(f.brand) === brand);
    if (!m) m = pool.find(f => _norm(f.name) === name);
  }
  return m?.imgUrl || item.imgUrl || '';
}

/**
 * The phone's foods, meals and recipes are going up to a server as new
 * rows (Connect > Upload or Merge, Push all from this device), so the
 * server ids they had stop naming them. This points each diary item whose
 * source is one of them at it again: by its new server id where that is
 * known, otherwise as an item logged before its row went up (the phone's
 * own id, food_server_id null, food_device this install), which the sync
 * links once the row has gone up (db-native.js dbLinkDiaryItems).
 *
 * An item names one of the rows by its server id (food_server_id against
 * the server id the row has had until now), or by the phone's own id: one
 * logged on this phone before its row went up (food_device one of this
 * database's install ids), or an untagged or older item of the same name.
 * An item of another phone's, or whose source isn't one of the rows, is
 * left as it is. Running it again gives the same items.
 *
 * rows: { foods, meals }, each [{ id, server_id, name }], the phone's rows
 *   going up, with the server ids they have had until now.
 * newIds: { foods, meals }, each a Map or [[phone id, new server id]].
 * install: this install's id. mine: this database's install ids (a Set).
 * Returns { items, changed }.
 */
export function relinkItems(items, { rows = {}, newIds = {}, install = null, mine = new Set() } = {}) {
  if (!Array.isArray(items)) return { items, changed: false };
  const pools = {};
  for (const t of ['foods', 'meals']) {
    const byServer = new Map(), byId = new Map();
    for (const r of rows[t] || []) {
      if (!r || typeof r.id !== 'number') continue;
      byId.set(r.id, r);
      if (typeof r.server_id === 'number') byServer.set(r.server_id, r);
    }
    pools[t] = { byServer, byId, next: new Map(newIds[t] || []) };
  }
  const sourceRow = it => {
    const p = pools[it.is_recipe ? 'meals' : 'foods'];
    const ref = itemSourceRef(it, { native: true });
    if (!ref) return null;
    if (ref.serverId != null) return p.byServer.get(ref.serverId) || null;
    if (it.food_device) return mine.has(it.food_device) ? p.byId.get(ref.localId) || null : null;
    // Untagged, or from before food_server_id: the id is this phone's own
    // or, for an older item logged in the browser, the server's. Only a
    // row of the same name is taken for it.
    const same = r => (r && _norm(r.name) === _norm(it.name) ? r : null);
    return same(p.byId.get(ref.localId)) || (ref.unsent ? null : same(p.byServer.get(ref.localId)));
  };
  let changed = false;
  const walk = list => {
    let hit = false;
    const out = list.map(it => {
      if (!it || typeof it !== 'object') return it;
      let next = it;
      const row = sourceRow(it);
      if (row) {
        const sid = pools[it.is_recipe ? 'meals' : 'foods'].next.get(row.id);
        if (sid != null) {
          if (it.food_server_id !== sid || 'food_device' in it) {
            const { food_device: _d, ...rest } = it;
            next = { ...rest, food_server_id: sid };
          }
        } else if (!(it.food_server_id === null && it.id === row.id && it.food_device === install)) {
          next = { ...it, id: row.id, food_server_id: null, food_device: install };
        }
      }
      if (Array.isArray(next._splitItems)) {
        const kids = walk(next._splitItems);
        if (kids !== next._splitItems) next = { ...next, _splitItems: kids };
      }
      if (next !== it) hit = true;
      return next;
    });
    if (!hit) return list;
    changed = true;
    return out;
  };
  return { items: walk(items), changed };
}
