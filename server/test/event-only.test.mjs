/* Event-only products (options.eventOnly, e.g. 北海道満喫セット) and 送料込みの商品 (options.shipIncluded):
 * sold only on the event's dates (Japan time, by the server's clock) while they are on the event
 * page, always recorded as event orders, left out of the shipping fee; and what happens when the
 * event ends while a shopper is on Stripe's page. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Core from '../src/core.js';
import {
  setup, clock, checkout, customer, webhook, sessionEvent, editCatalog, orders, lastStripeRequest, sessionRequests,
} from './helpers.mjs';

const R = Core.DEFAULT_SHIP_RATES;
const EV = Core.DEFAULT_EVENT;
const SET = '北海道満喫セット';
const SET_LINE = '北海道満喫セット（送料込み）';
const SHIN5 = '満月米 ななつぼし 新米 令和8年産 5kg';
const set = (qty = 1) => ({ pid: 'hokkaido-set', vid: 'set', qty });
const shin5 = (qty = 1) => ({ pid: 'shinmai-r8', vid: '5kg', qty });
const shin10 = (qty = 1) => ({ pid: 'shinmai-r8', vid: '10kg', qty });
const SET_ONLY = [{ pid: 'hokkaido-set', vid: 'set', code: 'event_only', name: SET }];
// a shopper in 東京都 (関東), an e-mail address of its own each time
let n = 0;
const tokyo = () => customer({ zip: '1000001', pref: '東京都', addr1: '千代田区千代田1-1', email: `tokyo+${++n}@example.com` });
const pub = (s) => { const { _params, ...rest } = s; return rest; };
const paid = (s, extra = {}) => ({ ...pub(s), status: 'complete', payment_status: 'paid', payment_intent: 'pi_test_123', ...extra });
const byNo = async (t, no) => (await orders(t, 'all')).find((o) => o.no === no);
const shipRate = (t) => lastStripeRequest(t).form.shipping_options[0].shipping_rate_data;
const lineNames = (t) => lastStripeRequest(t).form.line_items.map((l) => l.price_data.product_data.name);
const coreQuote = async (t, items, pref, today) => Core.priceCart((await t.call('GET', '/api/admin/catalog', { admin: true })).json.catalog, items, { pref, today });
// 2026-10-25 10:00 in Japan: the event day
const EVENT_DAY = '2026-10-25T01:00:00Z';

// refused with 409 cart_changed before anything is made (no order, no Stripe call) → details
async function refused(t, over) {
  const before = (await orders(t)).length;
  const asked = sessionRequests(t).length;
  const r = await checkout(t, { customer: tokyo(), ...over });
  assert.equal(r.res.status, 409, JSON.stringify(r.res.json));
  assert.equal(r.res.json.code, 'cart_changed');
  assert.match(r.res.json.error, /イベントの期間中だけ/);
  assert.equal((await orders(t)).length, before);
  assert.equal(sessionRequests(t).length, asked);
  return r.res.json.details;
}

describe('core: event-only and 送料込み in priceCart', () => {
  const cat = Core.normalize(Core.clone(Core.DEFAULT_CATALOG));
  test('today decides; 送料込み lines add no box and do not count toward free shipping; only those → fee 0 even without a prefecture', () => {
    let p = Core.priceCart(cat, [set(2)], { today: '2026-10-25' });
    assert.deepEqual(p.problems, []);
    assert.deepEqual([p.sub, p.shipping.fee, p.total, p.shipping.included, p.shipping.parcels], [19600, 0, 19600, true, []]);
    assert.deepEqual([p.lines[0].eventOnly, p.lines[0].shipIncluded], [true, true]);
    // with other goods the fee waits for the prefecture, as usual
    p = Core.priceCart(cat, [set(1), shin5(1)], { today: '2026-10-25' });
    assert.deepEqual([p.shipping.fee, p.total], [null, null]);
    p = Core.priceCart(cat, [set(1), shin5(1)], { today: '2026-10-25', pref: '東京都' });
    assert.deepEqual(p.shipping.parcels.map((x) => x.kg), [5]);
    assert.equal(p.total, 9800 + 3600 + R.kanto[0]);
    // outside the event: only the event-only line is a problem
    for (const today of ['2026-09-30', '2027-01-26']) {
      p = Core.priceCart(cat, [set(1), shin5(1)], { today, pref: '東京都' });
      assert.deepEqual(p.problems, SET_ONLY, today);
      assert.deepEqual(p.lines.map((l) => l.pid), ['shinmai-r8']);
    }
    // goods that are not event-only sell on any day
    assert.deepEqual(Core.priceCart(cat, [shin5(1)], { today: '2030-01-01', pref: '東京都' }).problems, []);
  });
});

describe('event-only products at checkout', () => {
  test('inside the event: an event order whatever source was sent (no delivery date, the event note), 送料込み with no fee', async () => {
    const t = await setup({ now: clock(EVENT_DAY) });
    for (const source of ['', 'other-event', 'takanawa']) {
      const r = await checkout(t, { items: [set(2)], source, date: '10月30日（金）', customer: tokyo() });
      assert.equal(r.res.status, 200, JSON.stringify(r.res.json));
      assert.equal(r.res.json.total, 19600);
      assert.equal(r.session.amount_total, 19600);
      assert.deepEqual(lastStripeRequest(t).form.line_items, [
        { quantity: '2', price_data: { currency: 'jpy', unit_amount: '9800', product_data: { name: SET_LINE } } },
      ]);
      assert.deepEqual(shipRate(t), { type: 'fixed_amount', display_name: '送料込み', fixed_amount: { amount: '0', currency: 'jpy' } });
      const o = await byNo(t, r.orderNo);
      assert.deepEqual([o.source, o.sourceName, o.date, o.notice.eventNote], [EV.slug, EV.title, '', EV.shipNote], source);
      assert.deepEqual(o.items, [{ pid: 'hokkaido-set', vid: 'set', name: SET, variant: '', gift: '', qty: 2, unit: 9800, total: 19600 }]);
      assert.deepEqual([o.subtotal, o.ship, o.total], [19600, 0, 19600]);
      assert.deepEqual(o.shipDetail, { region: '関東', parcels: [], free: false, included: true });
      const st = await t.call('GET', `/api/checkout/status?session_id=${r.sessionId}`);
      assert.equal(st.json.eventNote, EV.shipNote);
    }
    await t.close();
  });

  test('with other goods: only they pay shipping (the set adds no box), the same as core; free shipping counts only them', async () => {
    const t = await setup({ now: clock(EVENT_DAY) });
    const today = '2026-10-25';
    // the set (6kg) and a 5kg bag: one 5kg box (with the set it would be the 15kg class)
    let items = [set(1), shin5(1)];
    let r = await checkout(t, { items, customer: tokyo(), date: '10月30日（金）' });
    assert.equal(r.res.status, 200, JSON.stringify(r.res.json));
    assert.equal(r.res.json.total, 9800 + 3600 + R.kanto[0]);
    assert.equal(r.res.json.total, (await coreQuote(t, items, '東京都', today)).total);
    assert.deepEqual(lineNames(t), [SET_LINE, SHIN5]);
    assert.deepEqual(shipRate(t), { type: 'fixed_amount', display_name: '送料（関東）', fixed_amount: { amount: String(R.kanto[0]), currency: 'jpy' } });
    let o = await byNo(t, r.orderNo);
    assert.deepEqual(o.shipDetail, { region: '関東', parcels: [{ kg: 5, fee: R.kanto[0] }], free: false, included: true });
    assert.deepEqual([o.ship, o.subtotal, o.source, o.date], [R.kanto[0], 13400, EV.slug, '']);
    const first = r;

    // 3 sets and 35kg of rice: the rice's two boxes only (30kg + 5kg)
    items = [set(3), shin5(7)];
    r = await checkout(t, { items, customer: tokyo() });
    assert.equal(r.res.json.total, 9800 * 3 + 3600 * 7 + R.kanto[4] + R.kanto[0]);
    assert.equal(r.res.json.total, (await coreQuote(t, items, '東京都', today)).total);
    assert.equal(shipRate(t).display_name, '送料（関東・2箱）');

    // free shipping from 10,000円: the set's 9,800円 does not count toward it
    assert.equal((await editCatalog(t, (c) => { c.settings.ship.freeOver = 10000; })).status, 200);
    items = [set(1), shin5(1)];
    r = await checkout(t, { items, customer: tokyo() });
    assert.equal(r.res.json.total, 9800 + 3600 + R.kanto[0]);
    assert.equal(r.res.json.total, (await coreQuote(t, items, '東京都', today)).total);
    assert.equal(shipRate(t).display_name, '送料（関東）');
    items = [set(1), shin10(1)];
    r = await checkout(t, { items, customer: tokyo() });
    assert.equal(r.res.json.total, 9800 + 6900 + R.kanto[1]);
    items = [set(1), shin10(2)];
    r = await checkout(t, { items, customer: tokyo() });
    assert.equal(r.res.json.total, 9800 + 13800);
    assert.equal(r.res.json.total, (await coreQuote(t, items, '東京都', today)).total);
    assert.deepEqual(shipRate(t), { type: 'fixed_amount', display_name: '送料無料', fixed_amount: { amount: '0', currency: 'jpy' } });
    o = await byNo(t, r.orderNo);
    assert.deepEqual(o.shipDetail, { region: '関東', parcels: [{ kg: 20, fee: R.kanto[3] }], free: true, included: true });
    // a save that changes nothing about the set leaves its checkouts open
    assert.equal(t.fake.sessions.get(first.sessionId).status, 'open');
    await t.close();
  });

  test('if Stripe refuses shipping_options: no shipping line for 送料込み only, the other goods\' fee for a mixed cart', async () => {
    const t = await setup({ now: clock(EVENT_DAY) });
    t.fake.setRejectShippingOptions(true);
    let r = await checkout(t, { items: [set(1)], customer: tokyo() });
    assert.equal(r.res.status, 200, JSON.stringify(r.res.json));
    assert.equal(r.session.amount_total, 9800);
    assert.deepEqual(lineNames(t), [SET_LINE]);
    r = await checkout(t, { items: [set(1), shin5(1)], customer: tokyo() });
    assert.equal(r.session.amount_total, 9800 + 3600 + R.kanto[0]);
    assert.deepEqual(lineNames(t), [SET_LINE, SHIN5, '送料（関東）']);
    await t.close();
  });

  test('outside the event dates (Japan time, the server\'s clock) → 409 cart_changed event_only; nothing is made', async () => {
    const now = clock('2026-09-30T14:59:00Z'); // 2026-09-30 23:59 in Japan: the day before the start
    const t = await setup({ now });
    assert.deepEqual(await refused(t, { items: [set(1)], source: 'takanawa' }), SET_ONLY);
    // only the set is reported; the other goods could be bought
    assert.deepEqual(await refused(t, { items: [shin5(1), set(1)] }), SET_ONLY);
    assert.equal((await checkout(t, { items: [shin5(1)], customer: tokyo() })).res.status, 200);
    now.set('2026-09-30T15:00:00Z'); // 2026-10-01 00:00: the first day
    assert.equal((await checkout(t, { items: [set(1)], customer: tokyo() })).res.status, 200);
    now.set('2027-01-25T14:59:00Z'); // 2027-01-25 23:59: the last day
    assert.equal((await checkout(t, { items: [set(1)], customer: tokyo() })).res.status, 200);
    now.set('2027-01-25T15:00:00Z'); // 2027-01-26 00:00: over
    assert.deepEqual(await refused(t, { items: [set(1)], source: 'takanawa' }), SET_ONLY);
    await t.close();
  });

  test('taken off the event page (event.products) or the event turned off → 409 event_only', async () => {
    const t = await setup({ now: clock(EVENT_DAY) });
    await editCatalog(t, (c) => { c.settings.event.products = ['shinmai-r8', 'genmai-30kg']; });
    assert.deepEqual(await refused(t, { items: [set(1)], source: 'takanawa' }), SET_ONLY);
    // the other goods still sell, and are an event order only from the event page, as before
    let r = await checkout(t, { items: [shin5(1)], customer: tokyo(), date: '10月30日（金）' });
    assert.equal(r.res.status, 200);
    assert.deepEqual(((o) => [o.source, o.date])(await byNo(t, r.orderNo)), ['', '10月30日（金）']);
    await editCatalog(t, (c) => { c.settings.event.products = ['hokkaido-set']; c.settings.event.enabled = false; });
    assert.deepEqual(await refused(t, { items: [set(1)] }), SET_ONLY);
    await editCatalog(t, (c) => { c.settings.event.enabled = true; });
    r = await checkout(t, { items: [set(1)], customer: tokyo() });
    assert.equal(r.res.status, 200);
    assert.equal((await byNo(t, r.orderNo)).source, EV.slug);
    await t.close();
  });

  test('a cart with other problems too: every problem is listed, with the event message', async () => {
    const t = await setup({ now: clock('2027-02-01T01:00:00Z') });
    await editCatalog(t, (c) => { c.products.find((p) => p.id === 'genmai-30kg').status = 'soldout'; });
    assert.deepEqual(await refused(t, { items: [{ pid: 'genmai-30kg', vid: '30kg', qty: 1 }, set(1)] }), [
      { pid: 'genmai-30kg', vid: '30kg', code: 'sold_out', name: '満月米 ななつぼし 玄米 令和8年産 30kg' },
      ...SET_ONLY,
    ]);
    // without an event-only problem the message is the usual one
    const r = await checkout(t, { items: [{ pid: 'genmai-30kg', vid: '30kg', qty: 1 }], customer: tokyo() });
    assert.equal(r.res.status, 409);
    assert.match(r.res.json.error, /^カートの商品に変更がありました/);
    await t.close();
  });
});

describe('the event ends while Stripe creates the session', () => {
  const lastSession = (t) => [...t.fake.sessions.values()].at(-1);
  for (const [label, during] of [
    ['the end date saved in the admin', (t) => editCatalog(t, (c) => { c.settings.event.end = '2026-10-24'; })],
    ['taken off the event page in the admin', (t) => editCatalog(t, (c) => { c.settings.event.products = ['shinmai-r8']; })],
    ['midnight after the last day', (t) => { t.now.set('2027-01-25T15:00:01Z'); }],
  ]) {
    test(`${label}: the new session is withdrawn and the shopper gets 409 event_only instead of its URL`, async () => {
      const t = await setup({ now: clock(label.startsWith('midnight') ? '2027-01-25T14:59:59Z' : EVENT_DAY) });
      t.fake.beforeCreate(async () => { await during(t); });
      const r = await checkout(t, { items: [set(1), shin5(1)], customer: tokyo() });
      assert.equal(r.res.status, 409, JSON.stringify(r.res.json));
      assert.equal(r.res.json.code, 'cart_changed');
      assert.match(r.res.json.error, /イベントの期間中だけ/);
      assert.deepEqual(r.res.json.details, SET_ONLY);
      assert.equal(lastSession(t).status, 'expired');
      assert.deepEqual((await orders(t, 'all')).map((o) => o.payment), ['expired']);
      await t.close();
    });
  }
});

describe('paid after the event ended', () => {
  test('the payment is kept and the set is flagged unavailable (event_ended); other orders are not', async () => {
    const now = clock('2027-01-25T14:50:00Z'); // 23:50 in Japan on the last day
    const t = await setup({ now });
    const a = await checkout(t, { items: [set(1), shin5(1)], customer: tokyo() });
    const b = await checkout(t, { items: [shin5(1)], customer: tokyo() });
    assert.equal(a.res.status, 200);
    now.set('2027-01-25T15:10:00Z'); // 00:10: the event is over, a's session is open until 00:22
    for (const r of [a, b]) assert.equal((await webhook(t, sessionEvent('checkout.session.completed', paid(r.session)))).status, 200);
    const oa = await byNo(t, a.orderNo);
    assert.equal(oa.payment, 'paid');
    assert.deepEqual(oa.unavailable, [{ pid: 'hokkaido-set', vid: 'set', name: SET, reason: 'event_ended' }]);
    assert.deepEqual([oa.source, oa.date, oa.notice.eventNote], [EV.slug, '', EV.shipNote]);
    const ob = await byNo(t, b.orderNo);
    assert.equal(ob.payment, 'paid');
    assert.ok(!('unavailable' in ob));
    await t.close();
  });

  test('paid in time, but the webhook (or the sweep) comes after the end: not flagged', async () => {
    const now = clock('2027-01-25T14:00:00Z'); // 23:00 in Japan on the last day: the session can be paid until 23:32
    const t = await setup({ now });
    const a = await checkout(t, { items: [set(1)], customer: tokyo() });
    now.set('2027-01-26T03:00:00Z'); // the next day
    assert.equal((await webhook(t, sessionEvent('checkout.session.completed', paid(a.session)))).status, 200);
    const o = await byNo(t, a.orderNo);
    assert.equal(o.payment, 'paid');
    assert.ok(!('unavailable' in o));
    await t.close();
  });

  for (const [label, mutate] of [
    ['taken off the event page', (c) => { c.settings.event.products = ['shinmai-r8', 'genmai-30kg']; }],
    ['the event turned off', (c) => { c.settings.event.enabled = false; }],
    ['the end date moved to yesterday', (c) => { c.settings.event.end = '2026-10-24'; }],
  ]) {
    test(`${label} in the admin: open checkouts with the set are closed; one paid anyway is flagged event_ended`, async () => {
      const t = await setup({ now: clock(EVENT_DAY) });
      const a = await checkout(t, { items: [set(1)], customer: tokyo() });
      const b = await checkout(t, { items: [shin5(1)], customer: tokyo() });
      const c = await checkout(t, { items: [shin5(1), set(2)], customer: tokyo() });
      assert.equal((await editCatalog(t, mutate)).status, 200);
      for (const r of [a, c]) {
        assert.equal(t.fake.sessions.get(r.sessionId).status, 'expired');
        assert.equal((await byNo(t, r.orderNo)).payment, 'expired');
      }
      assert.equal(t.fake.sessions.get(b.sessionId).status, 'open');
      assert.equal((await byNo(t, b.orderNo)).payment, 'pending');
      // a payment that got through before the session was closed
      await webhook(t, sessionEvent('checkout.session.completed', paid(a.session)));
      const o = await byNo(t, a.orderNo);
      assert.equal(o.payment, 'paid');
      assert.deepEqual(o.unavailable, [{ pid: 'hokkaido-set', vid: 'set', name: SET, reason: 'event_ended' }]);
      await t.close();
    });
  }
});
