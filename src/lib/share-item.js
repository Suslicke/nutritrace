/**
 * share-item.js: one food, meal or recipe's sharing, from its editor. The
 * same choice Bulk Share makes for a whole category (Private, Everyone,
 * Specific People), through the server's existing per-item routes
 * (PATCH /api/foods/:id/share, /api/meals/:id/share). Sharing lives on the
 * server, so it needs a connection; on Android the item needs its server id
 * (it has one once it has synced).
 */
import { NtApi } from './api.js';
import { serverIdOf } from './coach-plans.js';

export const SHARE_CHOICES = ['private', 'group', 'specific'];

function _sid(item) {
  const sid = serverIdOf(item);
  if (sid == null) { const e = new Error('not synced'); e.code = 'not_synced'; throw e; }
  return sid;
}

/** Who can see it now: { visibility, user_ids }, and who it could go to. */
export async function loadShare(kind, item) {
  const sid = _sid(item);
  const [row, users] = await Promise.all([NtApi.get(`/api/${kind}/${sid}`), NtApi.get('/api/auth/users/list')]);
  return {
    visibility: SHARE_CHOICES.includes(row?.visibility) ? row.visibility : 'private',
    user_ids: Array.isArray(row?._specific_users) ? row._specific_users : [],
    users: Array.isArray(users) ? users : [],
  };
}

/** Set who can see it. */
export async function saveShare(kind, item, visibility, userIds) {
  const sid = _sid(item);
  return NtApi.patch(`/api/${kind}/${sid}/share`, { visibility, user_ids: visibility === 'specific' ? userIds : [] });
}
