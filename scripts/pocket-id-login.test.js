/**
 * Fork (Suslicke/nutritrace): "Sign in with Pocket ID", bound by subject only.
 *
 * Against the real server (server/index.js on a scratch database) and a
 * stand-in Pocket ID (discovery, JWKS, token endpoint, RS256 ID tokens):
 *
 * - The provider exists only while OIDC_ISSUER + OIDC_CLIENT_ID +
 *   OIDC_CLIENT_SECRET are set; without them the button is gone and the
 *   login route is a 404, even on a database an earlier start seeded.
 * - Sign-in finds the user only by the Pocket ID `sub` stored on a link. An
 *   unknown sub is refused: no account is created and a matching (verified)
 *   email is never used to pick one.
 * - A link is made only from a signed-in session ("Link with Pocket ID" in
 *   Profile), and only if the same user's session is still there at the
 *   callback. A bound sub is never moved, and a user's binding is never
 *   silently replaced; unlink works.
 * - Authorization code + PKCE S256 + state + nonce; the ID token is checked
 *   (JWKS signature, RS256, iss, aud, exp, nonce). State is single use and
 *   bound to the browser that started the sign-in.
 * - Sign-in sets the same nt_token session as the password login.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
let ready = false;
try { serverRequire('better-sqlite3'); ready = true; } catch { /* server packages missing: these cases skip */ }

const freePort = () => new Promise((res) => { const s = netServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanEnv = () => {
  const keep = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'SystemRoot', 'NODE_OPTIONS'];
  return Object.fromEntries(keep.filter((k) => process.env[k] != null).map((k) => [k, process.env[k]]));
};

// ── Stand-in Pocket ID ─────────────────────────────────────────────────────
const CLIENT_ID = 'nutri-client';
const CLIENT_SECRET = 'nutri-secret-0123456789';
const KID = 'k1';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: wrongKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function signJwt(payload, key = privateKey, header = { alg: 'RS256', typ: 'JWT', kid: KID }) {
  const data = `${b64url(header)}.${b64url(payload)}`;
  const sig = header.alg === 'none' ? '' : crypto.sign('sha256', Buffer.from(data), key).toString('base64url');
  return `${data}.${sig}`;
}

let idp = null, issuer = null;
// code → { sub, email, email_verified, nonce, challenge, tamper }
const codes = new Map();
const tokenRequests = [];

async function startIdp() {
  const port = await freePort();
  issuer = `http://127.0.0.1:${port}`;
  idp = http.createServer((req, res) => {
    const url = new URL(req.url, issuer);
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/api/oidc/token`,
        userinfo_endpoint: `${issuer}/api/oidc/userinfo`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        end_session_endpoint: `${issuer}/api/oidc/end-session`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
        code_challenge_methods_supported: ['S256', 'plain'],
        scopes_supported: ['openid', 'profile', 'email', 'groups'],
      });
    }
    if (url.pathname === '/.well-known/jwks.json') {
      return json(200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] });
    }
    if (url.pathname === '/api/oidc/userinfo') return json(401, { error: 'invalid_token' });
    if (url.pathname === '/api/oidc/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const p = new URLSearchParams(body);
        tokenRequests.push(Object.fromEntries(p));
        const grant = codes.get(p.get('code'));
        codes.delete(p.get('code'));
        if (!grant) return json(400, { error: 'invalid_grant' });
        if (p.get('client_id') !== CLIENT_ID || p.get('client_secret') !== CLIENT_SECRET) return json(401, { error: 'invalid_client' });
        const verifier = p.get('code_verifier') || '';
        if (crypto.createHash('sha256').update(verifier).digest('base64url') !== grant.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
        const now = Math.floor(Date.now() / 1000);
        const claims = {
          iss: issuer, aud: CLIENT_ID, sub: grant.sub, iat: now, exp: now + 300, nonce: grant.nonce,
          email: grant.email, email_verified: grant.email_verified ?? true, preferred_username: grant.username,
        };
        let idToken;
        const t = grant.tamper;
        if (t === 'signature') idToken = signJwt(claims, wrongKey);
        else if (t === 'iss') idToken = signJwt({ ...claims, iss: 'https://evil.example.com' });
        else if (t === 'aud') idToken = signJwt({ ...claims, aud: 'another-client' });
        else if (t === 'exp') idToken = signJwt({ ...claims, iat: now - 7200, exp: now - 3600 });
        else if (t === 'nonce') idToken = signJwt({ ...claims, nonce: 'not-the-nonce' });
        else if (t === 'alg-none') idToken = signJwt(claims, null, { alg: 'none', typ: 'JWT' });
        else idToken = signJwt(claims);
        json(200, { access_token: 'at-' + crypto.randomBytes(8).toString('hex'), token_type: 'Bearer', expires_in: 300, id_token: idToken });
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => idp.listen(port, '127.0.0.1', r));
}

// ── NutriTrace under test ──────────────────────────────────────────────────
let proc = null, base = null, dir = null, dbPath = null;
async function startServer(extraEnv) {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['index.js'], {
    cwd: fileURLToPath(new URL('../server/', import.meta.url)),
    env: { ...cleanEnv(), PORT: String(port), DB_PATH: dbPath, UPLOADS_PATH: join(dir, 'uploads'), JWT_SECRET: 'pocket-id-test-0123456789abcdef0123456789', INSECURE_COOKIES: '1', NODE_ENV: 'test', LOG_LEVEL: 'error', ...extraEnv(port) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/auth/status')).ok) return; } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('server did not start');
}
async function stopServer() {
  if (!proc) return;
  const p = proc; proc = null;
  await new Promise((r) => { p.once('exit', r); p.kill(); });
}
const oidcEnv = (port) => ({
  OIDC_ISSUER: issuer,
  OIDC_CLIENT_ID: CLIENT_ID,
  OIDC_CLIENT_SECRET: CLIENT_SECRET,
  OIDC_DISPLAY_NAME: 'Pocket ID',
  OIDC_REDIRECT_URIS: `http://127.0.0.1:${port}/api/auth/oidc/callback`,
  // Upstream's switches must not reopen email matching or self sign-up.
  OIDC_AUTO_LINK: '1',
  OIDC_AUTO_REGISTER: '1',
});

// A tiny cookie jar per "browser".
class Browser {
  constructor() { this.jar = new Map(); }
  header() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  take(res) {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a.trim())) || value === '';
      if (expired) this.jar.delete(name); else this.jar.set(name, value);
    }
  }
  async get(path, headers = {}) {
    const res = await fetch(base + path, { redirect: 'manual', headers: { cookie: this.header(), ...headers } });
    this.take(res);
    return res;
  }
  async post(path, body, headers = {}) {
    const res = await fetch(base + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), 'content-type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
    this.take(res);
    return res;
  }
  async me() {
    const r = await this.get('/api/auth/me');
    if (!r.ok) return null;
    return (await r.json()).user;
  }
}

