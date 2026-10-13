/**
 * /api/coaching: connecting a coach and a client, and the coach's read-only
 * view of a client.
 *
 * Every route under /clients/:clientId goes through requireCoachOf (the one
 * guard: an active pairing between this coach and this client). Later phases
 * add their client routes under the same prefix and get the guard with them.
 * No route returns a full user row: people are { id, name }.
 */
import { Router } from 'express';
import db from '../db.js';
import { wrap } from '../logger.js';
import { requireAdmin } from '../middleware/auth.js';
import {
  NOTE_MAX, canCoach, roleOf, person, coachingState, endPairing,
  requireAccount, requireCoachRole, requireCoachOf,
} from '../lib/coaching.js';
import { resolveGoalFor, percentGoalToGrams } from '../../src/lib/goal-resolver.js';
import { Nutrition } from '../../src/lib/nutrition.js';
import { _bodyStatsWeightKg } from '../lib/adaptive-tdee.js';

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MACROS = [['proteins', 4], ['carbohydrates', 4], ['fat', 9]];
const OVERVIEW_DAYS = 7;
const WEIGHT_DAYS = 90;
// A day is on target when its calories land within this share of the target.
const ON_TARGET = 0.1;

const _json = (s, fallback) => { try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; } };

function _setting(userId, key, fallback = null) {
  const row = db.prepare(`SELECT value FROM user_settings WHERE user_id = ? AND key = ? AND deleted_at IS NULL`).get(userId, key);
  return row ? _json(row.value, fallback) : fallback;
}

/** YYYY-MM-DD, n days before `date` (calendar arithmetic, no time zone). */
function _shift(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The coach's today, from the app (so a coach a time zone away sees their own day). */
function _today(req) {
  const t = String(req.query.today || '');
  return DATE_RE.test(t) ? t : new Date().toLocaleDateString('sv-SE');
}

/** Calories and the three macros for one day, the way the client's Diary resolves them. */
function _targetsFor(goals, date) {
  const calories = resolveGoalFor(goals?.calories, date);
  const out = { calories: calories ?? null };
  for (const [key, density] of MACROS) {
    const g = goals?.[key];
    const raw = g ? resolveGoalFor(g, date) : null;
    if (raw == null) { out[key] = null; continue; }
    out[key] = g.isPercent ? (calories != null ? percentGoalToGrams(raw, calories, density) : null) : raw;
  }
  return out;
}

function _dayTotals(items) {
  const t = Nutrition.sum((items || []).map(i => Nutrition.calculate(i)));
  const r = (v) => Math.round((Number(v) || 0) * 10) / 10;
  return { calories: r(t.calories), proteins: r(t.proteins), carbohydrates: r(t.carbohydrates), fat: r(t.fat) };
}

function _onTarget(day) {
  if (!day.logged || !(day.targets.calories > 0)) return null;
  return Math.abs(day.totals.calories - day.targets.calories) <= day.targets.calories * ON_TARGET;
}

/** The last `n` days ending today: what was eaten against the targets. */
function _recentDays(clientId, today, n = OVERVIEW_DAYS) {
  const goals = _setting(clientId, 'goals', {}) || {};
  const from = _shift(today, -(n - 1));
  const rows = new Map(db.prepare(`
    SELECT date, items FROM diary WHERE user_id = ? AND deleted_at IS NULL AND date BETWEEN ? AND ?
  `).all(clientId, from, today).map(r => [r.date, _json(r.items, [])]));
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = _shift(today, -i);
    const items = rows.get(date) || [];
    const day = { date, logged: items.length > 0, totals: _dayTotals(items), targets: _targetsFor(goals, date) };
    day.on_target = _onTarget(day);
    days.push(day);
  }
  return days;
}

function _lastLogged(clientId) {
  return db.prepare(`
    SELECT MAX(date) AS d FROM diary
     WHERE user_id = ? AND deleted_at IS NULL AND items IS NOT NULL AND items NOT IN ('', '[]')
  `).get(clientId)?.d || null;
}

function _summary(days) {
  const judged = days.filter(d => d.on_target != null);
  return { days: days.length, logged: days.filter(d => d.logged).length, judged: judged.length, on_target: judged.filter(d => d.on_target).length };
}

const _note = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, NOTE_MAX) : null;
};

const _rank = (r) => (r.status === 'active' || r.status === 'pending' ? 0 : 1);

const _pairingRow = (id) => db.prepare('SELECT * FROM coach_clients WHERE id = ?').get(id);

