/**
 * Coaching recommendations: a coach suggests, the client answers.
 *
 * Only Accepted changes anything, and that happens on the client's device
 * (their goals are their settings; the device applies the recommendation
 * and syncs it like any other change, so it also works offline). The server
 * keeps the recommendation and its answer: the history both sides see.
 *
 * Kinds: 'targets' now; day plans, meals and recipes reuse this table.
 */
import crypto from 'crypto';
import db from '../db.js';
import { logger } from '../logger.js';
import { personName } from './coaching.js';
import { pushNotifyDefaultOn } from './push-notify.js';
import { cleanTargetsPayload } from '../../src/lib/coach-targets.js';

export const NOTE_MAX = 500;
const _json = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const _note = (v) => { const s = typeof v === 'string' ? v.trim() : ''; return s ? s.slice(0, NOTE_MAX) : null; };
const _name = (id) => personName(db.prepare('SELECT full_name, username FROM users WHERE id = ?').get(id)) || 'Someone';

function _bad(message, status = 400) { const e = new Error(message); e.status = status; return e; }

/** A recommendation as the app sees it (ids only, the payload parsed). */
export function recommendationOut(r) {
  if (!r) return null;
  return {
    id: r.id, pairing_id: r.pairing_id, coach_id: r.coach_id, client_id: r.client_id,
    kind: r.kind, date: r.date || null, payload: _json(r.payload, {}), note: r.note || null,
    status: r.status, response_note: r.response_note || null,
    created_at: r.created_at, responded_at: r.responded_at || null, updated_at: r.updated_at,
  };
}

const _row = (id) => db.prepare('SELECT * FROM coach_recommendations WHERE id = ?').get(id);

/**
 * The coach recommends targets to the client of this active pairing. A
 * pending target recommendation is replaced by the new one. The
 * recommendation also appears in the conversation.
 */
export function recommendTargets(pairing, coachId, body) {
  const { payload, error } = cleanTargetsPayload(body?.payload);
  if (error) throw _bad(error);
  const note = _note(body?.note);
  const id = db.transaction(() => {
    db.prepare(`
      UPDATE coach_recommendations SET status = 'replaced', updated_at = datetime('now')
       WHERE pairing_id = ? AND kind = 'targets' AND status = 'pending'
    `).run(pairing.id);
    const rid = db.prepare(`
      INSERT INTO coach_recommendations (pairing_id, coach_id, client_id, kind, payload, note)
      VALUES (?, ?, ?, 'targets', ?, ?)
    `).run(pairing.id, coachId, pairing.client_id, JSON.stringify(payload), note).lastInsertRowid;
    db.prepare(`
      INSERT INTO coach_messages (uuid, pairing_id, sender_id, body, recommendation_id)
      VALUES (?, ?, ?, NULL, ?)
    `).run(crypto.randomUUID(), pairing.id, coachId, rid);
    return rid;
  })();
  _notifyClient(pairing, coachId);
  return recommendationOut(_row(id));
}

/**
 * The client's answer: accepted or declined, with an optional note. Only a
 * pending recommendation of an active pairing can be answered; otherwise a
 * 409 carries its status now (replaced, withdrawn, already answered).
 */
export function answerRecommendation(id, clientId, { status, response_note } = {}) {
  const r = _row(Number(id));
  if (!r || r.client_id !== clientId) throw _bad('Recommendation not found', 404);
  if (!['accepted', 'declined'].includes(status)) throw _bad('The answer must be accepted or declined.');
  if (r.status !== 'pending') {
    const e = _bad(r.status === 'replaced' ? 'Replaced by a newer recommendation.' : r.status === 'withdrawn' ? 'This recommendation was withdrawn.' : 'This recommendation was already answered.', 409);
    e.row = recommendationOut(r);
    throw e;
  }
  const changed = db.prepare(`
    UPDATE coach_recommendations SET status = ?, response_note = ?, responded_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND status = 'pending'
  `).run(status, _note(response_note), r.id).changes;
  const out = _row(r.id);
  if (changed) _notifyCoach(out);
  return recommendationOut(out);
}

export function listForPairing(pairingId) {
  return db.prepare('SELECT * FROM coach_recommendations WHERE pairing_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC').all(pairingId).map(recommendationOut);
}

/** Everything recommended to this client, in any of their pairings. */
export function listForClient(clientId) {
  return db.prepare(`
    SELECT r.* FROM coach_recommendations r JOIN coach_clients cc ON cc.id = r.pairing_id
     WHERE r.client_id = ? AND cc.status IN ('active', 'ended') AND r.deleted_at IS NULL
     ORDER BY r.created_at DESC, r.id DESC
  `).all(clientId).map(recommendationOut);
}

async function _notifyClient(pairing, coachId) {
  try {
    await pushNotifyDefaultOn(pairing.client_id, 'notifCoachRecommendation', 'Coaching', `${_name(coachId)} sent you a recommendation.`, 5);
  } catch (e) { logger.warn(`[coaching] recommendation notification failed: ${e?.message || e}`); }
}

async function _notifyCoach(r) {
  try {
    const who = _name(r.client_id);
    await pushNotifyDefaultOn(r.coach_id, 'notifClientAnswer', 'Coaching', `${who} ${r.status === 'accepted' ? 'accepted' : 'declined'} your recommended targets.`, 5);
  } catch (e) { logger.warn(`[coaching] answer notification failed: ${e?.message || e}`); }
}
