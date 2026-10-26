/**
 * OIDC fixes, verified end to end against a mock IdP before they went in;
 * these checks keep them from quietly coming undone.
 *
 *  - Fork (Suslicke/nutritrace): an email never picks or creates an account;
 *    only a sub linked from a signed-in session signs in (see
 *    pocket-id-login.test.js for the behaviour end to end).
 *  - The callback works with or without the provider ID, and at the old
 *    documented /api/oidc/callback address.
 *  - OIDC_ENABLE_EMAIL_PASSWORD_LOGIN applies even with no env-defined provider.
 *  - Userinfo fills in claims the ID token lacks (Authelia 4.39+), and is read
 *    as plain JSON unless a real signing algorithm is configured.
 *  - The Android deep link carries a single-use code bound to the app's
 *    secret, not the session token.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const lib = read('server/lib/oidc.js');
const routes = read('server/routes/oidc.js');
const env = read('server/lib/oidc-env.js');
const index = read('server/index.js');
const app = read('src/App.svelte');
const handoff = read('src/lib/oidc-app-handoff.js');

test('sign-in resolves a user by linked sub only: no email match, no auto-register', () => {
  const fn = lib.slice(lib.indexOf('export function resolveUser'), lib.indexOf('export function applyAdminMapping'));
  assert.doesNotMatch(fn, /FROM users WHERE email/);
  assert.doesNotMatch(fn, /INSERT INTO users/);
  assert.doesNotMatch(fn, /INSERT INTO user_oidc_links/);
});

test('callback works with or without the provider ID, and at the old address', () => {
  assert.match(routes, /router\.get\('\/callback\/:providerId', wrap\(handleCallback\)\)/);
  assert.match(routes, /router\.get\('\/callback', wrap\(handleCallback\)\)/);
  assert.match(routes, /const providerId = req\.params\.providerId \?\? stored\.providerId;/);
  assert.match(index, /router\.get\('\/api\/oidc\/callback'[\s\S]{0,200}redirect\(307, `\$\{BASE_URL\}\/api\/auth\/oidc\/callback/);
  const gate = index.indexOf("error: 'Setup required'");
  if (gate >= 0) {
    assert.ok(index.indexOf("router.get('/api/oidc/callback'") < gate, 'the old address must be forwarded before the setup gate');
  }
});

test('the password-login env flag is seeded before the no-env-provider early return', () => {
  const fn = env.slice(env.indexOf('export function seedOidcFromEnv'));
  assert.ok(fn.indexOf('_seedPasswordLoginFromEnv();') < fn.indexOf('if (!prefixes.length) return;'));
});

test('userinfo fills in missing claims, ID token wins, same subject only', () => {
  assert.match(routes, /client\.userinfo\(tokenSet\.access_token\)/);
  assert.match(routes, /if \(info && info\.sub === claims\.sub\) claims = \{ \.\.\.info, \.\.\.claims \};/);
  assert.match(lib, /userinfo_signed_response_alg !== 'none'/);
});

test('the Android deep link carries a single-use code bound to the app secret', () => {
  assert.match(routes, /oidc-callback\/\?code=\$\{encodeURIComponent\(code\)\}/);
  assert.match(routes, /router\.post\('\/handoff'/);
  assert.match(lib, /createHash\('sha256'\)\.update\(verifier\)\.digest\('base64url'\)/);
  assert.match(lib, /DELETE FROM oauth_state WHERE state = \?`\)\.run\(code\)/);
  assert.match(handoff, /crypto\.subtle\.digest\('SHA-256'/);
  // App.svelte routes the link through lib/server-signin.js, which swaps the code (#36).
  assert.match(app, /redeem: redeemHandoff \}\);/);
  assert.match(read('src/lib/server-signin.js'), /const data = await redeem\(code, action\.server\);/);
});
