/**
 * server/lib/webpush-validate.js — fork (Suslicke/nutritrace): which push subscriptions the
 * server will ever send to. The endpoint comes from the browser, i.e. from the user, so only the
 * browsers' own push services are allowed (no internal addresses, no arbitrary hosts — SSRF).
 * Pure module (no db) so tests can load it.
 */
export const PUSH_HOSTS = [
  'fcm.googleapis.com',                 // Chrome, Edge (Chromium), Android
  'updates.push.services.mozilla.com',  // Firefox
  '.push.services.mozilla.com',
  'web.push.apple.com',                 // Safari, iOS / iPadOS PWAs
  '.push.apple.com',
  '.notify.windows.com',                // legacy Edge / Windows
];

export function allowedPushEndpoint(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.some(h => (h.startsWith('.') ? host.endsWith(h) : host === h));
}

/** A browser PushSubscription JSON we accept: an allowed push service and both keys. */
export function validSubscription(sub) {
  return !!sub && typeof sub === 'object' && typeof sub.endpoint === 'string' && sub.endpoint.length < 1000
    && allowedPushEndpoint(sub.endpoint)
    && typeof sub.keys?.p256dh === 'string' && sub.keys.p256dh.length < 200
    && typeof sub.keys?.auth === 'string' && sub.keys.auth.length < 100;
}
