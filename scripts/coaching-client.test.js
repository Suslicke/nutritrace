/**
 * Coaching in the app, without a browser:
 *
 * - Which Goals tabs show: none for anyone not in coaching, none on a server
 *   from before coaching, Coach for a client or a request, Clients for the
 *   Coach role and for an admin only once they coach someone.
 * - The fingerprint the app computes matches the server's format, so the
 *   settings refresh asks again only when something changed.
 * - Offline: a coach's list and client views are kept (browser and Android);
 *   where you stand is not kept there (stores/coaching.js keeps the newest
 *   answer itself, and a kept copy would be older than an Accept made since:
 *   found on the emulator), nor the name list or admin pairings.
 * - Every coaching screen string is in en.json, and Users search finds "coach".
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

function fnFrom(src, name) {
  const start = src.indexOf(`export function ${name}`);
  assert.ok(start >= 0, name);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return new Function(`${src.slice(start, i + 1).replace('export ', '')}; return ${name};`)();
}

const store = read('../src/stores/coaching.js');
const coachTab = fnFrom(store, 'showsCoachTab');
const clientsTab = fnFrom(store, 'showsClientsTab');
const signature = fnFrom(store, 'coachingSignature');
const none = { pending: 0, active: 0 };

test('Goals tabs: nothing for people not in coaching', () => {
  for (const role of ['user', 'admin']) {
    const s = { role, can_coach: role === 'admin', as_client: null, as_coach: none };
    assert.equal(coachTab(true, s), false, role);
    assert.equal(clientsTab(true, s), false, role);
  }
  // Single-user mode, Android local mode, an older server: no state or no support.
  assert.equal(clientsTab(true, null), false);
  assert.equal(coachTab(false, { role: 'user', as_client: { id: 1, status: 'pending' }, as_coach: none }), false);
  assert.equal(clientsTab(false, { role: 'coach', as_client: null, as_coach: none }), false);
});

test('Goals tabs: Coach for a client, Clients for coaches', () => {
  assert.equal(coachTab(true, { role: 'user', as_client: { id: 3, status: 'pending' }, as_coach: none }), true);
  assert.equal(coachTab(true, { role: 'user', as_client: { id: 3, status: 'active' }, as_coach: none }), true);
  assert.equal(clientsTab(true, { role: 'coach', as_client: null, as_coach: none }), true, 'a Coach with no clients yet');
  assert.equal(clientsTab(true, { role: 'admin', as_client: null, as_coach: { pending: 1, active: 0 } }), true);
  assert.equal(clientsTab(true, { role: 'admin', as_client: null, as_coach: { pending: 0, active: 2 } }), true);
  // A person can have a coach and be a coach.
  const both = { role: 'coach', as_client: { id: 9, status: 'active' }, as_coach: { pending: 0, active: 1 } };
  assert.equal(coachTab(true, both) && clientsTab(true, both), true);
});

test('the fingerprint has the server\'s shape', () => {
  assert.equal(signature({ role: 'user', as_client: null, as_coach: none }), 'user;-;0.0');
  assert.equal(signature({ role: 'coach', as_client: { id: 12, status: 'pending' }, as_coach: { pending: 2, active: 3 } }), 'coach;12.pending;2.3');
  const server = read('../server/lib/coaching.js');
  assert.match(server, /return `\$\{s\.role \|\| '-'\};\$\{c\};\$\{s\.as_coach\.pending\}\.\$\{s\.as_coach\.active\}`;/);
  assert.match(server, /const c = s\.as_client \? `\$\{s\.as_client\.id\}\.\$\{s\.as_client\.status\}` : '-';/);
});

function keepList(src, re) {
  const body = src.match(re)?.[1];
  assert.ok(body, 'keep list found');
  return new Function(`return [${body}]`)();
}

const KEPT = ['/api/coaching/clients', '/api/coaching/clients?today=2026-10-13', '/api/coaching/clients/7/overview?today=2026-10-13', '/api/coaching/clients/7/diary/2026-10-12'];
const NOT_KEPT = ['/api/coaching/state', '/api/coaching/candidates', '/api/coaching/admin/pairings', '/api/coaching/clients/7/diary/bad', '/api/coaching/clients/7'];

test('offline in the browser: a coach\'s views are kept, where you stand is not', () => {
  const src = read('../src/lib/offline-api.js');
  const res = keepList(src, /const _KEEP_READS = \[([\s\S]*?)\n\];/);
  const kept = (p) => res.some((re) => re.test(p));
  for (const p of KEPT) assert.ok(kept(p), p);
  for (const p of NOT_KEPT) assert.ok(!kept(p), p);
  const readKey = new Function(`${src.match(/const _readKey = [^\n]+/)[0]}; return _readKey;`)();
  assert.equal(readKey('/api/coaching/clients?today=2026-10-13'), '/api/coaching/clients');
  assert.equal(readKey('/api/coaching/clients/7/overview?today=2026-10-13'), '/api/coaching/clients/7/overview');
  assert.equal(readKey('/api/wellness/fitbit/data?date=2026-10-13'), '/api/wellness/fitbit/data?date=2026-10-13', 'other reads keep their key');
  // A former client's copies go.
  assert.match(src, /async forgetCoachingReads\(activeClientIds = \[\]\)/);
  assert.match(read('../src/routes/Clients.svelte'), /NtApi\.forgetCoachingReads\(/);
});

test('offline on Android: the same list, and the server\'s message comes through', () => {
  const src = read('../src/lib/api-cached.js');
  const re = new Function(`return ${src.match(/const _COACH_KEEP = (\/[^\n]+\/);/)[1]}`)();
  for (const p of KEPT) assert.ok(re.test(p), p);
  for (const p of NOT_KEPT) assert.ok(!re.test(p), p);
  assert.match(src, /if \(_COACHING\.test\(path\)\) return _coachingGet\(path\);/);
  assert.match(src, /if \(_COACHING\.test\(path\)\) return _coachingFetch\('POST', path, body\);/);
  assert.match(src, /err\.offline = true;/);
  assert.match(src, /new Error\(data\.error \|\| `API error \$\{res\.status\}`\)/);
  // Local mode answers too, so a caller's .catch is never left with a stub.
  assert.match(read('../src/lib/api-native.js'), /async forgetCoachingReads\(\) \{ return 0; \}/);
});

test('no request or timer for people not in coaching', () => {
  // The state comes with /me, the fingerprint with the settings refresh the
  // app already makes; the store asks again only when the fingerprint moved.
  assert.match(store, /if \(sig === coachingSignature\(get\(coachingState\)\)\) return;/);
  for (const f of ['../src/stores/coaching.js', '../src/routes/Coach.svelte', '../src/routes/Clients.svelte',
    '../src/components/coaching/CoachingTabs.svelte', '../src/components/coaching/ClientDetail.svelte']) {
    assert.doesNotMatch(read(f), /setInterval\(/, f);
  }
  // Goals only adds the tab strip, which renders nothing outside coaching.
  assert.match(read('../src/components/coaching/CoachingTabs.svelte'), /\{#if \$inCoaching \|\| force\}/);
  assert.match(read('../src/stores/settings.js'), /noteCoachingSignature\(res\.headers\.get\('X-NT-Coaching'\)\)/);
  assert.match(read('../server/index.js'), /Access-Control-Expose-Headers', 'X-Request-ID, X-NT-Coaching'/);
});

test('coaching strings live in en.json; Users search finds coaching', () => {
  const en = JSON.parse(read('../src/i18n/en.json'));
  const get = (k) => k.split('.').reduce((o, p) => o?.[p], en);
  const files = ['../src/routes/Coach.svelte', '../src/routes/Clients.svelte', '../src/components/coaching/CoachingTabs.svelte',
    '../src/components/coaching/ClientDetail.svelte', '../src/components/coaching/RequestSheet.svelte',
    '../src/components/coaching/CoachingNeedsServer.svelte', '../src/components/coaching/WeightTrend.svelte',
    '../src/lib/coaching-view.js', '../src/components/settings/SettingsUserManagement.svelte'];
  for (const f of files) {
    for (const [, key] of read(f).matchAll(/\$?_\(\s*'([a-z_]+(?:\.[a-z0-9_]+)+)'/g)) assert.equal(typeof get(key), 'string', `${f}: ${key}`);
  }
  assert.equal(get('coaching.client.request_body'), '{name} will see your diary, your targets, your weight and your foods, meals and recipes.');
  const kw = read('../src/routes/Settings.svelte').match(/users: +\[([^\]]+)\]/)[1];
  for (const w of ['coach', 'coaching', 'client', 'pairing']) assert.match(kw, new RegExp(`'${w}'`));
});
