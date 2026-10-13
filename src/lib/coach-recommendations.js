/**
 * coach-recommendations.js: what a coach recommended to this person, on
 * this device, and their answer.
 *
 * Accepting targets changes the person's own goals here (the Goals settings,
 * which sync like any edit, so it works with no connection): first their
 * goals as they are now are saved as a template, "Before coach change,
 * <date>", then only the recommended values are written. Undo applies that
 * template. The answer itself waits on the device and goes to the server
 * when it can (the coach sees Accepted or Declined).
 *
 * Kept on the device: the browser's offline database and the Android app's
 * SQLite, like the conversation.
 */
import { get } from 'svelte/store';
import { isNative } from './platform.js';
import { NtApi } from './api.js';
import { goals as goalsStore, goalTemplates, calorieGoalMode, waterGoalMl } from '../stores/settings.js';
import { applyTargets, beforeTemplate } from './coach-targets.js';

async function _store() {
  if (isNative) {
    const n = await import('./db-native.js');
    return {
      list: () => n.dbCoachRecommendations(),
      upsert: (rows) => n.dbUpsertCoachRecommendations(rows),
      keep: (ids) => n.dbKeepCoachRecommendations(ids),
      answer: (id, status, note) => n.dbAnswerCoachRecommendation(id, status, note),
      pending: () => n.dbPendingCoachAnswers(),
    };
  }
  const { coachStore: s } = await import('./offline-api.js');
  const all = async () => (await s.all('coach_recommendations')) || [];
  return {
    list: async () => (await all()).filter(r => !r.deleted_at)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id),
    upsert: async (rows) => {
      const mine = new Map((await all()).map(r => [r.id, r]));
      const put = rows.filter(r => r?.id != null && !(mine.get(r.id)?.sync_status === 'pending' && r.status === 'pending'))
        .map(r => ({ ...r, sync_status: 'synced' }));
      if (put.length) await s.put('coach_recommendations', put);
    },
    keep: async (ids) => {
      const keep = new Set((ids || []).map(Number));
      const gone = (await all()).filter(r => !keep.has(r.id) && r.sync_status !== 'pending').map(r => r.id);
      if (gone.length) await s.del('coach_recommendations', gone);
    },
    answer: async (id, status, note) => {
      const r = (await all()).find(x => x.id === id);
      if (r) await s.put('coach_recommendations', [{ ...r, status, response_note: note || null, responded_at: new Date().toISOString(), sync_status: 'pending' }]);
    },
    pending: async () => (await all()).filter(r => r.sync_status === 'pending').map(r => ({ id: r.id, status: r.status, response_note: r.response_note })),
  };
}

/** What this device holds, newest first. */
export async function loadRecommendations() {
  return (await _store()).list();
}

/** Ask the server for this person's recommendations (they're in coaching). */
export async function refreshRecommendations() {
  const rows = await NtApi.get('/api/coaching/recommendations');
  const store = await _store();
  await store.upsert(rows || []);
  await store.keep((rows || []).map(r => r.id));
  return store.list();
}

/** Recommendations that came with the Android sync. */
export async function storeSyncedRecommendations(rows) {
  if (rows?.length) await (await _store()).upsert(rows);
}

let _flushing = null;
/** Send answers made on this device. One the server can no longer take
 *  (replaced, withdrawn) takes the server's word for its status. */
export function flushAnswers() {
  if (_flushing) return _flushing;
  _flushing = (async () => {
    const store = await _store();
    let sent = 0, offline = false;
    for (const a of await store.pending()) {
      try {
        const row = await NtApi.post(`/api/coaching/recommendations/${a.id}/answer`, { status: a.status, response_note: a.response_note || undefined });
        await store.upsert([row]);
        sent++;
      } catch (e) {
        const status = Number(e?.status) || 0;
        if (e?.offline || !status || status >= 500) { offline = true; break; }
        // Refused for good: the server says what it is now.
        try {
          const rows = await NtApi.get('/api/coaching/recommendations');
          const now = (rows || []).find(r => r.id === a.id);
          if (now) await store.upsert([{ ...now }]);
        } catch { offline = true; break; }
      }
    }
    if (sent && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nt:coach-recommendations'));
    return { sent, offline };
  })().finally(() => { _flushing = null; });
  return _flushing;
}

const _templateName = (t, date) => t('coaching.targets.template_name', { values: { date } });

/**
 * Accept targets: save goals as they are as a template, write the
 * recommended values, then record the answer (sent now, or later).
 * `t` is the i18n function, for the template's name.
 */
export async function acceptTargets(rec, { note = '', t, date = new Date().toLocaleDateString() } = {}) {
  const current = get(goalsStore) || {};
  const mode = get(calorieGoalMode) || 'fixed';
  const tpl = beforeTemplate({ goals: current, mode, waterGoalMl: get(waterGoalMl), name: _templateName(t, date), recommendationId: rec.id });
  goalTemplates.update(list => [...(list || []).filter(x => x.coachRecommendationId !== rec.id), tpl]);
  const next = applyTargets(current, mode, rec.payload);
  goalsStore.set(next.goals);
  if (next.mode !== mode) calorieGoalMode.set(next.mode);
  await (await _store()).answer(rec.id, 'accepted', note);
  const r = await flushAnswers().catch(() => ({ offline: true }));
  return { template: tpl, offline: !!r?.offline };
}

/** Decline (with an optional note). Nothing else changes. */
export async function declineTargets(rec, { note = '' } = {}) {
  await (await _store()).answer(rec.id, 'declined', note);
  const r = await flushAnswers().catch(() => ({ offline: true }));
  return { offline: !!r?.offline };
}

/** The template Accept saved for this recommendation, if it's still there. */
export function templateFor(rec) {
  return (get(goalTemplates) || []).find(x => x.coachRecommendationId === rec?.id) || null;
}

/** Undo: apply the template Accept saved (it stays in Goals, Templates). */
export function undoTargets(rec) {
  const tpl = templateFor(rec);
  if (!tpl) return false;
  goalsStore.set(JSON.parse(JSON.stringify(tpl.goals || {})));
  if (tpl.waterGoalMl != null) waterGoalMl.set(tpl.waterGoalMl);
  if (tpl.calorieGoalMode) calorieGoalMode.set(tpl.calorieGoalMode);
  return true;
}
