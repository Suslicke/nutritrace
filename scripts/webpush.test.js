/**
 * Fork (Suslicke/nutritrace): the server sends Web Push only to the browsers' push services —
 * the endpoint comes from the user, so anything else (internal addresses, other hosts) is refused.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedPushEndpoint, validSubscription } from '../server/lib/webpush-validate.js';

test('real push services pass', () => {
  for (const e of ['https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/QAbc',
    'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x'])
    assert.ok(allowedPushEndpoint(e), e);
});

test('anything else is refused', () => {
  for (const e of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'https://localhost/x',
    'https://127.0.0.1/x', 'https://ntfy.sh/topic', 'https://fcm.googleapis.com.evil.com/x',
    'https://evilpush.apple.com.attacker.net/x', 'https://user:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x', 'not a url', ''])
    assert.equal(allowedPushEndpoint(e), false, e);
});

test('a subscription needs an allowed endpoint and both keys', () => {
  const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
  assert.ok(validSubscription({ endpoint: 'https://web.push.apple.com/QAbc', keys }));
  assert.equal(validSubscription({ endpoint: 'https://ntfy.sh/t', keys }), false);
  assert.equal(validSubscription({ endpoint: 'https://web.push.apple.com/QAbc', keys: { p256dh: 'x' } }), false);
  assert.equal(validSubscription(null), false);
});
