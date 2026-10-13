/**
 * coaching.js: where the signed-in person stands in coaching, and which
 * Goals tabs that gives them.
 *
 *   Coach tab    anyone with a coach or a request waiting for an answer
 *   Clients tab  anyone with the Coach role, and an admin who coaches someone
 *
 * Everyone else sees Goals exactly as before: no tabs, no requests, no
 * timers. The state arrives with /api/auth/me, which the app loads anyway,
 * and the settings refresh it already makes carries a short fingerprint
 * (X-NT-Coaching); the state is asked for again only when that changes.
 * A server from before coaching reports no support, and the tabs stay away.
 */
import { writable, derived, get } from 'svelte/store';
import { isNative, getServerUrl } from '../lib/platform.js';

const KEY = 'nt:coaching';

/** The server knows coaching (its /api/auth/status says so). */
export const coachingSupported = writable(false);
/** { role, can_coach, as_client: active pairing | null, requests: [{ id, coach, note, requested_at }], as_coach: { pending, active, recent } } */
export const coachingState = writable(null);

/** Android with no server: coaching has nowhere to happen. */
export const coachingNeedsServer = () => isNative && !getServerUrl();

/** Coach tab: someone with a coach, a request waiting for their answer, or
 *  a past coach's conversation (it stays readable for the client). */
export function showsCoachTab(supported, s) {
  return !!(supported && (s?.as_client || s?.requests?.length || s?.past?.length));
}

/** The dot on Goals: unread messages, or something waiting for an answer. */
export function showsBadge(supported, s) {
  return !!(supported && s && ((Number(s.unread) || 0) > 0 || (Number(s.awaiting) || 0) > 0));
}
/** Clients tab: the Coach role, or an admin who coaches (or asked) someone. */
export function showsClientsTab(supported, s) {
  if (!supported || !s) return false;
  if (s.role === 'coach') return true;
  // An admin keeps the tab for a week after an answer, so a declined request
  // or a client who left is seen there, as a Coach sees it.
  const c = s.as_coach || {};
  return s.role === 'admin' && ((Number(c.pending) || 0) + (Number(c.active) || 0) + (Number(c.recent) || 0)) > 0;
}

export const coachTab = derived([coachingSupported, coachingState], ([$ok, $s]) => showsCoachTab($ok, $s));
export const clientsTab = derived([coachingSupported, coachingState], ([$ok, $s]) => showsClientsTab($ok, $s));
export const inCoaching = derived([coachTab, clientsTab], ([$a, $b]) => $a || $b);
export const coachingBadge = derived([coachingSupported, coachingState], ([$ok, $s]) => showsBadge($ok, $s));
/** Unread on the Coach tab (as a client) and the Clients tab (as a coach). */
export const coachUnread = derived(coachingState, ($s) => (Number($s?.as_client?.unread) || 0) + ($s?.past || []).reduce((n, p) => n + (Number(p.unread) || 0), 0));
export const clientsUnread = derived(coachingState, ($s) => Number($s?.as_coach?.unread) || 0);

/** The same fingerprint the server sends, from a state the app holds. */
export function coachingSignature(s) {
  if (!s) return null;
  const c = s.as_client ? String(s.as_client.id) : '-';
  const r = (s.requests || []).map(x => x.id).join(',') || '-';
  const p = (s.past || []).map(x => x.id).join(',') || '-';
  return `${s.role || '-'};${c};${r};${Number(s.as_coach?.pending) || 0}.${Number(s.as_coach?.active) || 0};${p};${Number(s.unread) || 0}`;
}

function _save(userId) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ user: userId ?? null, supported: get(coachingSupported), state: get(coachingState) }));
  } catch { /* private mode */ }
}

/** What the last session knew, for an app opened with no connection. */
export function loadCachedCoaching(userId) {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (kept && kept.user != null && String(kept.user) === String(userId)) {
      coachingSupported.set(!!kept.supported);
      coachingState.set(kept.state || null);
      return;
    }
  } catch { /* nothing kept */ }
  coachingSupported.set(false);
  coachingState.set(null);
}

/** From /api/auth/status and /api/auth/me. `supported` undefined leaves it as is. */
export function setCoachingFromServer({ supported, state, userId }) {
  const before = _lastSaved(userId);
  if (supported !== undefined) coachingSupported.set(Number(supported) >= 1);
  if (state !== undefined) coachingState.set(state || null);
  _save(userId);
  if (state !== undefined) _forgetFormerClients(before, state || null);
  // Someone in coaching opening the app: anything written offline goes now.
  if (state && (showsCoachTab(true, state) || showsClientsTab(true, state))) {
    import('../lib/coach-messages.js').then(m => m.flushCoachMessages()).catch(() => {});
  }
}

/** The state this account last saved on this device (survives a reload). */
function _lastSaved(userId) {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) || 'null');
    return kept && String(kept.user) === String(userId) ? kept.state : null;
  } catch { return null; }
}

export function clearCoaching() {
  coachingSupported.set(false);
  coachingState.set(null);
  import('../lib/coach-photos.js').then(m => m.clearCoachPhotos()).catch(() => {});
  try {
    localStorage.removeItem(KEY);
    // The Android app's copies of a coach's views (lib/api-cached.js).
    for (const k of Object.keys(localStorage)) if (k.startsWith('nt:coach-read:')) localStorage.removeItem(k);
  } catch { /* private mode */ }
}

/** Ask the server again (only for people in coaching, or when the fingerprint changed). */
export async function refreshCoaching() {
  if (!get(coachingSupported) || coachingNeedsServer()) return get(coachingState);
  try {
    const { NtApi } = await import('../lib/api.js');
    const before = _lastSaved(localStorage.getItem('wl:userId')) || get(coachingState);
    const state = await NtApi.get('/api/coaching/state');
    coachingState.set(state || null);
    _save(localStorage.getItem('wl:userId'));
    await _forgetFormerClients(before, state);
  } catch { /* offline: keep what is known */ }
  return get(coachingState);
}

/**
 * A client left or was taken away: the copies of their views kept for a dead
 * zone go now, not when the Clients list is next opened online.
 */
async function _forgetFormerClients(before, now) {
  const was = Number(before?.as_coach?.active) || 0;
  const is = Number(now?.as_coach?.active) || 0;
  if (!(is < was) && (now?.can_coach || !was)) return;
  try {
    const { NtApi } = await import('../lib/api.js');
    let keep = [];
    if (now?.can_coach && is > 0) {
      const rows = await NtApi.get(`/api/coaching/clients?today=${new Date().toLocaleDateString('sv-SE')}`);
      keep = rows.filter(r => r.status === 'active').map(r => r.client.id);
    }
    await NtApi.forgetCoachingReads(keep);
  } catch { /* offline: the next list load tidies up */ }
}

/** The settings refresh brought a fingerprint: ask again only when it moved. */
export function noteCoachingSignature(sig) {
  if (!sig || !get(coachingSupported)) return;
  if (sig === coachingSignature(get(coachingState))) return;
  refreshCoaching();
}

// The Android app shows its first screen before it has asked the server who
// is signed in, so it starts from what this account knew last time; a Coach
// or Clients link opened at launch then opens where it points.
if (isNative) {
  try {
    const uid = localStorage.getItem('wl:userId');
    if (uid && getServerUrl()) loadCachedCoaching(uid);
  } catch { /* private mode */ }
}

// Messages written in the browser with no connection go when it comes back,
// or when the app is opened again. Only waiting messages make a request.
if (typeof window !== 'undefined' && !isNative) {
  const flush = () => import('../lib/coach-messages.js').then(m => m.flushCoachMessages()).catch(() => {});
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
}
