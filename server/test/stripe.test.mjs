/* The Stripe side: pinned API version, retries with the same idempotency key, cancelling a
 * Checkout Session, and webhook endpoints that send Thin events. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/app.js';
import { createD1 } from '../dev/d1-sqlite.mjs';
import { DEFAULT_API_VERSION } from '../src/stripe.js';
import {
  setup, checkout, checkoutBody, customer, webhook, sessionEvent, orders, sessionRequests, ORIGIN, API,
} from './helpers.mjs';

const pub = (s) => { const { _params, ...rest } = s; return rest; };
const cancel = (t, sessionId, headers = {}) => t.call('POST', '/api/checkout/cancel', { body: { session_id: sessionId }, headers: { Origin: ORIGIN, ...headers } });
const thinEvent = (type, sessionId) => ({
  id: `evt_test_${Math.random().toString(36).slice(2)}`, object: 'v2.core.event', type, livemode: false, created: '2026-10-12T03:00:00.000Z', context: null,
  reason: null, related_object: { id: sessionId, type: 'checkout.session', url: `/v1/checkout/sessions/${sessionId}` },
});

describe('API version', () => {
  test('every Stripe request names the pinned version, whatever the account default is', async () => {
    const t = await setup();
    for (const v of ['2026-09-30.endive', '2025-08-27.basil', '2027-03-31.future']) {
      t.fake.setAccountVersion(v);
      const a = await checkout(t);
      assert.equal(a.res.status, 200, `${v}: ${JSON.stringify(a.res.json)}`);
    }
    const a = await checkout(t);
    await t.call('GET', `/api/checkout/status?session_id=${a.sessionId}`);
    await cancel(t, a.sessionId);
    assert.ok(t.fake.requests.length >= 6);
    for (const r of t.fake.requests) assert.equal(r.headers['stripe-version'], DEFAULT_API_VERSION, `${r.method} ${r.path}`);
    assert.equal(DEFAULT_API_VERSION, '2026-09-30.endive');
    await t.close();
  });

  test('the old request shape would fail on an endive account (what the pin prevents)', async () => {
    const t = await setup();
    const r = await fetch(`${t.fake.url}/v1/checkout/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t.fake.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'mode=payment&payment_method_types[0]=card&success_url=https://x.example/s&cancel_url=https://x.example/c&line_items[0][quantity]=1&line_items[0][price_data][currency]=jpy&line_items[0][price_data][unit_amount]=3600&line_items[0][price_data][product_data][name]=x',
    });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.param, 'payment_method_types');
    await t.close();
  });

  test('STRIPE_API_VERSION set to an older version → payment_method_types is sent instead', async () => {
    const t = await setup({ env: { STRIPE_API_VERSION: '2026-08-26.dahlia' } });
    const a = await checkout(t);
    assert.equal(a.res.status, 200, JSON.stringify(a.res.json));
    const [req] = sessionRequests(t);
    assert.equal(req.headers['stripe-version'], '2026-08-26.dahlia');
    assert.deepEqual(req.form.payment_method_types, ['card']);
    assert.equal(req.form.allowed_payment_method_types, undefined);
    await t.close();
  });
});

describe('retries and idempotency keys', () => {
  test('a 503 / 429 / 409 from Stripe is retried with the same key and body', async () => {
    for (const status of [503, 429, 409, 500]) {
      const t = await setup();
      t.fake.failNext(2, { status });
      const a = await checkout(t);
      assert.equal(a.res.status, 200, `${status}: ${JSON.stringify(a.res.json)}`);
      const reqs = sessionRequests(t);
      assert.equal(reqs.length, 3);
      assert.equal(new Set(reqs.map((r) => r.headers['idempotency-key'])).size, 1);
      assert.equal(new Set(reqs.map((r) => r.body)).size, 1);
      assert.equal(t.fake.sessions.size, 1);
      await t.close();
    }
  });

  test('the answer was lost after Stripe created the session → the retry gets that same session', async () => {
    const t = await setup();
    t.fake.failNext(1, { drop: true });
    const a = await checkout(t);
    assert.equal(a.res.status, 200, JSON.stringify(a.res.json));
    assert.equal(t.fake.sessions.size, 1); // no second session
    assert.equal(a.res.json.sessionId, [...t.fake.sessions.keys()][0]);
    assert.equal(sessionRequests(t).length, 2);
    const [o] = await orders(t, 'pending');
    assert.equal(o.stripe.sessionId, a.sessionId);
    await t.close();
  });

  test('three failures in a row → 502 (and the order is expired); Stripe-Should-Retry: false is not retried', async () => {
    let t = await setup();
    t.fake.failNext(3, { status: 503 });
    let r = await t.call('POST', '/api/checkout', { body: checkoutBody() });
    assert.equal(r.status, 502);
    assert.equal(sessionRequests(t).length, 3);
    assert.equal((await orders(t, 'expired')).length, 1);
    await t.close();

    t = await setup();
    t.fake.failNext(1, { status: 500, headers: { 'Stripe-Should-Retry': 'false' } });
    r = await t.call('POST', '/api/checkout', { body: checkoutBody() });
    assert.equal(r.status, 502);
    assert.equal(sessionRequests(t).length, 1);
    await t.close();
  });

  test('a 400 (a refused request) is not retried', async () => {
    const t = await setup();
    const r = await t.call('POST', '/api/checkout', { body: checkoutBody(), headers: {} });
    assert.equal(r.status, 200);
    t.fake.failNext(1, { status: 400 });
    // another shopper (the same order again would first close the earlier checkout at Stripe)
    const r2 = await t.call('POST', '/api/checkout', { body: checkoutBody({ customer: customer({ email: 'taro@example.com' }) }) });
    assert.equal(r2.status, 502);
    assert.equal(sessionRequests(t).length, 2);
    await t.close();
  });

  test('two databases with the same order number (local + deployed on one Stripe test account) do not clash', async () => {
    const t = await setup();
    t.env.orderDigits = () => '12345678';
    const env2 = { ...t.env, DB: createD1() };
    const a = await checkout(t);
    const res = await handle(new Request(`${API}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(checkoutBody({ items: [{ pid: 'shinmai-r8', vid: '10kg', qty: 1 }] })) }), env2);
    const b = await res.json();
    assert.equal(a.orderNo, 'MG-261012-12345678');
    assert.equal(res.status, 200, JSON.stringify(b));
    assert.equal(b.orderNo, a.orderNo);
    assert.notEqual(b.sessionId, a.sessionId);
    env2.DB.close();
    await t.close();
  });
});

describe('POST /api/checkout/cancel', () => {
  test('the checkout answer carries the session id', async () => {
    const t = await setup();
    const a = await checkout(t);
    assert.equal(a.res.json.sessionId, a.sessionId);
    assert.match(a.res.json.sessionId, /^cs_test_/);
    await t.close();
  });

  test('back from Stripe without paying, then a new checkout: the old session can no longer be paid', async () => {
    const t = await setup();
    const a = await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 2 }] });
    // the shopper presses 戻る on Stripe (the session stays open, like Stripe), the shop cancels it
    const back = await fetch(`${t.fake.url}/pay/${a.sessionId}/cancel`, { method: 'POST', redirect: 'manual' });
    assert.equal(back.status, 303);
    const r = await cancel(t, a.sessionId);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.payment, 'expired');
    assert.equal(r.json.orderNo, a.orderNo);
    assert.equal(t.fake.sessions.get(a.sessionId).status, 'expired');
    // paying the old page later fails
    const late = await fetch(`${t.fake.url}/pay/${a.sessionId}/pay`, { method: 'POST', redirect: 'manual' });
    assert.equal(late.status, 400);
    const b = await checkout(t);
    await t.fake.pay(b.sessionId, { webhook: false });
    await t.call('GET', `/api/checkout/status?session_id=${b.sessionId}`);
    assert.deepEqual((await orders(t, 'paid')).map((o) => o.no), [b.orderNo]);
    assert.deepEqual((await orders(t, 'expired')).map((o) => o.no), [a.orderNo]);
    await t.close();
  });

  test('a paid order is never cancelled; a session paid at Stripe (webhook not here yet) is finalized', async () => {
    const t = await setup();
    const a = await checkout(t);
    await t.fake.pay(a.sessionId, { webhook: false });
    let r = await cancel(t, a.sessionId);
    assert.equal(r.status, 200);
    assert.equal(r.json.payment, 'paid');
    r = await cancel(t, a.sessionId);
    assert.equal(r.json.payment, 'paid');
    assert.equal((await orders(t, 'paid')).length, 1);
    await t.close();
  });

  test('cancelling twice, an unknown session, a malformed id, a session Stripe does not know', async () => {
    const t = await setup();
    const a = await checkout(t);
    assert.equal((await cancel(t, a.sessionId)).json.payment, 'expired');
    assert.equal((await cancel(t, a.sessionId)).json.payment, 'expired');
    for (const id of ['cs_test_unknown', '', 'x', 123]) {
      const r = await cancel(t, id);
      assert.equal(r.status, 404, String(id));
      assert.equal(r.json.code, 'not_found');
    }
    const b = await checkout(t);
    t.fake.sessions.delete(b.sessionId); // e.g. the secret key was switched to another mode
    const r = await cancel(t, b.sessionId);
    assert.equal(r.status, 200);
    assert.equal(r.json.payment, 'expired');
    // another site cannot cancel
    const evil = await t.call('POST', '/api/checkout/cancel', { body: { session_id: a.sessionId }, headers: { Origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    await t.close();
  });

  test('Stripe unreachable → 502, the order stays pending (it expires with the session)', async () => {
    const t = await setup();
    const a = await checkout(t);
    t.fake.failNext(3, { status: 503 });
    const r = await cancel(t, a.sessionId);
    assert.equal(r.status, 502);
    assert.equal((await orders(t, 'pending')).length, 1);
    await t.close();
  });
});

describe('Thin events (a webhook endpoint created with the Dashboard\'s recommended format)', () => {
  test('v1.checkout.session.completed → the session is looked up at Stripe and the order finalized', async () => {
    const t = await setup();
    const a = await checkout(t);
    await t.fake.pay(a.sessionId, { webhook: false });
    const r = await webhook(t, thinEvent('v1.checkout.session.completed', a.sessionId));
    assert.equal(r.status, 200);
    const [o] = await orders(t, 'paid');
    assert.equal(o.no, a.orderNo);
    assert.match(o.stripe.paymentIntent, /^pi_test_/);
    await t.close();
  });

  test('v1.checkout.session.expired → expired; an unknown session is acknowledged', async () => {
    const t = await setup();
    const a = await checkout(t);
    await t.fake.expire(a.sessionId, { webhook: false });
    assert.equal((await webhook(t, thinEvent('v1.checkout.session.expired', a.sessionId))).status, 200);
    assert.equal((await orders(t, 'expired')).length, 1);
    assert.equal((await webhook(t, thinEvent('v1.checkout.session.completed', 'cs_test_unknown'))).status, 200);
    await t.close();
  });

  test('Stripe unreachable → 503 so that Stripe sends the event again', async () => {
    const t = await setup();
    const a = await checkout(t);
    await t.fake.pay(a.sessionId, { webhook: false });
    t.fake.failNext(3, { status: 503 });
    const r = await webhook(t, thinEvent('v1.checkout.session.completed', a.sessionId));
    assert.equal(r.status, 503);
    assert.equal((await orders(t, 'pending')).length, 1);
    assert.equal((await webhook(t, thinEvent('v1.checkout.session.completed', a.sessionId))).status, 200);
    assert.equal((await orders(t, 'paid')).length, 1);
    await t.close();
  });

  test('a snapshot event is still handled as before', async () => {
    const t = await setup();
    const a = await checkout(t);
    await webhook(t, sessionEvent('checkout.session.completed', { ...pub(a.session), status: 'complete', payment_status: 'paid', payment_intent: 'pi_1' }));
    assert.equal((await orders(t, 'paid')).length, 1);
    await t.close();
  });
});