// The login route is rate limited: sign each account in once per server and
// hand every "browser" a copy of that session.
const sessions = new Map();
async function passwordLogin(username, password) {
  const key = `${base}|${username}`;
  if (!sessions.has(key)) {
    const b = new Browser();
    const r = await b.post('/api/auth/login', { username, password });
    assert.equal(r.status, 200, `password login for ${username}`);
    sessions.set(key, b.jar.get('nt_token'));
  }
  const b = new Browser();
  b.jar.set('nt_token', sessions.get(key));
  return b;
}

/** Start at NutriTrace, "sign in" at the stand-in Pocket ID as `who`, return the callback URL. */
async function authorize(browser, who, { link = false, tamper } = {}) {
  const r = await browser.get(`/api/auth/oidc/login/1${link ? '?link=1&return=/profile' : ''}`);
  assert.equal(r.status, 302, `login start → ${r.status}`);
  const to = new URL(r.headers.get('location'));
  assert.equal(to.origin + to.pathname, `${issuer}/authorize`);
  const q = to.searchParams;
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('client_id'), CLIENT_ID);
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.ok(q.get('code_challenge') && q.get('state') && q.get('nonce'));
  const code = 'code-' + crypto.randomBytes(8).toString('hex');
  codes.set(code, { ...who, nonce: q.get('nonce'), challenge: q.get('code_challenge'), tamper });
  const cb = new URL(q.get('redirect_uri'));
  cb.searchParams.set('code', code);
  cb.searchParams.set('state', q.get('state'));
  return { callback: cb.pathname + cb.search, state: q.get('state'), code };
}
const outcome = (res) => {
  const loc = res.headers.get('location') || '';
  const m = loc.match(/[?&](oidc|oidc_error)=([^&]*)/);
  return m ? { [m[1] === 'oidc' ? 'ok' : 'error']: decodeURIComponent(m[2]) } : { status: res.status, loc };
};

const OWNER = { username: 'owner', password: 'Correct-Horse-Battery-9', email: 'owner@example.com' };
const OTHER = { username: 'other', password: 'Another-Long-Passphrase-7', email: 'other@example.com' };
const POCKET_OWNER = { sub: 'pid-owner', email: OWNER.email, username: 'owner' };
const POCKET_OTHER = { sub: 'pid-other', email: OTHER.email, username: 'other' };
const POCKET_STRANGER = { sub: 'pid-stranger', email: OWNER.email, email_verified: true, username: 'owner' };

let db = null;
const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const links = () => db.prepare('SELECT user_id, oidc_sub FROM user_oidc_links ORDER BY id').all();

