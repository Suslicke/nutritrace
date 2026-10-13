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
/** { role, can_coach, as_client: { id, status, coach, note, ... } | null, as_coach: { pending, active } } */
export const coachingState = writable(null);

/** Android with no server: coaching has nowhere to happen. */
export const coachingNeedsServer = () => isNative && !getServerUrl();

/** Coach tab: someone with a coach or a request waiting for their answer. */
export function showsCoachTab(supported, s) {
  return !!(supported && s?.as_client);
}
/** Clients tab: the Coach role, or an admin who coaches (or asked) someone. */
export function showsClientsTab(supported, s) {
  if (!supported || !s) return false;
  if (s.role === 'coach') return true;
  return s.role === 'admin' && ((Number(s.as_coach?.pending) || 0) + (Number(s.as_coach?.active) || 0)) > 0;
}

export const coachTab = derived([coachingSupported, coachingState], ([$ok, $s]) => showsCoachTab($ok, $s));
export const clientsTab = derived([coachingSupported, coachingState], ([$ok, $s]) => showsClientsTab($ok, $s));
export const inCoaching = derived([coachTab, clientsTab], ([$a, $b]) => $a || $b);

/** The same fingerprint the server sends, from a state the app holds. */
export function coachingSignature(s) {
  if (!s) return null;
  const c = s.as_client ? `${s.as_client.id}.${s.as_client.status}` : '-';
  return `${s.role || '-'};${c};${Number(s.as_coach?.pending) || 0}.${Number(s.as_coach?.active) || 0}`;
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
  if (supported !== undefined) coachingSupported.set(Number(supported) >= 1);
  if (state !== undefined) coachingState.set(state || null);
  _save(userId);
}

export function clearCoaching() {
  coachingSupported.set(false);
  coachingState.set(null);
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
    const state = await NtApi.get('/api/coaching/state');
    coachingState.set(state || null);
    _save(localStorage.getItem('wl:userId'));
  } catch { /* offline: keep what is known */ }
  return get(coachingState);
}

/** The settings refresh brought a fingerprint: ask again only when it moved. */
export function noteCoachingSignature(sig) {
  if (!sig || !get(coachingSupported)) return;
  if (sig === coachingSignature(get(coachingState))) return;
  refreshCoaching();
}

// The Android app shows its first screen before it has asked the server who
// is signed in, so it starts from what this account knew last time; a Coach
// or Clients link opened at launch then lands where it points.
if (isNative) {
  try {
    const uid = localStorage.getItem('wl:userId');
    if (uid && getServerUrl()) loadCachedCoaching(uid);
  } catch { /* private mode */ }
}
