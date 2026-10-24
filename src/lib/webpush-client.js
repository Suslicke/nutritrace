// Fork (Suslicke/nutritrace): turn on Web Push for this device — permission, a push subscription
// with the server's VAPID key, saved to /api/webpush/subscribe. On iPhone it needs iOS 16.4+ and
// the app opened from the Home Screen.
import { NtApi } from './api.js';

export const webPushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function _keyBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function webPushStatus() {
  if (!webPushSupported()) return { supported: false };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  const { devices } = await NtApi.get('/api/webpush/key').catch(() => ({ devices: 0 }));
  return { supported: true, permission: Notification.permission, thisDevice: !!sub, devices };
}

export async function enableWebPush() {
  if (!webPushSupported()) throw new Error('This browser has no Web Push. On iPhone: iOS 16.4+, and open the app from the Home Screen.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are not allowed for this app.');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await NtApi.get('/api/webpush/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _keyBytes(publicKey) });
  return NtApi.post('/api/webpush/subscribe', { subscription: sub.toJSON() });
}

export async function disableWebPush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!sub) return { ok: true };
  await NtApi.post('/api/webpush/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
  return { ok: true };
}

export const testWebPush = () => NtApi.post('/api/webpush/test', {});
