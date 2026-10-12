/* Stripe webhook (signature, finalize, expire), status endpoint and the cron sweep. */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { signWebhook, verifyWebhook } from '../src/stripe.js';
import { scheduled } from '../src/app.js';
import { insertOrder } from '../src/db.js';
import {
  setup, clock, checkout, customer, webhook, sessionEvent, editCatalog, adminCatalog, variant, orders, WHSEC,
} from './helpers.mjs';

const paid = (s, extra = {}) => ({ ...s, status: 'complete', payment_status: 'paid', payment_intent: 'pi_test_123', ...extra });
const pub = (s) => { const { _params, ...rest } = s; return rest; };

describe('webhook signature', () => {
  let t;
  let s;
  before(async () => {
    t = await setup();
    s = (await checkout(t)).session;
  });
  after(() => t.close());

  const ev = () => sessionEvent('checkout.session.completed', paid(pub(s)));

  test('verifyWebhook: valid, wrong secret, stale, future, tampered, several v1', async () => {
    const enc = (x) => new TextEncoder().encode(x);
    const now = 1_800_000_000;
    const body = '{"a":1}';
    const h = await signWebhook(body, WHSEC, now);
    assert.equal(await verifyWebhook(enc(body), h, WHSEC, { nowSec: now }), true);
    assert.equal(await verifyWebhook(enc(body), h, 'whsec_other', { nowSec: now }), false);
    assert.equal(await verifyWebhook(enc(body), h, WHSEC, { nowSec: now + 301 }), false);
    assert.equal(await verifyWebhook(enc(body), h, WHSEC, { nowSec: now - 301 }), false);
    assert.equal(await verifyWebhook(enc(body), h, WHSEC, { nowSec: now + 300 }), true);
    assert.equal(await verifyWebhook(enc('{"a":2}'), h, WHSEC, { nowSec: now }), false);
    const v1 = h.split('v1=')[1];
    assert.equal(await verifyWebhook(enc(body), `t=${now},v1=${'0'.repeat(64)},v1=${v1},v0=abc`, WHSEC, { nowSec: now }), true);
    assert.equal(await verifyWebhook(enc(body), `t=${now},v0=${v1}`, WHSEC, { nowSec: now }), false);
    assert.equal(await verifyWebhook(enc(body), `v1=${v1}`, WHSEC, { nowSec: now }), false);
    assert.equal(await verifyWebhook(enc(body), '', WHSEC, { nowSec: now }), false);
  });

  test('wrong secret / stale / tampered / missing header → 400 and nothing changes', async () => {
    const e = ev();
    const nowSec = Math.floor(t.now() / 1000);
    for (const res of [
      await webhook(t, e, { secret: 'whsec_wrong' }),
      await webhook(t, e, { ts: nowSec - 301 }),
      await webhook(t, JSON.stringify(e), { header: await signWebhook(JSON.stringify({ ...e, id: 'evt_other' }), WHSEC, nowSec) }),
      await t.call('POST', '/api/stripe/webhook', { raw: JSON.stringify(e), headers: { 'Content-Type': 'application/json' } }),
    ]) {
      assert.equal(res.status, 400);
      assert.equal(res.json.code, 'bad_signature');
    }
    assert.equal((await orders(t, 'paid')).length, 0);
  });

  test('a correct signature among several v1 values is accepted', async () => {
    const payload = JSON.stringify(ev());
    const good = await signWebhook(payload, WHSEC, Math.floor(t.now() / 1000));
    const header = good.replace('v1=', `v1=${'f'.repeat(64)},v1=`);
    const res = await webhook(t, payload, { header });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { received: true });
    assert.equal((await orders(t, 'paid')).length, 1);
  });

  test('missing STRIPE_WEBHOOK_SECRET → 503 so Stripe retries later', async () => {
    const t2 = await setup({ env: { STRIPE_WEBHOOK_SECRET: '' } });
    const res = await webhook(t2, ev());
    assert.equal(res.status, 503);
    await t2.close();
  });
});

