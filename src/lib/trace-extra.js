// Fork-only Trace tool (Suslicke/nutritrace): `app_api` lets Trace make any change the user can
// make in the app — create meals, edit or delete foods, rewrite a diary day — by calling the same
// REST API the web app calls, with the signed-in user's own session. Kept in its own file, wired
// into Trace.svelte like coach-trace.js, so upstream merges touch as few lines as possible.
// Allowlist, not a denylist: a new upstream admin route must not become reachable by itself.
// Account, server and backup administration stays in Settings, never through the assistant.
const ALLOW = ['/api/foods', '/api/meals', '/api/diary', '/api/activity', '/api/fasts', '/api/settings', '/api/goals'];

export const EXTRA_TOOLS = [
  {
    name: 'app_api',
    description:
      'Call any NutriTrace REST endpoint as the user (full create/edit/delete, same as the app). ' +
      'Foods: GET/POST /api/foods, GET/PUT/DELETE /api/foods/{id} (nutrition is per `portion` `unit`). ' +
      'Meals (saved sets of foods): GET/POST /api/meals, GET/PUT/DELETE /api/meals/{id}; body {name, items: [food object + ' +
      'portion, unit, quantity: 1, nutrition scaled to that amount], nutrition: sum of the items, is_recipe: false}. ' +
      'Diary: GET /api/diary/{YYYY-MM-DD}; PUT /api/diary/{date} replaces the whole day, so GET it first, change it, PUT it back. ' +
      'Also /api/settings, /api/activity, /api/fasts, /api/goals (nothing else is reachable). Before a DELETE or a PUT that replaces data, say what will change ' +
      'and ask the user to confirm unless they already asked for exactly that.',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        path:   { type: 'string', description: 'Starts with /api/, may include a query string' },
        body:   { type: 'object', description: 'JSON body for POST/PUT/PATCH' },
      },
      required: ['method', 'path'],
    },
  },
];

/** The normalized path + query to send, or null. Checked after URL parsing so encodings,
 * duplicate slashes and dot segments can't reach a route the allowlist doesn't name. */
export function allowedPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/api/') || /%2e|%2f|%5c|\\|\/\/|\/\.\.?(\/|$|\?)/i.test(path)) return null;
  let u;
  try { u = new URL(path, 'http://x'); } catch { return null; }
  if (u.origin !== 'http://x') return null;
  let p;
  try { p = decodeURIComponent(u.pathname); } catch { return null; }
  if (p !== u.pathname || p !== path.split('?')[0]) return null;  // nothing encoded or rewritten in the path
  return ALLOW.some(a => p === a || p.startsWith(a + '/')) ? p + u.search : null;
}

/** Result for an EXTRA_TOOLS call, or null when the tool isn't one of ours. */
export async function runExtraTool(name, args = {}) {
  if (name !== 'app_api') return null;
  const method = String(args.method || 'GET').toUpperCase();
  const path = allowedPath(args.path);
  if (!path) return { error: 'This path is not available to the assistant (foods, meals, diary, activity, fasts, settings, goals only).' };
  try {
    const { NtApi } = await import('./api.js'); // lazy: keeps this module loadable in node tests
    const body = args.body ?? {};
    const data = method === 'GET' ? await NtApi.get(path)
      : method === 'POST' ? await NtApi.post(path, body)
      : method === 'PUT' ? await NtApi.put(path, body)
      : method === 'PATCH' ? await NtApi.patch(path, body)
      : method === 'DELETE' ? await NtApi.del(path)
      : null;
    return { ok: true, data };
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}
