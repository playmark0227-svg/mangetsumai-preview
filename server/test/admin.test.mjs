/* Admin API: authentication, catalog read/write with conflicts, orders. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Core from '../src/core.js';
import { setup, clock, checkout, webhook, sessionEvent, orders, ADMIN } from './helpers.mjs';

const ROUTES = [
  ['GET', '/api/admin/session'],
  ['GET', '/api/admin/catalog'],
  ['PUT', '/api/admin/catalog'],
  ['GET', '/api/admin/orders'],
  ['PATCH', '/api/admin/orders/MG-261012-0001'],
  ['POST', '/api/admin/images'],
];
const pub = (s) => { const { _params, ...rest } = s; return rest; };

describe('admin authentication', () => {
  test('no token / wrong token → 401 on every admin route', async () => {
    const t = await setup({ stripe: false });
    for (const [m, p] of ROUTES) {
      for (const admin of [undefined, 'wrong-token-but-long-enough', `${ADMIN}x`, ADMIN.slice(0, -1)]) {
        const r = await t.call(m, p, { admin, body: m === 'GET' ? undefined : {}, headers: { 'CF-Connecting-IP': `10.0.0.${ROUTES.findIndex((x) => x[1] === p)}` } });
        assert.equal(r.status, 401, `${m} ${p} ${admin}`);
        assert.equal(r.json.code, 'unauthorized');
      }
    }
    const ok = await t.call('GET', '/api/admin/session', { admin: true });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { ok: true });
    // "Bearer" is case-insensitive
    const lower = await t.call('GET', '/api/admin/session', { headers: { Authorization: `bearer ${ADMIN}` } });
    assert.equal(lower.status, 200);
    await t.close();
  });

  test('ADMIN_TOKEN unset or shorter than 32 characters → admin is off, even with that token', async () => {
    for (const token of [undefined, '', 'short-token-15c', 'mangetsumai-2026', 'a-password-of-31-characters-xyz']) {
      const t = await setup({ stripe: false, env: { ADMIN_TOKEN: token } });
      for (const [m, p] of ROUTES) {
        const r = await t.call(m, p, { admin: token || 'x', body: m === 'GET' ? undefined : {} });
        assert.equal(r.status, 503, `${m} ${p} ${token}`);
        assert.equal(r.json.code, 'admin_unavailable');
        assert.match(r.json.error, /32文字以上/);
      }
      await t.close();
    }
  });

  test('10 wrong passwords from one address lock it for 15 minutes; other addresses are fine', async () => {
    const now = clock();
    const t = await setup({ stripe: false, now });
    const from = (ip, admin) => t.call('GET', '/api/admin/session', { admin, headers: { 'CF-Connecting-IP': ip } });
    for (let i = 0; i < 10; i++) assert.equal((await from('203.0.113.9', 'wrong-password-guess')).status, 401);
    const locked = await from('203.0.113.9', ADMIN);
    assert.equal(locked.status, 429);
    assert.equal(locked.json.code, 'too_many_attempts');
    assert.equal(locked.headers.get('Retry-After'), '900');
    assert.equal((await from('198.51.100.1', ADMIN)).status, 200);
    // requests without any password do not count
    for (let i = 0; i < 12; i++) await from('198.51.100.2', undefined);
    assert.equal((await from('198.51.100.2', ADMIN)).status, 200);
    now.advance(15 * 60 * 1000 + 1000);
    assert.equal((await from('203.0.113.9', ADMIN)).status, 200);
    await t.close();
  });
});

describe('admin catalog', () => {
  test('GET includes drafts, the public catalog does not', async () => {
    const t = await setup({ stripe: false });
    const a = await t.call('GET', '/api/admin/catalog', { admin: true });
    assert.equal(a.status, 200);
    assert.equal(a.json.rev, 0);
    assert.deepEqual(a.json.catalog.products.map((p) => p.id), ['shinmai-r8', 'genmai-30kg', 'teiki']);
    assert.deepEqual(a.json.catalog, Core.normalize(Core.clone(Core.DEFAULT_CATALOG)));
    const p = await t.call('GET', '/api/catalog');
    assert.equal(p.status, 200);
    assert.deepEqual(p.json.catalog.products.map((x) => x.id), ['shinmai-r8', 'genmai-30kg']);
    assert.equal(p.headers.get('Cache-Control'), 'no-store');
    await t.close();
  });

  test('PUT saves a normalized copy, bumps rev, and refuses a stale rev with the latest data', async () => {
    const t = await setup({ stripe: false });
    const { catalog } = (await t.call('GET', '/api/admin/catalog', { admin: true })).json;
    catalog.products[0].variants[0].price = '3800';
    catalog.products[0].variants[0].weight = 99; // clamped to 30
    catalog.products[0].extra = 'dropped';
    catalog.settings.ship.rates.kanto[0] = 900;
    let r = await t.call('PUT', '/api/admin/catalog', { admin: true, body: { catalog, rev: 0 } });
    assert.equal(r.status, 200);
    assert.equal(r.json.rev, 1);
    assert.equal(r.json.catalog.products[0].variants[0].price, 3800);
    assert.equal(r.json.catalog.products[0].variants[0].weight, 30);
    assert.equal(r.json.catalog.products[0].extra, undefined);
    assert.equal(r.json.catalog.settings.ship.rates.kanto[0], 900);

    // public catalog follows
    const p = await t.call('GET', '/api/catalog');
    assert.equal(p.json.rev, 1);
    assert.equal(p.json.catalog.products[0].variants[0].price, 3800);

    // second editor still on rev 0
    catalog.settings.news.text = '古い画面からの保存';
    r = await t.call('PUT', '/api/admin/catalog', { admin: true, body: { catalog, rev: 0 } });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'conflict');
    assert.equal(r.json.details.rev, 1);
    assert.equal(r.json.details.catalog.products[0].variants[0].price, 3800);
    assert.notEqual(r.json.details.catalog.settings.news.text, '古い画面からの保存');

    // a rev from the future is a conflict too
    r = await t.call('PUT', '/api/admin/catalog', { admin: true, body: { catalog, rev: 7 } });
    assert.equal(r.status, 409);
    r = await t.call('PUT', '/api/admin/catalog', { admin: true, body: { catalog, rev: 1 } });
    assert.equal(r.status, 200);
    assert.equal(r.json.rev, 2);
    await t.close();
  });

  test('PUT refuses malformed bodies (never resets the shop) and oversize data', async () => {
    const t = await setup({ stripe: false });
    const good = (await t.call('GET', '/api/admin/catalog', { admin: true })).json.catalog;
    for (const body of [{ rev: 0 }, { catalog: { products: [] }, rev: 0 }, { catalog: 'x', rev: 0 }, { catalog: good, rev: -1 }, { catalog: good, rev: '0' }, { catalog: good }]) {
      const r = await t.call('PUT', '/api/admin/catalog', { admin: true, body });
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(r.json.code, 'invalid');
    }
    // normalized data over ~1.8MB
    const big = structuredClone(good);
    big.products[0].lead = 'あ'.repeat(700_000); // 2.1MB in UTF-8
    let r = await t.call('PUT', '/api/admin/catalog', { admin: true, body: { catalog: big, rev: 0 } });
    assert.equal(r.status, 413);
    assert.equal(r.json.code, 'too_large');
    // request body over the read limit
    big.products[0].lead = 'x'.repeat(2_600_000);
    r = await t.call('PUT', '/api/admin/catalog', { admin: true, body: { catalog: big, rev: 0 } });
    assert.equal(r.status, 413);
    assert.equal((await t.call('GET', '/api/admin/catalog', { admin: true })).json.rev, 0);
    await t.close();
  });
});

describe('admin orders', () => {
  test('list newest first with a payment filter; PATCH status', async () => {
    const now = clock('2026-10-12T03:00:00Z');
    const t = await setup({ now });
    const a = await checkout(t);
    now.advance(60_000);
    const b = await checkout(t);
    now.advance(60_000);
    const c = await checkout(t);
    now.advance(60_000);
    await webhook(t, sessionEvent('checkout.session.completed', { ...pub(a.session), status: 'complete', payment_status: 'paid', payment_intent: 'pi_1' }));
    await webhook(t, sessionEvent('checkout.session.completed', { ...pub(c.session), status: 'complete', payment_status: 'paid', payment_intent: 'pi_2' }));
    await webhook(t, sessionEvent('checkout.session.expired', { ...pub(b.session), status: 'expired' }));

    let r = await t.call('GET', '/api/admin/orders', { admin: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.orders.map((o) => o.no), [c.orderNo, a.orderNo]); // default: paid, newest first
    assert.deepEqual((await orders(t, 'expired')).map((o) => o.no), [b.orderNo]);
    assert.deepEqual((await orders(t, 'pending')).map((o) => o.no), []);
    assert.deepEqual((await orders(t, 'all')).map((o) => o.no), [c.orderNo, b.orderNo, a.orderNo]);
    r = await t.call('GET', '/api/admin/orders?payment=bogus', { admin: true });
    assert.equal(r.status, 400);

    r = await t.call('PATCH', `/api/admin/orders/${a.orderNo}`, { admin: true, body: { status: 'shipped', total: 1 } });
    assert.equal(r.status, 200);
    assert.equal(r.json.order.status, 'shipped');
    assert.equal(r.json.order.payment, 'paid');
    assert.equal(r.json.order.total, a.res.json.total);
    assert.equal((await orders(t, 'paid')).find((o) => o.no === a.orderNo).status, 'shipped');

    for (const [no, body, status] of [
      [a.orderNo, { status: 'lost' }, 400],
      [a.orderNo, {}, 400],
      ['MG-000000-0000', { status: 'new' }, 404],
      ['not-an-order', { status: 'new' }, 404],
    ]) {
      r = await t.call('PATCH', `/api/admin/orders/${encodeURIComponent(no)}`, { admin: true, body });
      assert.equal(r.status, status, `${no} ${JSON.stringify(body)}`);
    }
    await t.close();
  });
});