describe('finalize', () => {
  test('completed webhook → paid, stock taken once even when delivered twice (or at once)', async () => {
    const t = await setup();
    await editCatalog(t, (c) => { variant(c, 'shinmai-r8', '5kg').stock = 5; });
    const { session, orderNo } = await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 2 }] });
    const e = sessionEvent('checkout.session.completed', paid(pub(session)));
    assert.equal((await webhook(t, e)).status, 200);
    assert.equal((await webhook(t, e)).status, 200);
    let c = await adminCatalog(t);
    assert.equal(variant(c.catalog, 'shinmai-r8', '5kg').stock, 3);
    const [o] = await orders(t, 'paid');
    assert.equal(o.no, orderNo);
    assert.equal(o.payment, 'paid');
    assert.equal(o.paidAt, new Date(t.now()).toISOString());
    assert.equal(o.stripe.paymentIntent, 'pi_test_123');
    assert.equal(o.stripe.sessionId, session.id);
    assert.equal(o.stockShort, undefined);
    assert.equal(o.amountMismatch, undefined);

    // two deliveries racing each other
    const second = await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 1 }] });
    const e2 = sessionEvent('checkout.session.completed', paid(pub(second.session)));
    const rs = await Promise.all([webhook(t, e2), webhook(t, e2), webhook(t, e2)]);
    assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]);
    c = await adminCatalog(t);
    assert.equal(variant(c.catalog, 'shinmai-r8', '5kg').stock, 2);
    await t.close();
  });

  test('paid orders for more than the stock (lowered by the admin meanwhile) → stock clamps at 0, stockShort recorded', async () => {
    const t = await setup();
    await editCatalog(t, (c) => { variant(c, 'shinmai-r8', '10kg').stock = 4; });
    const a = await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '10kg', qty: 2 }] });
    const b = await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '10kg', qty: 2 }] });
    assert.equal(a.res.status, 200);
    assert.equal(b.res.status, 200);
    // the admin corrects the stock while both shoppers are on Stripe's page (not to 0: both stay open)
    await editCatalog(t, (c) => { variant(c, 'shinmai-r8', '10kg').stock = 3; });
    assert.equal((await orders(t, 'pending')).length, 2);
    await webhook(t, sessionEvent('checkout.session.completed', paid(pub(a.session))));
    await webhook(t, sessionEvent('checkout.session.completed', paid(pub(b.session))));
    const c = await adminCatalog(t);
    assert.equal(variant(c.catalog, 'shinmai-r8', '10kg').stock, 0);
    const ob = (await orders(t, 'paid')).find((o) => o.no === b.orderNo);
    assert.deepEqual(ob.stockShort, [{ pid: 'shinmai-r8', vid: '10kg', name: '満月米 ななつぼし 新米 令和8年産 10kg（5kg×2袋）', short: 1 }]);
    await t.close();
  });

  test('an admin save between checkout and payment does not lose the stock change', async () => {
    const t = await setup();
    await editCatalog(t, (c) => { variant(c, 'genmai-30kg', '30kg').stock = 10; });
    const a = await checkout(t, { items: [{ pid: 'genmai-30kg', vid: '30kg', qty: 4 }] });
    await editCatalog(t, (c) => { c.settings.news.text = 'お知らせを変更'; });
    await webhook(t, sessionEvent('checkout.session.completed', paid(pub(a.session))));
    const c = await adminCatalog(t);
    assert.equal(variant(c.catalog, 'genmai-30kg', '30kg').stock, 6);
    assert.equal(c.catalog.settings.news.text, 'お知らせを変更');
    await t.close();
  });

  test('amount or currency differs → still paid, flagged amountMismatch', async () => {
    const t = await setup();
    const a = await checkout(t);
    await webhook(t, sessionEvent('checkout.session.completed', paid(pub(a.session), { amount_total: 1 })));
    const [o] = await orders(t, 'paid');
    assert.deepEqual(o.amountMismatch, { expected: o.total, received: 1, currency: 'jpy' });
    await t.close();
  });

  test('a session that does not carry the order number is not finalized', async () => {
    const t = await setup();
    const a = await checkout(t);
    await webhook(t, sessionEvent('checkout.session.completed', paid(pub(a.session), { client_reference_id: 'MG-000000-0000', metadata: {} })));
    assert.equal((await orders(t, 'paid')).length, 0);
    await t.close();
  });

  test('unpaid completed session, unknown session and other events are acknowledged and ignored', async () => {
    const t = await setup();
    const a = await checkout(t);
    let r = await webhook(t, sessionEvent('checkout.session.completed', { ...pub(a.session), status: 'complete', payment_status: 'unpaid' }));
    assert.equal(r.status, 200);
    r = await webhook(t, sessionEvent('checkout.session.completed', paid({ ...pub(a.session), id: 'cs_test_unknown', client_reference_id: 'MG-990101-0001', metadata: { order_no: 'MG-990101-0001' } })));
    assert.equal(r.status, 200);
    r = await webhook(t, { id: 'evt_1', object: 'event', type: 'payment_intent.succeeded', data: { object: { object: 'payment_intent' } } });
    assert.equal(r.status, 200);
    assert.equal((await orders(t, 'pending')).length, 1);
    await t.close();
  });

  test('async_payment_succeeded finalizes; the session id is recovered from the order number', async () => {
    const t = await setup();
    const a = await checkout(t);
    // as if the Worker had stopped before saving the session id
    await t.env.DB.prepare('UPDATE orders SET session_id = NULL WHERE no = ?').bind(a.orderNo).run();
    await webhook(t, sessionEvent('checkout.session.async_payment_succeeded', paid(pub(a.session))));
    const [o] = await orders(t, 'paid');
    assert.equal(o.no, a.orderNo);
    assert.equal(o.stripe.sessionId, a.session.id);
    const st = await t.call('GET', `/api/checkout/status?session_id=${a.session.id}`);
    assert.equal(st.json.payment, 'paid');
    await t.close();
  });
});

