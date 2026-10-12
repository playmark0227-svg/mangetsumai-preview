/* The same shopper in two browsers (or after the browser's storage was cleared): the earlier
 * checkout for the same order is closed before a new one is made, and a payment for it a moment
 * ago is pointed out (409 duplicate_paid) unless the shopper confirms. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  setup, clock, checkoutBody, customer, webhook, sessionEvent, orders, sessionRequests, ORIGIN,
} from './helpers.mjs';

const pub = (s) => { const { _params, ...rest } = s; return rest; };
const paid = (s) => ({ ...pub(s), status: 'complete', payment_status: 'paid', payment_intent: 'pi_test_123' });
const ITEMS = [{ pid: 'shinmai-r8', vid: '5kg', qty: 2 }, { pid: 'shinmai-r8', vid: '10kg', qty: 1 }];
const place = (t, over = {}, ip = '203.0.113.20') => t.call('POST', '/api/checkout', {
  body: checkoutBody({ items: ITEMS, ...over }),
  headers: { Origin: ORIGIN, 'CF-Connecting-IP': ip },
});
const sid = (res) => res.json.url.split('/pay/')[1];
const stripeStatus = (t, res) => t.fake.sessions.get(sid(res)).status;
const payment = async (t, res) => (await orders(t, 'all')).find((o) => o.no === res.json.orderNo).payment;

describe('the same order from another browser', () => {
  test('the earlier checkout is closed at Stripe first (e-mail case, item order and the way the address is written do not matter)', async () => {
    const t = await setup();
    const a = await place(t);
    assert.equal(a.status, 200);
    // the other browser (on mobile data): the same shopper, typed a little differently
    const b = await place(t, {
      items: [{ pid: 'shinmai-r8', vid: '10kg', qty: 1 }, { pid: 'shinmai-r8', vid: '5kg', qty: 1 }, { pid: 'shinmai-r8', vid: '5kg', qty: 1 }],
      customer: customer({ email: ' Hanako@Example.COM ', zip: '095-0000', addr1: '士別市上士別町１ー２' }),
    }, '198.51.100.7');
    assert.equal(b.status, 200, JSON.stringify(b.json));
    assert.equal(stripeStatus(t, a), 'expired');
    assert.equal(stripeStatus(t, b), 'open');
    assert.equal(await payment(t, a), 'expired');
    // the old page can no longer be paid: one charge only
    const late = await fetch(`${t.fake.url}/pay/${sid(a)}/pay`, { method: 'POST', redirect: 'manual' });
    assert.equal(late.status, 400);
    // delivering to the same place via お届け先 is the same order too
    const c = await place(t, { shipTo: { name: '山田 花子', zip: '0950000', pref: '北海道', addr1: '士別市上士別町1-2', addr2: '', tel: '09012345678' } });
    assert.equal(c.status, 200);
    assert.equal(stripeStatus(t, b), 'expired');
    await t.close();
  });

  test('another cart, quantity, e-mail address or delivery address is another order: nothing is closed', async () => {
    const t = await setup();
    const a = await place(t);
    for (const over of [
      { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 1 }, { pid: 'shinmai-r8', vid: '10kg', qty: 1 }] },
      { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 2 }] },
      { customer: customer({ email: 'taro@example.com' }) },
      { customer: customer({ addr2: 'ハイツ101' }) },
      { shipTo: { name: '山田 太郎', zip: '900-0001', pref: '沖縄県', addr1: '那覇市1-1', addr2: '', tel: '098-123-4567' } },
    ]) assert.equal((await place(t, over)).status, 200, JSON.stringify(over));
    assert.equal(stripeStatus(t, a), 'open');
    assert.equal((await orders(t, 'pending')).length, 6);
    await t.close();
  });

  test('the earlier checkout was paid (no webhook yet): it is finalized, and the new one stops with 409 duplicate_paid; confirmDuplicate goes ahead', async () => {
    const now = clock('2026-10-12T03:00:00Z');
    const t = await setup({ now });
    const a = await place(t);
    await t.fake.pay(sid(a), { webhook: false });
    now.advance(5 * 60 * 1000);
    const before = (await orders(t, 'all')).length;
    const asked = sessionRequests(t).length;
    const b = await place(t, {}, '198.51.100.8');
    assert.equal(b.status, 409);
    assert.equal(b.json.code, 'duplicate_paid');
    assert.equal(b.json.error, `同じ内容のご注文（ご注文番号 ${a.json.orderNo}）のお支払いが、すでに完了しています。同じ商品をもう一度ご注文になる場合は、ご確認のうえ、改めてお手続きください。`);
    // the order number and when it was paid, not the amount
    assert.deepEqual(b.json.details, { orderNo: a.json.orderNo, paidAt: '2026-10-12T03:05:00.000Z' });
    assert.equal(await payment(t, a), 'paid');
    assert.equal((await orders(t, 'all')).length, before); // nothing new
    assert.equal(sessionRequests(t).length, asked);
    // the shopper confirms that they want it twice
    const c = await place(t, { confirmDuplicate: true }, '198.51.100.8');
    assert.equal(c.status, 200);
    assert.equal(stripeStatus(t, c), 'open');
    await t.close();
  });

  test('a matching payment is pointed out for 60 minutes; not after that, and not once the admin cancelled the order', async () => {
    const now = clock('2026-10-12T03:00:00Z');
    const t = await setup({ now });
    const a = await place(t);
    await webhook(t, sessionEvent('checkout.session.completed', paid(t.fake.sessions.get(sid(a)))));
    now.advance(59 * 60 * 1000);
    assert.equal((await place(t)).json.code, 'duplicate_paid');
    now.advance(61 * 1000);
    assert.equal((await place(t)).status, 200);

    const taro = { customer: customer({ email: 'taro@example.com' }) };
    const d = await place(t, taro);
    await webhook(t, sessionEvent('checkout.session.completed', paid(t.fake.sessions.get(sid(d)))));
    assert.equal((await place(t, taro)).json.code, 'duplicate_paid');
    const patch = await t.call('PATCH', `/api/admin/orders/${d.json.orderNo}`, { admin: true, body: { status: 'canceled' } });
    assert.equal(patch.status, 200);
    assert.equal((await place(t, taro)).status, 200);
    await t.close();
  });

  test('confirmDuplicate must be true or false', async () => {
    const t = await setup();
    for (const v of ['true', 1, {}]) {
      const r = await place(t, { confirmDuplicate: v });
      assert.equal(r.status, 400, JSON.stringify(v));
      assert.deepEqual(r.json.details.map((d) => d.field), ['confirmDuplicate']);
    }
    for (const v of [false, null, undefined]) assert.equal((await place(t, { confirmDuplicate: v })).status, 200);
    await t.close();
  });

  test('two browsers within the time Stripe takes to create a session, the later one finishing first: the earlier one gets 409 duplicate_pending, one payable session', async () => {
    const t = await setup();
    let b;
    // while Stripe creates a's session, the other browser places the same order from start to end
    t.fake.beforeCreate(async () => { b = await place(t, {}, '198.51.100.9'); });
    const a = await place(t);
    assert.equal(b.status, 200);
    assert.equal(a.status, 409);
    assert.equal(a.json.code, 'duplicate_pending');
    assert.equal(a.json.error, '同じ内容のご注文の手続きが、ほかの画面で進んでいます。そちらの画面でお支払いを完了してください。');
    assert.equal(a.json.details, undefined);
    // a's session was never handed out, and is expired at Stripe; its order is expired
    const sessions = [...t.fake.sessions.values()];
    assert.equal(sessions.length, 2);
    assert.deepEqual(sessions.filter((s) => s.status === 'open').map((s) => s.id), [sid(b)]);
    const list = await orders(t, 'all');
    assert.equal(list.length, 2);
    assert.deepEqual(list.filter((o) => o.payment === 'pending').map((o) => o.no), [b.json.orderNo]);
    await t.close();
  });

  test('two browsers within the time Stripe takes to create a session, the earlier one finishing first: the later one closes it when its own session is made', async () => {
    const t = await setup();
    let b;
    let releaseB;
    const gate = new Promise((r) => { releaseB = r; });
    let bAtStripe;
    const reached = new Promise((r) => { bAtStripe = r; });
    t.fake.beforeCreate(async () => {
      // b is saved and waits at Stripe; a's session is made meanwhile and a is answered first
      t.fake.beforeCreate(async () => { bAtStripe(); await gate; });
      b = place(t, {}, '198.51.100.10');
      await reached;
    });
    const a = await place(t);
    assert.equal(a.status, 200);
    assert.equal(stripeStatus(t, a), 'open');
    releaseB();
    b = await b;
    assert.equal(b.status, 200);
    assert.equal(stripeStatus(t, a), 'expired');
    assert.equal(stripeStatus(t, b), 'open');
    assert.equal(await payment(t, a), 'expired');
    assert.equal(await payment(t, b), 'pending');
    // a's page can no longer be paid: one charge only
    assert.equal((await fetch(`${t.fake.url}/pay/${sid(a)}/pay`, { method: 'POST', redirect: 'manual' })).status, 400);
    await t.close();
  });

  test('closing the earlier checkout is best effort: Stripe unreachable → the new one is still made; a session Stripe does not know → expired', async () => {
    const t = await setup();
    const a = await place(t);
    t.fake.failNext(3, { status: 503 }); // every try to expire a
    const logs = [];
    const warn = console.warn;
    console.warn = (...x) => logs.push(x.join(' '));
    let b;
    try { b = await place(t); } finally { console.warn = warn; }
    assert.equal(b.status, 200);
    assert.equal(stripeStatus(t, a), 'open');
    assert.match(logs.join('\n'), /could not expire an earlier checkout/);
    // b's session is gone at Stripe (e.g. made with the test key before switching to the live one)
    t.fake.sessions.delete(sid(b));
    const c = await place(t);
    assert.equal(c.status, 200);
    assert.equal(await payment(t, b), 'expired');
    await t.close();
  });
});
