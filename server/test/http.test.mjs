/* Routing, CORS, response headers, errors. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/app.js';
import { setup, checkoutBody, ORIGIN, ADMIN } from './helpers.mjs';

test('CORS: an allowed origin is echoed, others get no CORS headers', async () => {
  const t = await setup({ stripe: false });
  let r = await t.call('GET', '/api/catalog', { headers: { Origin: ORIGIN } });
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(r.headers.get('Vary'), /Origin/);
  r = await t.call('GET', '/api/catalog', { headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
  // errors carry CORS headers too (so the shop can read the message)
  r = await t.call('GET', '/api/admin/session', { headers: { Origin: ORIGIN } });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  await t.close();
});

test('CORS: preflight for allowed origins only', async () => {
  const t = await setup({ stripe: false });
  let r = await t.call('OPTIONS', '/api/checkout', { headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(r.headers.get('Access-Control-Allow-Methods'), 'GET, POST, PUT, PATCH, OPTIONS');
  assert.equal(r.headers.get('Access-Control-Allow-Headers'), 'Content-Type, Authorization');
  r = await t.call('OPTIONS', '/api/admin/catalog', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'PUT' } });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
  await t.close();
});

test('changes from a page on another site are refused; the webhook is exempt', async () => {
  const t = await setup();
  let r = await t.call('POST', '/api/checkout', { body: checkoutBody(), headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'forbidden_origin');
  r = await t.call('PUT', '/api/admin/catalog', { admin: true, body: {}, headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  // no Origin (server-to-server, curl) is fine
  r = await t.call('POST', '/api/checkout', { body: checkoutBody() });
  assert.equal(r.status, 200);
  // the webhook is authenticated by its signature instead
  r = await t.call('POST', '/api/stripe/webhook', { raw: '{}', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'bad_signature');
  await t.close();
});

test('unknown route → 404 JSON; wrong method → 405 with Allow', async () => {
  const t = await setup({ stripe: false });
  let r = await t.call('GET', '/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.json.code, 'not_found');
  assert.ok(r.json.error);
  r = await t.call('GET', '/');
  assert.equal(r.status, 404);
  r = await t.call('DELETE', '/api/catalog');
  assert.equal(r.status, 405);
  assert.equal(r.json.code, 'method_not_allowed');
  assert.equal(r.headers.get('Allow'), 'GET');
  r = await t.call('GET', '/api/checkout');
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('Allow'), 'POST');
  r = await t.call('GET', '/api/admin/orders/%E0%A4%A');
  assert.equal(r.status, 404);
  r = await t.call('GET', '/api/health');
  assert.deepEqual(r.json, { ok: true });
  await t.close();
});

test('JSON responses: no-store, nosniff, UTF-8', async () => {
  const t = await setup({ stripe: false });
  const r = await t.call('GET', '/api/catalog');
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(r.headers.get('Content-Type'), 'application/json; charset=utf-8');
  await t.close();
});

test('unexpected failures → 500 server_error with a generic message (nothing internal leaks)', async () => {
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    const res = await handle(new Request('https://api.example/api/catalog'), {});
    assert.equal(res.status, 500);
    const j = await res.json();
    assert.equal(j.code, 'server_error');
    assert.equal(j.error, 'サーバーでエラーが発生しました。時間をおいて、もう一度お試しください。');
    assert.ok(!JSON.stringify(j).includes('D1'));
    // admin with a broken database: still a generic 500
    const r2 = await handle(new Request('https://api.example/api/admin/session', { headers: { Authorization: `Bearer ${ADMIN}` } }), { ADMIN_TOKEN: ADMIN });
    assert.equal(r2.status, 500);
  } finally {
    console.error = orig;
  }
  assert.ok(errors.length >= 1);
});
