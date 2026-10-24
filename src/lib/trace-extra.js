// Fork-only Trace tool (Suslicke/nutritrace): `app_api` lets Trace make any change the user can
// make in the app — create meals, edit or delete foods, rewrite a diary day — by calling the same
// REST API the web app calls, with the signed-in user's own session. Kept in its own file, wired
// into Trace.svelte like coach-trace.js, so upstream merges touch as few lines as possible.
// Account, server and backup administration stays in Settings, never through the assistant.
const DENY = ['/api/auth', '/api/admin', '/api/app-config', '/api/oidc', '/api/full-backup',
  '/api/updates', '/api/data', '/api/mcp', '/api/v1', '/api/ai'];

export const EXTRA_TOOLS = [
  {
    name: 'app_api',
    description:
      'Call any NutriTrace REST endpoint as the user (full create/edit/delete, same as the app). ' +
      'Foods: GET/POST /api/foods, GET/PUT/DELETE /api/foods/{id} (nutrition is per `portion` `unit`). ' +
      'Meals (saved sets of foods): GET/POST /api/meals, GET/PUT/DELETE /api/meals/{id}; body {name, items: [food object + ' +
      'portion, unit, quantity: 1, nutrition scaled to that amount], nutrition: sum of the items, is_recipe: false}. ' +
      'Diary: GET /api/diary/{YYYY-MM-DD}; PUT /api/diary/{date} replaces the whole day, so GET it first, change it, PUT it back. ' +
      'Also /api/settings, /api/activity, /api/fasts. Before a DELETE or a PUT that replaces data, say what will change ' +
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

export function allowedPath(path) {
  return typeof path === 'string' && path.startsWith('/api/') && !path.includes('..')
    && !DENY.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));
}

/** Result for an EXTRA_TOOLS call, or null when the tool isn't one of ours. */
export async function runExtraTool(name, args = {}) {
  if (name !== 'app_api') return null;
  const method = String(args.method || 'GET').toUpperCase();
  if (!allowedPath(args.path)) return { error: 'This path is not available to the assistant.' };
  try {
    const { NtApi } = await import('./api.js'); // lazy: keeps this module loadable in node tests
    const body = args.body ?? {};
    const data = method === 'GET' ? await NtApi.get(args.path)
      : method === 'POST' ? await NtApi.post(args.path, body)
      : method === 'PUT' ? await NtApi.put(args.path, body)
      : method === 'PATCH' ? await NtApi.patch(args.path, body)
      : method === 'DELETE' ? await NtApi.del(args.path)
      : null;
    return { ok: true, data };
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}