test.before(async () => {
  if (!ready) return;
  dir = mkdtempSync(join(tmpdir(), 'nutritrace-pocket-id-'));
  dbPath = join(dir, 'nutritrace.db');
  await startIdp();
  await startServer(oidcEnv);
  // First account through the normal sign-up; the second straight into the database.
  const first = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(OWNER) });
  assert.equal(first.status, 200, 'first account');
  const Database = serverRequire('better-sqlite3');
  const bcrypt = serverRequire('bcryptjs');
  db = new Database(dbPath);
  db.prepare(`INSERT INTO users (username, password_hash, role, email) VALUES (?, ?, 'user', ?)`).run(OTHER.username, bcrypt.hashSync(OTHER.password, 4), OTHER.email);
});
test.after(async () => {
  db?.close();
  await stopServer();
  idp?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('the login page offers "Sign in with Pocket ID" next to the password form', { skip: !ready }, async () => {
  const s = await (await fetch(base + '/api/auth/status')).json();
  assert.deepEqual(s.oidc.providers.map((p) => p.display_name), ['Pocket ID']);
  assert.equal(s.oidc.enable_email_password_login, true, 'password login stays as the fallback');
});

test('an unbound sub is refused even with a matching verified email; no user is created', { skip: !ready }, async () => {
  const before = userCount();
  const b = new Browser();
  const { callback } = await authorize(b, POCKET_STRANGER);
  const r = await b.get(callback);
  assert.ok(outcome(r).error, `refused: ${JSON.stringify(outcome(r))}`);
  assert.equal(b.jar.get('nt_token'), undefined, 'no session');
  assert.equal(userCount(), before, 'no account created');
  assert.deepEqual(links(), [], 'nothing linked by email');
});

test('linking needs a signed-in session: ?link=1 without one is refused, not a sign-in', { skip: !ready }, async () => {
  const b = new Browser();
  const r = await b.get('/api/auth/oidc/login/1?link=1');
  assert.equal(r.status, 401);
  assert.deepEqual(links(), []);
});

test('a session swapped for another user mid-flow is refused; so is a session that is gone', { skip: !ready }, async () => {
  // Owner starts "Link with Pocket ID", then the browser's session becomes OTHER's.
  const b = await passwordLogin(OWNER.username, OWNER.password);
  const { callback } = await authorize(b, POCKET_OTHER, { link: true });
  const otherSession = await passwordLogin(OTHER.username, OTHER.password);
  b.jar.set('nt_token', otherSession.jar.get('nt_token'));
  const r = await b.get(callback);
  assert.ok(outcome(r).error, `swap refused: ${JSON.stringify(outcome(r))}`);
  assert.deepEqual(links(), []);

  // Owner starts a link, signs out before coming back.
  const c = await passwordLogin(OWNER.username, OWNER.password);
  const second = await authorize(c, POCKET_OTHER, { link: true });
  c.jar.delete('nt_token');
  const r2 = await c.get(second.callback);
  assert.ok(outcome(r2).error, `no session refused: ${JSON.stringify(outcome(r2))}`);
  assert.equal(c.jar.get('nt_token'), undefined, 'and no sign-in either');
  assert.deepEqual(links(), []);
});

test('a signed-in user links their Pocket ID; that sub then signs in as exactly that user, with the password session', { skip: !ready }, async () => {
  const b = await passwordLogin(OWNER.username, OWNER.password);
  const { callback } = await authorize(b, POCKET_OWNER, { link: true });
  const r = await b.get(callback);
  assert.deepEqual(outcome(r), { ok: 'linked' });
  assert.deepEqual(links(), [{ user_id: 1, oidc_sub: 'pid-owner' }]);

  const fresh = new Browser();
  const login = await authorize(fresh, { ...POCKET_OWNER, email: OTHER.email });
  const r2 = await fresh.get(login.callback);
  assert.deepEqual(outcome(r2), { ok: 'ok' });
  const me = await fresh.me();
  assert.equal(me?.id, 1);
  assert.equal(me?.username, OWNER.username);
  // Same session as the password login: an nt_token JWT for the same user.
  const pw = await passwordLogin(OWNER.username, OWNER.password);
  const claimsOf = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
  const a = claimsOf(fresh.jar.get('nt_token')), p = claimsOf(pw.jar.get('nt_token'));
  assert.deepEqual([a.id, a.username, a.role], [p.id, p.username, p.role]);
  assert.deepEqual(Object.keys(a).sort(), Object.keys(p).sort());
});

test('a bound sub is never moved to another user, and a binding is never silently replaced', { skip: !ready }, async () => {
  // OTHER tries to link the owner's Pocket ID.
  const o = await passwordLogin(OTHER.username, OTHER.password);
  const { callback } = await authorize(o, POCKET_OWNER, { link: true });
  assert.ok(outcome(await o.get(callback)).error);
  // The owner, already bound, tries to bind a second Pocket ID identity.
  const b = await passwordLogin(OWNER.username, OWNER.password);
  const again = await authorize(b, POCKET_STRANGER, { link: true });
  assert.ok(outcome(await b.get(again.callback)).error);
  assert.deepEqual(links(), [{ user_id: 1, oidc_sub: 'pid-owner' }]);
});

test('bad state, replayed state and state from another browser are refused', { skip: !ready }, async () => {
  const b = new Browser();
  const { callback, state } = await authorize(b, POCKET_OWNER);
  const tampered = callback.replace(`state=${state}`, 'state=forged');
  assert.equal((await b.get(tampered)).status, 400);
  // Another browser (login CSRF: the attacker's code + state handed to a victim).
  const victim = new Browser();
  const r = await victim.get(callback);
  assert.ok(r.status === 400 || outcome(r).error, `foreign browser refused: ${r.status}`);
  assert.equal(victim.jar.get('nt_token'), undefined);
  // Single use.
  const b2 = new Browser();
  const once = await authorize(b2, POCKET_OWNER);
  assert.deepEqual(outcome(await b2.get(once.callback)), { ok: 'ok' });
  const replay = new Browser(); replay.jar = new Map(b2.jar); replay.jar.delete('nt_token');
  assert.equal((await replay.get(once.callback)).status, 400);
  assert.equal(replay.jar.get('nt_token'), undefined);
});

for (const tamper of ['nonce', 'signature', 'iss', 'aud', 'exp', 'alg-none']) {
  test(`an ID token with a bad ${tamper} is refused`, { skip: !ready }, async () => {
    const b = new Browser();
    const { callback } = await authorize(b, POCKET_OWNER, { tamper });
    const r = await b.get(callback);
    assert.deepEqual(outcome(r), { error: 'callback_failed' });
    assert.equal(b.jar.get('nt_token'), undefined);
  });
}

test('the token request is a confidential client with a PKCE verifier', { skip: !ready }, () => {
  const last = tokenRequests.at(-1);
  assert.equal(last.grant_type, 'authorization_code');
  assert.ok(last.code_verifier && last.code_verifier.length >= 43);
  assert.equal(last.client_secret, CLIENT_SECRET);
});

test('unlink removes the binding; the sub is then refused', { skip: !ready }, async () => {
  const b = await passwordLogin(OWNER.username, OWNER.password);
  const list = await (await b.get('/api/auth/oidc/links')).json();
  assert.equal(list.links.length, 1);
  const r = await b.post(`/api/auth/oidc/unlink/${list.links[0].id}`, {});
  assert.equal(r.status, 200);
  assert.deepEqual(links(), []);
  const fresh = new Browser();
  const { callback } = await authorize(fresh, POCKET_OWNER);
  assert.ok(outcome(await fresh.get(callback)).error);
  assert.equal(fresh.jar.get('nt_token'), undefined);
});

test('MCP and API tokens are untouched: an API token still authenticates', { skip: !ready }, async () => {
  const b = await passwordLogin(OWNER.username, OWNER.password);
  const me = await (await b.get('/api/auth/me')).json();
  const created = await b.post('/api/admin/api-tokens', { name: 'test', scopes: ['read:foods'] }, { 'x-csrf-token': me.csrf });
  assert.equal(created.status, 201, 'token created');
  const { raw } = await created.json();
  const r = await fetch(base + '/api/v1/me', { headers: { authorization: `Bearer ${raw}` } });
  assert.equal(r.status, 200);
  assert.equal((await fetch(base + '/api/v1/me', { headers: { authorization: 'Bearer nope' } })).status, 401);
});

test('without the client id/secret env the button is gone and the routes 404, even on a seeded database', { skip: !ready }, async () => {
  await stopServer();
  // Client id without a secret is not enough either.
  await startServer((port) => ({ ...oidcEnv(port), OIDC_CLIENT_SECRET: '' }));
  let s = await (await fetch(base + '/api/auth/status')).json();
  assert.deepEqual(s.oidc.providers, []);
  assert.equal((await fetch(base + '/api/auth/oidc/login/1', { redirect: 'manual' })).status, 404);
  await stopServer();

  await startServer(() => ({}));
  s = await (await fetch(base + '/api/auth/status')).json();
  assert.deepEqual(s.oidc.providers, []);
  assert.equal((await fetch(base + '/api/auth/oidc/login/1', { redirect: 'manual' })).status, 404);
  assert.deepEqual((await (await fetch(base + '/api/auth/oidc/providers')).json()).providers, []);
  // Password login is unaffected.
  await passwordLogin(OWNER.username, OWNER.password);
});