describe('expire', () => {
  test('expired / async_payment_failed → pending order expired; a paid order is never expired', async () => {
    const t = await setup();
    const a = await checkout(t);
    const b = await checkout(t);
    const c = await checkout(t);
    await webhook(t, sessionEvent('checkout.session.expired', { ...pub(a.session), status: 'expired' }));
    await webhook(t, sessionEvent('checkout.session.async_payment_failed', pub(b.session)));
    await webhook(t, sessionEvent('checkout.session.completed', paid(pub(c.session))));
    await webhook(t, sessionEvent('checkout.session.expired', { ...pub(c.session), status: 'expired' }));
    const all = await orders(t, 'all');
    const by = (no) => all.find((o) => o.no === no).payment;
    assert.equal(by(a.orderNo), 'expired');
    assert.equal(by(b.orderNo), 'expired');
    assert.equal(by(c.orderNo), 'paid');
    await t.close();
  });

  test('the fake Stripe\'s expire endpoint sends a signed webhook the API accepts', async () => {
    const t = await setup();
    const { serve } = await import('../dev/node-adapter.mjs');
    const { handle } = await import('../src/app.js');
    const api = await serve(handle, t.env);
    t.fake.setWebhookUrl(`${api.url}/api/stripe/webhook`);
    const a = await checkout(t);
    const r = await fetch(`${t.fake.url}/v1/checkout/sessions/${a.sessionId}/expire`, { method: 'POST', headers: { Authorization: `Bearer ${t.fake.secretKey}` } });
    assert.equal(r.status, 200);
    assert.equal(t.fake.events.at(-1).status, 200);
    const [o] = await orders(t, 'all');
    assert.equal(o.payment, 'expired');
    await api.close();
    await t.close();
  });
});

describe('status endpoint', () => {
  test('answers for the thanks page and falls back to Stripe while pending', async () => {
    const t = await setup();
    const a = await checkout(t, { customer: customer({ name1: '満月', name2: '太郎' }) });
    let st = await t.call('GET', `/api/checkout/status?session_id=${a.sessionId}`);
    assert.equal(st.status, 200);
    assert.deepEqual(st.json, { orderNo: a.orderNo, payment: 'pending', name: '満月 太郎', total: a.res.json.total, preorder: false, mixed: false, preorderShip: '', eventNote: '' });
    assert.equal(st.headers.get('Cache-Control'), 'no-store');

    // paid at Stripe, webhook not delivered yet → the status call finalizes the order
    await t.fake.pay(a.sessionId, { webhook: false });
    st = await t.call('GET', `/api/checkout/status?session_id=${a.sessionId}`);
    assert.equal(st.json.payment, 'paid');
    const [o] = await orders(t, 'paid');
    assert.equal(o.no, a.orderNo);
    assert.match(o.stripe.paymentIntent, /^pi_test_/);

    // expired at Stripe without a webhook
    const b = await checkout(t);
    await t.fake.expire(b.sessionId, { webhook: false });
    st = await t.call('GET', `/api/checkout/status?session_id=${b.sessionId}`);
    assert.equal(st.json.payment, 'expired');

    // still open → stays pending
    const c = await checkout(t);
    st = await t.call('GET', `/api/checkout/status?session_id=${c.sessionId}`);
    assert.equal(st.json.payment, 'pending');
    await t.close();
  });

  test('unknown or malformed session → 404 not_found', async () => {
    const t = await setup();
    for (const q of ['session_id=cs_test_doesnotexist', 'session_id=', 'session_id=<script>', '']) {
      const r = await t.call('GET', `/api/checkout/status?${q}`);
      assert.equal(r.status, 404);
      assert.equal(r.json.code, 'not_found');
    }
    await t.close();
  });

  test('event orders carry the event note', async () => {
    const t = await setup({ now: clock('2026-10-25T02:00:00Z') });
    const a = await checkout(t, { source: 'takanawa' });
    const st = await t.call('GET', `/api/checkout/status?session_id=${a.sessionId}`);
    assert.equal(st.json.eventNote, 'イベントでのご注文は、1か月後をめどに順次お届けします。');
    await t.close();
  });
});