// ── Your own place in coaching ──────────────────────────────────────────────
router.get('/state', requireAccount, wrap((req, res) => {
  res.json(coachingState(req.user.id));
}));

// ── The coach's side ────────────────────────────────────────────────────────
// Your clients: pending requests, active pairings, and requests declined or
// pairings the client ended in the last week, so the answer is seen.
router.get('/clients', requireCoachRole, wrap((req, res) => {
  const today = _today(req);
  const rows = db.prepare(`
    SELECT cc.id, cc.status, cc.requested_at, cc.responded_at, cc.ended_at, cc.ended_by,
           u.id AS client_id, u.full_name, u.username
      FROM coach_clients cc JOIN users u ON u.id = cc.client_id
     WHERE cc.coach_id = ?
       AND (cc.status IN ('pending', 'active')
         OR (cc.status = 'declined' AND cc.responded_at >= datetime('now', '-7 days'))
         OR (cc.status = 'ended' AND cc.ended_by IS NOT cc.coach_id AND cc.ended_at >= datetime('now', '-7 days')))
     ORDER BY CASE cc.status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
              COALESCE(u.full_name, u.username) COLLATE NOCASE
  `).all(req.user.id);
  // One row per client: the open pairing, else the latest answer.
  const seen = new Set();
  const latest = [...rows].sort((a, b) => _rank(a) - _rank(b) || String(b.responded_at || b.ended_at || '').localeCompare(String(a.responded_at || a.ended_at || '')));
  const keep = new Set(latest.filter(r => !seen.has(r.client_id) && seen.add(r.client_id)).map(r => r.id));
  res.json(rows.filter(r => keep.has(r.id)).map(r => {
    const out = {
      id: r.id, status: r.status, client: person(r.client_id, r.full_name, r.username),
      requested_at: r.requested_at, responded_at: r.responded_at || null, ended_at: r.ended_at || null,
    };
    if (r.status === 'active') {
      out.last_logged = _lastLogged(r.client_id);
      out.week = _summary(_recentDays(r.client_id, today));
    }
    return out;
  }));
}));

// The name list for a request: id and name only, like the sharing picker.
// People already coached by you (or asked) are left out; nothing says who
// has another coach.
router.get('/candidates', requireCoachRole, wrap((req, res) => {
  const rows = db.prepare(`
    SELECT id, full_name, username FROM users
     WHERE id != ?
       AND id NOT IN (SELECT client_id FROM coach_clients WHERE coach_id = ? AND status IN ('pending', 'active'))
     ORDER BY COALESCE(full_name, username) COLLATE NOCASE
  `).all(req.user.id, req.user.id);
  res.json(rows.map(u => person(u.id, u.full_name, u.username)));
}));

router.post('/requests', requireCoachRole, wrap((req, res) => {
  const clientId = Number(req.body?.client_id);
  if (!Number.isInteger(clientId) || clientId === req.user.id) return res.status(400).json({ error: 'Choose someone to coach.' });
  const client = db.prepare('SELECT id, full_name, username FROM users WHERE id = ?').get(clientId);
  if (!client) return res.status(400).json({ error: 'Choose someone to coach.' });
  let id;
  try {
    id = db.prepare(`INSERT INTO coach_clients (coach_id, client_id, status, note) VALUES (?, ?, 'pending', ?)`)
      .run(req.user.id, clientId, _note(req.body?.note)).lastInsertRowid;
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message))) {
      return res.status(409).json({ error: `${person(client.id, client.full_name, client.username).name} can't take a coaching request right now.` });
    }
    throw e;
  }
  const row = _pairingRow(id);
  res.json({ id: row.id, status: row.status, client: person(client.id, client.full_name, client.username), requested_at: row.requested_at });
}));

// ── The client's answer ─────────────────────────────────────────────────────
function _answer(status) {
  return wrap((req, res) => {
    const row = _pairingRow(Number(req.params.id));
    if (!row || row.client_id !== req.user.id) return res.status(404).json({ error: 'Request not found' });
    if (row.status !== 'pending') return res.status(409).json({ error: 'This request was already answered.' });
    if (status === 'active' && !canCoach(roleOf(row.coach_id))) {
      endPairing(row.id, null);
      return res.status(409).json({ error: 'This person no longer coaches.' });
    }
    db.prepare(`UPDATE coach_clients SET status = ?, responded_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'pending'`)
      .run(status, row.id);
    res.json(coachingState(req.user.id));
  });
}
router.post('/pairings/:id/accept', requireAccount, _answer('active'));
router.post('/pairings/:id/decline', requireAccount, _answer('declined'));

