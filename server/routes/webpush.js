/**
 * server/routes/webpush.js — fork (Suslicke/nutritrace): /api/webpush/* for the PWA's own push.
 *   GET  /key          VAPID public key for pushManager.subscribe
 *   POST /subscribe    {subscription} from the browser → this account's device
 *   POST /unsubscribe  {endpoint}
 *   POST /test         a test notification to every device of this account
 *   POST /ate          {meal_id} → "ate it too?" push to everyone the dish is shared with
 */
import { Router } from 'express';
import { wrap } from '../logger.js';
import { requireAuth, userMgmtActive } from '../middleware/auth.js';
import { vapidKeys, validSubscription, saveSubscription, removeSubscription, deviceCount, sendWebPush } from '../lib/webpush.js';
import db from '../db.js';
import { canRead } from '../lib/sharing.js';
import { pushNotifyDefaultOn } from '../lib/push-notify.js';

const router = Router();
router.use(requireAuth);
router.use((req, res, next) => (userMgmtActive() && req.user ? next() : res.status(401).json({ error: 'Not logged in' })));

router.get('/key', wrap(async (req, res) => {
  res.json({ publicKey: (await vapidKeys()).publicKey, devices: deviceCount(req.user.id) });
}));

router.post('/subscribe', wrap(async (req, res) => {
  const sub = req.body?.subscription;
  if (!validSubscription(sub)) return res.status(400).json({ error: 'Invalid push subscription' });
  saveSubscription(req.user.id, sub, req.get('user-agent') || '');
  res.json({ ok: true, devices: deviceCount(req.user.id) });
}));

router.post('/unsubscribe', wrap(async (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  res.json({ ok: true, removed: removeSubscription(req.user.id, endpoint), devices: deviceCount(req.user.id) });
}));

// "I ate it too": whoever else can see this dish gets a push; on the PWA it opens the dish in Trace.
router.post('/ate', wrap(async (req, res) => {
  const meal = db.prepare('SELECT id, user_id, name, visibility FROM meals WHERE id = ? AND deleted_at IS NULL').get(Number(req.body?.meal_id));
  if (!meal || !canRead(meal, req.user.id, 'meal_shares', 'meal_id')) return res.status(404).json({ error: 'No such dish' });
  const who = db.prepare('SELECT full_name, username FROM users WHERE id = ?').get(req.user.id);
  const by = who?.full_name || who?.username || 'Кто-то';
  const name = String(meal.name).slice(0, 80);
  let sent = 0;
  for (const { id } of db.prepare('SELECT id FROM users WHERE id != ?').all(req.user.id)) {
    if (!canRead(meal, id, 'meal_shares', 'meal_id')) continue;
    const text = `${by} записал(а) «${name}». Тоже ели? Нажми, чтобы записать свою порцию.`;
    try {
      if (deviceCount(id)) await sendWebPush(id, 'Тоже ели?', text, `/?trace_recipe=${meal.id}`);
      else await pushNotifyDefaultOn(id, 'notifAteToo', '🍲 Тоже ели?', text, 4);
      sent++;
    } catch { /* that person has no push set up */ }
  }
  res.json({ ok: true, sent });
}));

router.post('/test', wrap(async (req, res) => {
  try {
    res.json({ ok: true, ...(await sendWebPush(req.user.id, 'Test', 'Push notifications from NutriTrace work ✅')) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

export default router;
