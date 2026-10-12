/* Product images: POST /api/admin/images and GET /api/images/<key>. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryBucket } from '../dev/r2-local.mjs';
import { setup, API } from './helpers.mjs';

// a 1×1 transparent PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
// RIFF....WEBPVP8 header (content does not matter for the check)
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 0, 0, 0, 0]);

test('without an R2 bucket → 501 images_unavailable', async () => {
  const t = await setup({ stripe: false });
  const r = await t.call('POST', '/api/admin/images', { admin: true, raw: PNG, headers: { 'Content-Type': 'image/png' } });
  assert.equal(r.status, 501);
  assert.equal(r.json.code, 'images_unavailable');
  const g = await t.call('GET', `/api/images/${'a'.repeat(32)}.png`);
  assert.equal(g.status, 404);
  await t.close();
});

test('upload → URL → served with long cache; HEAD and If-None-Match work', async () => {
  const bucket = memoryBucket();
  const t = await setup({ stripe: false, env: { IMAGES: bucket } });
  const r = await t.call('POST', '/api/admin/images', { admin: true, raw: PNG, headers: { 'Content-Type': 'image/png' } });
  assert.equal(r.status, 200);
  assert.match(r.json.url, new RegExp(`^${API}/api/images/[0-9a-f]{32}\\.png$`));
  const path = new URL(r.json.url).pathname;
  assert.equal(bucket.items.size, 1);

  const g = await t.call('GET', path);
  assert.equal(g.status, 200);
  assert.deepEqual(g.bytes, PNG);
  assert.equal(g.headers.get('Content-Type'), 'image/png');
  assert.equal(g.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal(g.headers.get('X-Content-Type-Options'), 'nosniff');
  const etag = g.headers.get('ETag');
  assert.ok(etag);

  const h = await t.call('HEAD', path);
  assert.equal(h.status, 200);
  assert.equal(h.bytes.length, 0);
  const n = await t.call('GET', path, { headers: { 'If-None-Match': etag } });
  assert.equal(n.status, 304);

  const w = await t.call('POST', '/api/admin/images', { admin: true, raw: WEBP, headers: { 'Content-Type': 'image/webp' } });
  assert.equal(w.status, 200);
  assert.match(w.json.url, /\.webp$/);
  await t.close();
});

test('upload checks: admin only, type, real image bytes, 2MB', async () => {
  const t = await setup({ stripe: false, env: { IMAGES: memoryBucket() } });
  let r = await t.call('POST', '/api/admin/images', { raw: PNG, headers: { 'Content-Type': 'image/png' } });
  assert.equal(r.status, 401);
  r = await t.call('POST', '/api/admin/images', { admin: true, raw: PNG, headers: { 'Content-Type': 'image/gif' } });
  assert.equal(r.status, 415);
  r = await t.call('POST', '/api/admin/images', { admin: true, raw: '<svg onload=alert(1)>', headers: { 'Content-Type': 'image/svg+xml' } });
  assert.equal(r.status, 415);
  r = await t.call('POST', '/api/admin/images', { admin: true, raw: PNG, headers: { 'Content-Type': 'image/jpeg' } });
  assert.equal(r.status, 415);
  const big = new Uint8Array(2 * 1024 * 1024 + 1);
  big.set(PNG.subarray(0, 8));
  r = await t.call('POST', '/api/admin/images', { admin: true, raw: big, headers: { 'Content-Type': 'image/png' } });
  assert.equal(r.status, 413);
  assert.equal(r.json.code, 'too_large');
  for (const key of ['../secret', 'abc.png', `${'a'.repeat(32)}.svg`, `${'a'.repeat(32)}.png`]) {
    const g = await t.call('GET', `/api/images/${key}`);
    assert.equal(g.status, 404, key);
  }
  await t.close();
});