// Ending: the client (Leave Coach), the coach (End Coaching, or taking back a
// request) or an admin (from Users).
router.post('/pairings/:id/end', requireAccount, wrap((req, res) => {
  const row = _pairingRow(Number(req.params.id));
  const me = req.user.id;
  const mine = row && (row.coach_id === me || row.client_id === me);
  if (!row || (!mine && roleOf(me) !== 'admin')) return res.status(404).json({ error: 'Pairing not found' });
  if (!endPairing(row.id, me)) return res.status(409).json({ error: 'This coaching has already ended.' });
  res.json(coachingState(me));
}));

// ── Admin: see and end pairings ─────────────────────────────────────────────
router.get('/admin/pairings', requireAccount, requireAdmin, wrap((req, res) => {
  const rows = db.prepare(`
    SELECT cc.id, cc.status, cc.requested_at, cc.responded_at,
           c.id AS coach_id, c.full_name AS coach_full, c.username AS coach_user,
           k.id AS client_id, k.full_name AS client_full, k.username AS client_user
      FROM coach_clients cc
      JOIN users c ON c.id = cc.coach_id
      JOIN users k ON k.id = cc.client_id
     WHERE cc.status IN ('pending', 'active')
     ORDER BY cc.status, COALESCE(c.full_name, c.username) COLLATE NOCASE
  `).all();
  res.json(rows.map(r => ({
    id: r.id, status: r.status, requested_at: r.requested_at, responded_at: r.responded_at || null,
    coach: person(r.coach_id, r.coach_full, r.coach_user),
    client: person(r.client_id, r.client_full, r.client_user),
  })));
}));

// ── A client, as their coach sees them ──────────────────────────────────────
// The guard runs for every route below this line that starts /clients/:clientId.
router.use('/clients/:clientId', requireCoachOf);

router.get('/clients/:clientId/overview', wrap((req, res) => {
  const clientId = req.pairing.client_id;
  const today = _today(req);
  const u = db.prepare('SELECT id, full_name, username FROM users WHERE id = ?').get(clientId);
  const days = _recentDays(clientId, today);
  const from = _shift(today, -(WEIGHT_DAYS - 1));
  const weights = db.prepare(`
    SELECT date, body_stats FROM diary WHERE user_id = ? AND deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date
  `).all(clientId, from, today)
    .map(r => ({ date: r.date, kg: _bodyStatsWeightKg(r.body_stats) }))
    .filter(w => w.kg != null)
    .map(w => ({ date: w.date, kg: Math.round(w.kg * 100) / 100 }));
  res.json({
    client: person(u.id, u.full_name, u.username),
    since: req.pairing.responded_at,
    today,
    calorie_mode: _setting(clientId, 'calorieGoalMode', 'fixed') || 'fixed',
    last_logged: _lastLogged(clientId),
    days,
    week: _summary(days),
    weights,
  });
}));

router.get('/clients/:clientId/diary/:date', wrap((req, res) => {
  const clientId = req.pairing.client_id;
  const date = String(req.params.date);
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Invalid date' });
  const row = db.prepare(`SELECT items, water, notes, body_stats FROM diary WHERE user_id = ? AND date = ? AND deleted_at IS NULL`).get(clientId, date);
  const items = _json(row?.items, []) || [];
  const goals = _setting(clientId, 'goals', {}) || {};
  res.json({
    date,
    meal_names: _setting(clientId, 'mealNames', null),
    items: items.map(it => {
      const n = Nutrition.calculate(it) || {};
      return {
        name: it.name || '', brand: it.brand || null,
        portion: it.portion ?? null, unit: it.unit || null, quantity: it.quantity ?? null,
        meal: Number.isInteger(it.meal) ? it.meal : Number(it.meal) || 0,
        calories: Math.round(Number(n.calories) || 0),
        proteins: Math.round((Number(n.proteins) || 0) * 10) / 10,
        carbohydrates: Math.round((Number(n.carbohydrates) || 0) * 10) / 10,
        fat: Math.round((Number(n.fat) || 0) * 10) / 10,
      };
    }),
    totals: _dayTotals(items),
    targets: _targetsFor(goals, date),
    water_ml: (_json(row?.water, []) || []).reduce((s, l) => s + (Number(l?.amount) || 0), 0),
    weight_kg: row ? _bodyStatsWeightKg(row.body_stats) : null,
    notes: row?.notes || null,
  });
}));

export default router;