describe('cron sweep', () => {
  test('settles pending orders whose webhook never came, and expires orphans', async () => {
    const now = clock('2026-10-12T03:00:00Z');
    const t = await setup({ now });
    const a = await checkout(t);
    const b = await checkout(t);
    await t.fake.pay(a.sessionId, { webhook: false });
    await t.fake.expire(b.sessionId, { webhook: false });
    const orphan = await insertOrder(t.env, { at: new Date(now()).toISOString(), status: 'new', payment: 'pending', items: [], total: 1 }, now());
    await scheduled(t.env); // too early: nothing happens
    assert.equal((await orders(t, 'pending')).length, 3);
    now.advance(80 * 60 * 1000);
    await scheduled(t.env);
    const all = await orders(t, 'all');
    const by = (no) => all.find((o) => o.no === no).payment;
    assert.equal(by(a.orderNo), 'paid');
    assert.equal(by(b.orderNo), 'expired');
    assert.equal(by(orphan.no), 'expired');
    await t.close();
  });

  test('sessions Stripe does not know (e.g. test mode after switching to the live key) are expired, so they cannot block newer orders', async () => {
    const now = clock('2026-10-12T03:00:00Z');
    const t = await setup({ now });
    const lost = [];
    for (let i = 0; i < 25; i++) { lost.push(await checkout(t)); now.advance(1000); }
    const real = await checkout(t);
    for (const o of lost) t.fake.sessions.delete(o.sessionId);
    await t.fake.pay(real.sessionId, { webhook: false });
    now.advance(80 * 60 * 1000);
    await scheduled(t.env);
    assert.equal((await orders(t, 'expired')).length, 20);
    await scheduled(t.env);
    const all = await orders(t, 'all');
    assert.equal(all.find((o) => o.no === real.orderNo).payment, 'paid');
    assert.equal(all.filter((o) => o.payment === 'expired').length, 25);
    // a late webhook for an expired order still finalizes it (money was taken)
    const late = lost[0];
    await webhook(t, sessionEvent('checkout.session.completed', paid(pub(late.session))));
    assert.equal((await orders(t, 'all')).find((o) => o.no === late.orderNo).payment, 'paid');
    await t.close();
  });

  test('orders that keep failing move to the back: the next run reaches the others', async () => {
    const now = clock('2026-10-12T03:00:00Z');
    const t = await setup({ now });
    for (let i = 0; i < 20; i++) { await checkout(t); now.advance(1000); }
    const real = await checkout(t);
    await t.fake.pay(real.sessionId, { webhook: false });
    now.advance(80 * 60 * 1000);
    t.fake.failNext(20 * 3, { status: 503 }); // every lookup of the 20 oldest fails (3 tries each)
    const logs = [];
    const orig = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    try { await scheduled(t.env); } finally { console.log = orig; }
    assert.match(logs.join('\n'), /"checked":20,"failed":20/);
    assert.equal((await orders(t, 'pending')).length, 21);
    await scheduled(t.env);
    assert.equal((await orders(t, 'all')).find((o) => o.no === real.orderNo).payment, 'paid');
    await t.close();
  });

  test('old request-limit rows are pruned', async () => {
    const now = clock('2026-10-12T03:00:00Z');
    const t = await setup({ now });
    await t.call('POST', '/api/checkout', { body: (await import('./helpers.mjs')).checkoutBody(), headers: { 'CF-Connecting-IP': '203.0.113.5' } });
    await t.call('GET', '/api/admin/session', { admin: 'wrong-password-guess-xxxxxxxxxxxxx', headers: { 'CF-Connecting-IP': '203.0.113.5' } });
    const rows = () => t.env.DB.db.prepare('SELECT (SELECT COUNT(*) FROM rate_limits) + (SELECT COUNT(*) FROM admin_failures) AS n').get().n;
    assert.equal(rows(), 2);
    now.advance(25 * 60 * 60 * 1000);
    await scheduled(t.env);
    assert.equal(rows(), 0);
    await t.close();
  });
});
