/**
 * Fork (Suslicke/nutritrace): Trace's app_api tool reaches the user's data endpoints and never
 * account, server or backup administration.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedPath, runExtraTool, EXTRA_TOOLS } from '../src/lib/trace-extra.js';

test('data endpoints are allowed', () => {
  for (const p of ['/api/meals', '/api/meals/3', '/api/foods?q=x', '/api/diary/2026-10-24', '/api/settings']) assert.ok(allowedPath(p), p);
});

test('administration and odd paths are refused', () => {
  for (const p of ['/api/auth/change-password', '/api/admin/api-tokens', '/api/app-config', '/api/full-backup',
    '/api/mcp', '/api/ai/chat', '/api/foods/../auth', '/foods', '', undefined]) assert.equal(allowedPath(p), false, String(p));
});

test('other tools fall through, a refused path never calls the server', async () => {
  assert.equal(await runExtraTool('log_food', {}), null);
  assert.ok((await runExtraTool('app_api', { method: 'GET', path: '/api/admin/x' })).error);
  assert.deepEqual(EXTRA_TOOLS.map(t => t.name), ['app_api']);
});
