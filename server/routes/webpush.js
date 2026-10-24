/**
 * server/routes/webpush.js — fork (Suslicke/nutritrace): /api/webpush/* for the PWA's own push.
 *   GET  /key          VAPID public key for pushManager.subscribe
 *   POST /subscribe    {subscription} from the browser → this account's device
 *   POST /unsubscribe  {endpoint}
 *   POST /test         a test notification to every device of this account
 */
import { Router } from 'express';
import { wrap } from '../logger.js';
import { requireAuth, userMgmtActive } from '../middleware/auth.js';
import { vapidKeys, validSubscription, saveSubscription, removeSubscription, deviceCount, sendWebPush } from '../lib/webpush.js';

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

router.post('/test', wrap(async (req, res) => {
  try {
    res.json({ ok: true, ...(await sendWebPush(req.user.id, 'Test', 'Push notifications from NutriTrace work ✅')) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

export default router;
