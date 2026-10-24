/**
 * server/lib/webpush.js — fork (Suslicke/nutritrace): Web Push to the installed PWA, as the push
 * service "webpush" next to Gotify / ntfy / Apprise. The server's reminders (scheduler.js) and
 * alerts reach the phone with the app closed, from NutriTrace itself.
 *
 * VAPID keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY from the environment, else generated once and
 * kept in app_config (server-only; regenerating them unlinks every device). Subscriptions live in
 * their own table, one row per device, never in user_settings (those sync to the browser).
 * The `web-push` package is installed by the fork's Dockerfile (not in package.json, so upstream
 * lockfile changes never conflict) and loaded lazily.
 */
import db from '../db.js';
import { logger } from '../logger.js';

let _ready = false;
function _table() {
  if (_ready) return;
  db.exec(`CREATE TABLE IF NOT EXISTS fork_webpush_subs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  _ready = true;
}

/** A browser PushSubscription JSON we accept: https endpoint and both keys. */
export function validSubscription(sub) {
  if (!sub || typeof sub !== 'object') return false;
  let u;
  try { u = new URL(sub.endpoint); } catch { return false; }
  return u.protocol === 'https:' && sub.endpoint.length < 1000
    && typeof sub.keys?.p256dh === 'string' && sub.keys.p256dh.length < 200
    && typeof sub.keys?.auth === 'string' && sub.keys.auth.length < 100;
}

/** What the service worker shows (public/push-sw.js reads exactly these fields). */
export function payload(title, message, url = '/') {
  return JSON.stringify({ title: `NutriTrace — ${title}`, body: String(message ?? ''), url });
}

async function _lib() {
  const mod = await import('web-push');
  return mod.default || mod;
}

function _config(key) {
  return db.prepare('SELECT value FROM app_config WHERE key = ?').get(key)?.value || '';
}

export async function vapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  let publicKey = _config('fork_vapid_public'), privateKey = _config('fork_vapid_private');
  if (!publicKey || !privateKey) {
    ({ publicKey, privateKey } = (await _lib()).generateVAPIDKeys());
    const put = db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    put.run('fork_vapid_public', publicKey);
    put.run('fork_vapid_private', privateKey);
    logger.info('[webpush] generated VAPID keys');
  }
  return { publicKey, privateKey };
}

export function saveSubscription(userId, sub, userAgent = '') {
  _table();
  db.prepare(`INSERT INTO fork_webpush_subs (user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
      user_agent = excluded.user_agent`)
    .run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, String(userAgent).slice(0, 200));
}

export function removeSubscription(userId, endpoint) {
  _table();
  return db.prepare('DELETE FROM fork_webpush_subs WHERE user_id = ? AND endpoint = ?').run(userId, endpoint).changes;
}

export function deviceCount(userId) {
  _table();
  return db.prepare('SELECT COUNT(*) AS n FROM fork_webpush_subs WHERE user_id = ?').get(userId).n;
}

/** Send to every device of the user; drops subscriptions the push service says are gone.
 *  Returns {sent, failed}. Throws only when the user has no device at all. */
export async function sendWebPush(userId, title, message, url = '/') {
  _table();
  const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM fork_webpush_subs WHERE user_id = ?').all(userId);
  if (!subs.length) throw new Error('no device enabled for web push');
  const lib = await _lib();
  const { publicKey, privateKey } = await vapidKeys();
  const subject = (process.env.PUBLIC_URL || '').replace(/\/+$/, '') || 'mailto:admin@localhost';
  const body = payload(title, message, url);
  let sent = 0, failed = 0;
  for (const s of subs) {
    try {
      await lib.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body,
        { vapidDetails: { subject, publicKey, privateKey }, TTL: 6 * 3600 });
      sent++;
    } catch (e) {
      failed++;
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        db.prepare('DELETE FROM fork_webpush_subs WHERE id = ?').run(s.id);
        logger.info(`[webpush] dropped an expired device of user ${userId}`);
      } else {
        logger.warn(`[webpush] user ${userId}: ${e?.statusCode || ''} ${e?.message || e}`);
      }
    }
  }
  return { sent, failed };
}
