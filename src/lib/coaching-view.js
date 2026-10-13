/**
 * coaching-view.js: small shared helpers for the Coach and Clients screens.
 */

/** A YYYY-MM-DD date in the app's date format (same rules as the Diary). */
export function formatDay(d, fmt) {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  if (Number.isNaN(dt.getTime())) return d;
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dy = String(dt.getDate()).padStart(2, '0');
  if (fmt === 'US') return `${m}/${dy}/${dt.getFullYear()}`;
  if (fmt === 'EU') return `${dy}/${m}/${dt.getFullYear()}`;
  if (fmt === 'natural') return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return d;
}

/** A server timestamp ("YYYY-MM-DD HH:MM:SS", UTC) as a local YYYY-MM-DD. */
export function localDay(ts) {
  if (!ts) return null;
  const dt = new Date(String(ts).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? '' : 'Z'));
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString('sv-SE');
}

/** YYYY-MM-DD, n days from `date`. */
export function shiftDay(date, n) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
}

export const todayLocal = () => new Date().toLocaleDateString('sv-SE');

/** Short weekday for a YYYY-MM-DD. */
export function weekday(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
}

/** kg in the person's weight unit, one decimal. */
export function weightIn(kg, unit) {
  if (kg == null) return null;
  const v = unit === 'lb' ? kg * 2.20462 : kg;
  return Math.round(v * 10) / 10;
}

/** The message for a failed coaching call: offline says so plainly. */
export function coachingErrorText(e, t) {
  if (e?.offline) return t('coaching.needs_connection');
  return e?.message || t('coaching.something_failed');
}

/** The coach's name for a pairing, from where this person stands in coaching. */
export function coachNameFor(state, pairingId) {
  if (!state) return '';
  if (state.as_client?.id === pairingId) return state.as_client.coach?.name || '';
  return (state.past || []).find(p => p.id === pairingId)?.coach?.name || '';
}

/** The targets recommendation the Goals page shows: waiting for an answer,
 *  else one accepted in the last week (Applied, with Undo). */
export function goalsCardRecommendation(recs, now = Date.now()) {
  const targets = (recs || []).filter(r => r.kind === 'targets');
  const pending = targets.find(r => r.status === 'pending');
  if (pending) return pending;
  const week = 7 * 86400000;
  return targets.find(r => r.status === 'accepted' && r.responded_at
    && now - new Date(String(r.responded_at).replace(' ', 'T') + (/[zZ]$/.test(r.responded_at) ? '' : 'Z')).getTime() < week) || null;
}
