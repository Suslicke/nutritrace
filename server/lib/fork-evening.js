/**
 * server/lib/fork-evening.js — fork (Suslicke/nutritrace): the evening summary push, once a day at
 * 20:30 local time: calories left for the day and how much protein is still missing.
 * Off with the user setting notifEveningSummary = false. Called from scheduler.js _tick.
 */
import db from '../db.js';
import { effectiveCalorieGoal } from './effective-goal.js';
import { dayTargets } from '../../src/lib/goal-resolver.js';
import { pushNotifyDefaultOn } from './push-notify.js';
import { dayTotals, eveningText } from './fork-evening-text.js';

const AT_MIN = 20 * 60 + 30;  // ponytail: fixed time; a setting if someone wants another one

const setting = (userId, key) => {
  const v = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key)?.value;
  try { return v == null ? null : JSON.parse(v); } catch { return v; }
};

export async function eveningSummary(userId, local, minutes) {
  const svc = setting(userId, 'notifPushService');
  if (!svc || svc === 'none' || minutes < AT_MIN || minutes >= AT_MIN + 15) return;
  const key = `_fork_evening_${userId}_${local.dateStr}`;
  if (db.prepare('SELECT 1 FROM app_config WHERE key = ?').get(key)) return;
  db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?)').run(key, '1');
  const row = db.prepare('SELECT items FROM diary WHERE date = ? AND user_id = ? AND deleted_at IS NULL').get(local.dateStr, userId);
  const goals = setting(userId, 'goals') || {};
  const goal = { ...dayTargets(goals, local.dateStr), calories: effectiveCalorieGoal(userId, local.dateStr, goals).calories };
  const text = eveningText(dayTotals(row?.items ? JSON.parse(row.items) : []), goal);
  if (text) await pushNotifyDefaultOn(userId, 'notifEveningSummary', '🌙 Итог дня', text, 4);
}
