/* What can still be bought while shoppers are on Stripe's page: the soft hold of managed stock,
 * closing open checkouts when stock runs out or the admin stops selling something, the
 * "no longer for sale" flag on payments that get through anyway, and test-mode payments. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { insertOrder } from '../src/db.js';
import {
  setup, clock, checkout, checkoutBody, webhook, sessionEvent, editCatalog, adminCatalog, variant, orders, sessionRequests, ORIGIN,
} from './helpers.mjs';

const pub = (s) => { const { _params, ...rest } = s; return rest; };
const paid = (s, extra = {}) => ({ ...pub(s), status: 'complete', payment_status: 'paid', payment_intent: 'pi_test_123', ...extra });
const GENMAI = '満月米 ななつぼし 玄米 令和8年産 30kg';
const SHIN5 = '満月米 ななつぼし 新米 令和8年産 5kg';
const SHIN10 = '満月米 ななつぼし 新米 令和8年産 10kg（5kg×2袋）';
const genmai = (qty = 1) => ({ items: [{ pid: 'genmai-30kg', vid: '30kg', qty }] });
const byNo = async (t, no) => (await orders(t, 'all')).find((o) => o.no === no);
const stripeStatus = (t, r) => t.fake.sessions.get(r.sessionId).status;
const setGenmaiStock = (t, stock) => editCatalog(t, (c) => { variant(c, 'genmai-30kg', '30kg').stock = stock; });

describe('soft hold of managed stock', () => {
  test('units on an open Checkout Session are held: the next shopper gets what is left, or sold out; nothing is created', async () => {
    const t = await setup();
    await setGenmaiStock(t, 3);
    const a = await checkout(t, genmai(2));
    assert.equal(a.res.status, 200);
    const asked = sessionRequests(t).length;
    let r = await checkout(t, genmai(2));
    assert.equal(r.res.status, 409);
    assert.equal(r.res.json.code, 'cart_changed');
    // 3 in stock, 2 on an open checkout: 'held' with the 1 that is left (the 2 may come back)
    assert.deepEqual(r.res.json.details, [{ pid: 'genmai-30kg', vid: '30kg', code: 'held', name: GENMAI, max: 1 }]);
    assert.equal((await orders(t, 'all')).length, 1);
    assert.equal(sessionRequests(t).length, asked);
    const b = await checkout(t, genmai(1));
    assert.equal(b.res.status, 200);
    r = await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 1 }, { pid: 'genmai-30kg', vid: '30kg', qty: 1 }] });
    assert.equal(r.res.status, 409);
    // stock is left, but all of it is on open checkouts: 'held' (it may come back), not 'sold_out'
    assert.deepEqual(r.res.json.details, [{ pid: 'genmai-30kg', vid: '30kg', code: 'held', name: GENMAI, max: 0 }]);
    // stock that is not managed (no number in the admin) is never held
    for (let i = 0; i < 3; i++) assert.equal((await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 20 }] })).res.status, 200);
    // the stock itself only moves when a payment is made
    assert.equal(variant((await adminCatalog(t)).catalog, 'genmai-30kg', '30kg').stock, 3);
    assert.equal((await orders(t, 'all')).length, 5);
    await t.close();
  });

  test('a hold ends when the session is cancelled, expires or is paid (stock taken once), or 40 minutes on (SESSION_MINUTES 30 + 10)', async () => {
    const now = clock('2026-10-12T03:00:00Z');
    const t = await setup({ now });
    await setGenmaiStock(t, 1);
    const refused = async (code) => {
      const r = await checkout(t, genmai(1));
      assert.equal(r.res.status, 409);
      assert.equal(r.res.json.details[0].code, code);
    };
    const held = () => refused('held');
    const soldOut = () => refused('sold_out');
    const a = await checkout(t, genmai(1));
    await held();
    // back from Stripe without paying: the shop cancels the session
    assert.equal((await t.call('POST', '/api/checkout/cancel', { body: { session_id: a.sessionId }, headers: { Origin: ORIGIN } })).json.payment, 'expired');
    const b = await checkout(t, genmai(1));
    assert.equal(b.res.status, 200);
    await held();
    // the session expired at Stripe
    await webhook(t, sessionEvent('checkout.session.expired', { ...pub(b.session), status: 'expired' }));
    const c = await checkout(t, genmai(1));
    assert.equal(c.res.status, 200);
    // paid: the stock is taken, and the paid order no longer counts as a hold
    await webhook(t, sessionEvent('checkout.session.completed', paid(c.session)));
    assert.equal(variant((await adminCatalog(t)).catalog, 'genmai-30kg', '30kg').stock, 0);
    await soldOut();
    await setGenmaiStock(t, 1);
    const d = await checkout(t, genmai(1));
    assert.equal(d.res.status, 200);
    now.advance(39 * 60 * 1000);
    await held();
    // no webhook ever came: after 40 minutes the order no longer holds anything
    now.advance(60 * 1000 + 1000);
    assert.equal((await checkout(t, genmai(1))).res.status, 200);
    await t.close();
  });

  test('an order whose Checkout Session is still being created holds its units for 2 minutes', async () => {
    const now = clock('2026-10-12T03:00:00Z');
    const t = await setup({ now });
    await setGenmaiStock(t, 1);
    await insertOrder(t.env, { at: new Date(now()).toISOString(), status: 'new', payment: 'pending', items: [{ pid: 'genmai-30kg', vid: '30kg', name: '満月米 ななつぼし 玄米 令和8年産', variant: '', qty: 1 }], total: 1, stripe: { sessionId: '' } }, now());
    assert.equal((await checkout(t, genmai(1))).res.status, 409);
    now.advance(2 * 60 * 1000 + 1000);
    assert.equal((await checkout(t, genmai(1))).res.status, 200);
    await t.close();
  });

  test('checkouts racing for the last unit at the same moment: exactly one gets a payable session', async () => {
    const t = await setup();
    await setGenmaiStock(t, 1);
    const rs = await Promise.all(Array.from({ length: 6 }, () => checkout(t, genmai(1))));
    const ok = rs.filter((r) => r.res.status === 200);
    assert.equal(ok.length, 1, JSON.stringify(rs.map((r) => r.res.status)));
    for (const r of rs.filter((x) => x.res.status !== 200)) {
      assert.equal(r.res.status, 409);
      assert.deepEqual(r.res.json.details, [{ pid: 'genmai-30kg', vid: '30kg', code: 'held', name: GENMAI, max: 0 }]);
    }
    const pending = await orders(t, 'pending');
    assert.deepEqual(pending.map((o) => o.no), [ok[0].orderNo]);
    // no other session that could still be paid
    const open = [...t.fake.sessions.values()].filter((s) => s.status === 'open');
    assert.deepEqual(open.map((s) => s.id), [ok[0].sessionId]);
    await t.close();
  });

  test('a session Stripe refuses to create holds nothing', async () => {
    const t = await setup();
    await setGenmaiStock(t, 1);
    t.fake.failNext(1, { status: 400 });
    assert.equal((await checkout(t, genmai(1))).res.status, 502);
    assert.equal((await checkout(t, genmai(1))).res.status, 200);
    await t.close();
  });
});

describe('the last units are paid for', () => {
  test('other checkouts still open for them are expired at Stripe and here', async () => {
    const t = await setup();
    await setGenmaiStock(t, 4);
    const a = await checkout(t, genmai(2));
    const b = await checkout(t, genmai(2));
    const c = await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 1 }] });
    // the admin lowers the stock while both are on Stripe's page (not to 0: nothing is closed yet)
    await setGenmaiStock(t, 2);
    assert.equal(stripeStatus(t, b), 'open');
    assert.equal((await webhook(t, sessionEvent('checkout.session.completed', paid(a.session)))).status, 200);
    assert.equal(variant((await adminCatalog(t)).catalog, 'genmai-30kg', '30kg').stock, 0);
    assert.equal(stripeStatus(t, b), 'expired');
    assert.equal((await byNo(t, b.orderNo)).payment, 'expired');
    assert.equal((await byNo(t, a.orderNo)).payment, 'paid');
    // unrelated checkouts stay open
    assert.equal(stripeStatus(t, c), 'open');
    assert.equal((await byNo(t, c.orderNo)).payment, 'pending');
    // the closed page can no longer be paid
    const late = await fetch(`${t.fake.url}/pay/${b.sessionId}/pay`, { method: 'POST', redirect: 'manual' });
    assert.equal(late.status, 400);
    await t.close();
  });

  test('Stripe unreachable meanwhile: the webhook still succeeds; a payment that gets through is flagged stockShort', async () => {
    const t = await setup();
    await setGenmaiStock(t, 4);
    const a = await checkout(t, genmai(2));
    const b = await checkout(t, genmai(2));
    await setGenmaiStock(t, 2);
    t.fake.failNext(3, { status: 503 }); // every try to expire b
    const r = await webhook(t, sessionEvent('checkout.session.completed', paid(a.session)));
    assert.equal(r.status, 200);
    assert.equal((await byNo(t, a.orderNo)).payment, 'paid');
    assert.equal((await byNo(t, b.orderNo)).payment, 'pending');
    await webhook(t, sessionEvent('checkout.session.completed', paid(b.session)));
    const ob = await byNo(t, b.orderNo);
    assert.equal(ob.payment, 'paid');
    assert.deepEqual(ob.stockShort, [{ pid: 'genmai-30kg', vid: '30kg', name: GENMAI, short: 2 }]);
    await t.close();
  });
});

describe('the admin stops selling something while shoppers are on Stripe\'s page', () => {
  test('売り切れ / variant deleted / 非公開 / stock 0: those sessions are expired at once, the others stay open', async () => {
    const t = await setup();
    const a = await checkout(t, genmai(1));
    const b = await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 1 }] });
    const c = await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '10kg', qty: 1 }] });
    // an unrelated change closes nothing
    assert.equal((await editCatalog(t, (cat) => { cat.settings.news.text = 'お知らせ'; })).status, 200);
    assert.deepEqual([a, b, c].map((r) => stripeStatus(t, r)), ['open', 'open', 'open']);

    assert.equal((await editCatalog(t, (cat) => { cat.products.find((p) => p.id === 'genmai-30kg').status = 'soldout'; })).status, 200);
    assert.deepEqual([a, b, c].map((r) => stripeStatus(t, r)), ['expired', 'open', 'open']);
    assert.equal((await byNo(t, a.orderNo)).payment, 'expired');

    await editCatalog(t, (cat) => { const p = cat.products.find((x) => x.id === 'shinmai-r8'); p.variants = p.variants.filter((v) => v.id !== '10kg'); });
    assert.deepEqual([b, c].map((r) => stripeStatus(t, r)), ['open', 'expired']);

    await editCatalog(t, (cat) => { cat.products.find((p) => p.id === 'shinmai-r8').status = 'draft'; });
    assert.equal(stripeStatus(t, b), 'expired');
    assert.deepEqual((await orders(t, 'expired')).map((o) => o.no).sort(), [a.orderNo, b.orderNo, c.orderNo].sort());

    // managed stock set to 0
    await editCatalog(t, (cat) => { const p = cat.products.find((x) => x.id === 'genmai-30kg'); p.status = 'published'; p.variants[0].stock = 5; });
    const d = await checkout(t, genmai(1));
    assert.equal(d.res.status, 200);
    await setGenmaiStock(t, 0);
    assert.equal(stripeStatus(t, d), 'expired');
    assert.equal((await byNo(t, d.orderNo)).payment, 'expired');
    await t.close();
  });

  test('Stripe unreachable: the save still succeeds; the payments that get through are flagged unavailable (soldout / draft / deleted)', async () => {
    const t = await setup();
    const a = await checkout(t, genmai(1));
    const b = await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '10kg', qty: 1 }] });
    const c = await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 1 }] });
    const base = t.env.STRIPE_API_BASE;
    t.env.STRIPE_API_BASE = 'http://127.0.0.1:9'; // nothing listens there
    const put = await editCatalog(t, (cat) => {
      cat.products.find((p) => p.id === 'genmai-30kg').status = 'soldout';
      const s = cat.products.find((p) => p.id === 'shinmai-r8');
      s.status = 'draft';
      s.variants = s.variants.filter((v) => v.id !== '10kg');
    });
    t.env.STRIPE_API_BASE = base;
    assert.equal(put.status, 200);
    assert.equal(put.json.rev, 1);
    assert.equal((await orders(t, 'pending')).length, 3);
    // the shoppers pay anyway: the payments are kept, and flagged for the admin
    for (const r of [a, b, c]) assert.equal((await webhook(t, sessionEvent('checkout.session.completed', paid(r.session)))).status, 200);
    const list = await orders(t, 'paid');
    const flag = (r) => list.find((o) => o.no === r.orderNo).unavailable;
    assert.deepEqual(flag(a), [{ pid: 'genmai-30kg', vid: '30kg', name: GENMAI, reason: 'soldout' }]);
    assert.deepEqual(flag(b), [{ pid: 'shinmai-r8', vid: '10kg', name: SHIN10, reason: 'deleted' }]);
    assert.deepEqual(flag(c), [{ pid: 'shinmai-r8', vid: '5kg', name: SHIN5, reason: 'draft' }]);
    await t.close();
  });

  test('more open checkouts than one batch: every one is closed, the newest first (a real shopper behind 25 older ones)', async () => {
    const now = clock('2026-10-12T03:00:00Z');
    const t = await setup({ now, env: { expireBatch: 10 } });
    const five = { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 1 }] };
    // 25 at the same moment (pages are cut by order number then), the real shopper a second later
    const junk = [];
    for (let i = 0; i < 25; i++) junk.push(await checkout(t, five));
    now.advance(1000);
    const real = await checkout(t, five);
    const other = await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '10kg', qty: 1 }] });
    const logs = [];
    const log = console.log;
    console.log = (...x) => logs.push(x.join(' '));
    try {
      assert.equal((await editCatalog(t, (c) => { variant(c, 'shinmai-r8', '5kg').stock = 0; })).status, 200);
    } finally { console.log = log; }
    const expired = t.fake.requests.filter((r) => /\/expire$/.test(r.path)).map((r) => r.path.split('/')[4]);
    assert.equal(expired.length, 26);
    assert.equal(new Set(expired).size, 26);
    // the first ones sent (5 at a time) include the newest checkout
    assert.ok(expired.slice(0, 5).includes(real.sessionId));
    for (const r of [real, ...junk]) assert.equal(stripeStatus(t, r), 'expired');
    assert.equal(stripeStatus(t, other), 'open');
    assert.equal((await orders(t, 'expired')).length, 26);
    assert.match(logs.join('\n'), /\[expire\] \{"expired":26,"failed":0,"left":0,"batches":3,"stopped":false,"more":false\}/);
    await t.close();
  });

  test('out of time (a Worker has about 30 seconds after its answer): the newest are closed, the rest counted in the log', async () => {
    const now = clock('2026-10-12T03:00:00Z');
    const t = await setup({ now, env: { expireBudgetMs: 300 } });
    const five = { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 1 }] };
    const list = [];
    for (let i = 0; i < 20; i++) { list.push(await checkout(t, five)); now.advance(1000); }
    t.fake.setDelay(200); // a slow Stripe: about 10 can be closed in 300 ms, 5 at a time
    const logs = [];
    const log = console.log;
    console.log = (...x) => logs.push(x.join(' '));
    try {
      assert.equal((await editCatalog(t, (c) => { variant(c, 'shinmai-r8', '5kg').stock = 0; })).status, 200);
    } finally { console.log = log; }
    t.fake.setDelay(0);
    const closed = list.filter((r) => stripeStatus(t, r) === 'expired').length;
    assert.ok(closed >= 5 && closed < 20, String(closed));
    // exactly the newest ones
    const newestFirst = [...list].reverse();
    assert.deepEqual(newestFirst.map((r) => stripeStatus(t, r)), newestFirst.map((_, i) => (i < closed ? 'expired' : 'open')));
    const line = logs.find((l) => l.startsWith('[expire]'));
    assert.deepEqual(JSON.parse(line.slice('[expire] '.length)), { expired: closed, failed: 0, left: 20 - closed, batches: 1, stopped: true, more: false });
    await t.close();
  });

  test('out of time on the first of several pages: the pages not reached are counted in the log from the database (no Stripe calls)', async () => {
    const now = clock('2026-10-12T03:00:00Z');
    const t = await setup({ now, env: { expireBudgetMs: 300, expireBatch: 10, LIMIT_CHECKOUT: '100' } });
    const five = { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 1 }] };
    const list = [];
    for (let i = 0; i < 35; i++) { list.push(await checkout(t, five)); now.advance(1000); }
    // other checkouts on the same pages are not counted
    for (let i = 0; i < 4; i++) { await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '10kg', qty: 1 }] }); now.advance(1000); }
    t.fake.setDelay(200);
    const logs = [];
    const log = console.log;
    console.log = (...x) => logs.push(x.join(' '));
    try {
      assert.equal((await editCatalog(t, (c) => { variant(c, 'shinmai-r8', '5kg').stock = 0; })).status, 200);
    } finally { console.log = log; }
    t.fake.setDelay(0);
    const closed = list.filter((r) => stripeStatus(t, r) === 'expired').length;
    assert.ok(closed >= 1 && closed < 10, String(closed));
    const expireCalls = t.fake.requests.filter((r) => /\/expire$/.test(r.path)).length;
    assert.equal(expireCalls, closed);
    const out = JSON.parse(logs.find((l) => l.startsWith('[expire]')).slice('[expire] '.length));
    // every one still open is in `left`, not only the rest of the first page
    assert.deepEqual(out, { expired: closed, failed: 0, left: 35 - closed, batches: 1, stopped: true, more: false });
    assert.equal((await orders(t, 'pending')).length, 35 - closed + 4);
    await t.close();
  });

  test('counting the rest runs out of time too: more: true (left is then at least that many)', async () => {
    const now = clock('2026-10-12T03:00:00Z');
    const t = await setup({ now, env: { expireBudgetMs: 100, expireBatch: 5, expireCountBudgetMs: 0 } });
    const five = { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 1 }] };
    for (let i = 0; i < 20; i++) { await checkout(t, five); now.advance(1000); }
    t.fake.setDelay(150);
    const logs = [];
    const log = console.log;
    console.log = (...x) => logs.push(x.join(' '));
    try {
      await editCatalog(t, (c) => { variant(c, 'shinmai-r8', '5kg').stock = 0; });
    } finally { console.log = log; }
    t.fake.setDelay(0);
    const out = JSON.parse(logs.find((l) => l.startsWith('[expire]')).slice('[expire] '.length));
    assert.equal(out.stopped, true);
    assert.equal(out.more, true);
    // one page counted after the first: at least what is still open on those two pages
    assert.equal(out.expired + out.left, 10);
    assert.ok((await orders(t, 'pending')).length > out.left);
    await t.close();
  });

  test('a deleted product is flagged deleted; an order with nothing wrong has no flag', async () => {
    const t = await setup();
    const a = await checkout(t, genmai(1));
    const b = await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 1 }] });
    t.fake.failNext(3, { status: 503 }); // expiring a's session fails
    await editCatalog(t, (cat) => { cat.products = cat.products.filter((p) => p.id !== 'genmai-30kg'); });
    for (const r of [a, b]) await webhook(t, sessionEvent('checkout.session.completed', paid(r.session)));
    const list = await orders(t, 'paid');
    assert.deepEqual(list.find((o) => o.no === a.orderNo).unavailable, [{ pid: 'genmai-30kg', vid: '30kg', name: GENMAI, reason: 'deleted' }]);
    assert.ok(!('unavailable' in list.find((o) => o.no === b.orderNo)));
    await t.close();
  });
});

describe('the admin saves a change while a checkout is waiting for Stripe to create its session', () => {
  const SHIN = '満月米 ななつぼし 新米 令和8年産';
  const five = { items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 1 }] };
  const ten = { items: [{ pid: 'shinmai-r8', vid: '10kg', qty: 1 }] };
  // `mutate` is saved in the admin while Stripe creates the session of a checkout for `over`
  const saveMeanwhile = async (t, mutate, over) => {
    let put;
    t.fake.beforeCreate(async () => { put = await editCatalog(t, mutate); });
    const r = await checkout(t, over);
    assert.equal(put.status, 200);
    return r;
  };
  // the session that was created but never handed out
  const lastSession = (t) => [...t.fake.sessions.values()].at(-1);

  for (const [label, mutate, over, details] of [
    ['売り切れ', (c) => { c.products.find((p) => p.id === 'shinmai-r8').status = 'soldout'; }, five,
      [{ pid: 'shinmai-r8', vid: '5kg', code: 'sold_out', name: SHIN5 }]],
    ['非公開', (c) => { c.products.find((p) => p.id === 'shinmai-r8').status = 'draft'; }, five,
      [{ pid: 'shinmai-r8', vid: '5kg', code: 'not_found', name: SHIN }]],
    ['the variant deleted', (c) => { const p = c.products.find((x) => x.id === 'shinmai-r8'); p.variants = p.variants.filter((v) => v.id !== '10kg'); }, ten,
      [{ pid: 'shinmai-r8', vid: '10kg', code: 'not_found', name: SHIN }]],
    ['the product deleted', (c) => { c.products = c.products.filter((p) => p.id !== 'genmai-30kg'); }, genmai(1),
      [{ pid: 'genmai-30kg', vid: '30kg', code: 'not_found', name: '' }]],
    ['managed stock 0', (c) => { variant(c, 'genmai-30kg', '30kg').stock = 0; }, genmai(1),
      [{ pid: 'genmai-30kg', vid: '30kg', code: 'sold_out', name: GENMAI }]],
  ]) {
    test(`${label}: the new session is expired at Stripe and here, and the shopper gets 409 cart_changed instead of its URL`, async () => {
      const t = await setup();
      await setGenmaiStock(t, 5);
      const r = await saveMeanwhile(t, mutate, over);
      assert.equal(r.res.status, 409);
      assert.equal(r.res.json.code, 'cart_changed');
      assert.deepEqual(r.res.json.details, details);
      assert.equal(lastSession(t).status, 'expired');
      const list = await orders(t, 'all');
      assert.deepEqual(list.map((o) => o.payment), ['expired']);
      assert.equal(list[0].stripe.sessionId, lastSession(t).id);
      await t.close();
    });
  }

  test('an unrelated change saved meanwhile: the checkout goes ahead', async () => {
    const t = await setup();
    const r = await saveMeanwhile(t, (c) => { c.settings.news.text = 'お知らせ'; variant(c, 'shinmai-r8', '10kg').stock = 3; }, five);
    assert.equal(r.res.status, 200);
    assert.equal(stripeStatus(t, r), 'open');
    assert.equal((await byNo(t, r.orderNo)).payment, 'pending');
    await t.close();
  });

  test('the stock lowered meanwhile below what is on open checkouts: the later checkout is withdrawn (held), the earlier one stays payable', async () => {
    const t = await setup();
    await setGenmaiStock(t, 2);
    const x = await checkout(t, genmai(1));
    assert.equal(x.res.status, 200);
    const y = await saveMeanwhile(t, (c) => { variant(c, 'genmai-30kg', '30kg').stock = 1; }, genmai(1));
    assert.equal(y.res.status, 409);
    assert.deepEqual(y.res.json.details, [{ pid: 'genmai-30kg', vid: '30kg', code: 'held', name: GENMAI, max: 0 }]);
    assert.equal(lastSession(t).status, 'expired');
    assert.equal(stripeStatus(t, x), 'open');
    assert.deepEqual((await orders(t, 'pending')).map((o) => o.no), [x.orderNo]);
    await t.close();
  });

  test('Stripe unreachable when the withdrawn session is expired: still 409, the order expired (nobody has its URL)', async () => {
    const t = await setup();
    const base = t.env.STRIPE_API_BASE;
    t.fake.beforeCreate(async () => {
      await editCatalog(t, (c) => { c.products.find((p) => p.id === 'shinmai-r8').status = 'soldout'; });
      t.env.STRIPE_API_BASE = 'http://127.0.0.1:9'; // nothing listens there (the create is already on its way)
    });
    const logs = [];
    const warn = console.warn;
    console.warn = (...x) => logs.push(x.join(' '));
    let r;
    try { r = await checkout(t, five); } finally { console.warn = warn; t.env.STRIPE_API_BASE = base; }
    assert.equal(r.res.status, 409);
    assert.equal(r.res.json.code, 'cart_changed');
    assert.match(logs.join('\n'), /could not expire a session that was not handed out/);
    assert.equal(lastSession(t).status, 'open');
    assert.deepEqual((await orders(t, 'all')).map((o) => o.payment), ['expired']);
    await t.close();
  });
});

describe('test-mode payments', () => {
  test('the order records livemode from the session (false = a test payment)', async () => {
    const t = await setup();
    const a = await checkout(t);
    const b = await checkout(t);
    await webhook(t, sessionEvent('checkout.session.completed', paid(a.session)));
    await webhook(t, sessionEvent('checkout.session.completed', paid(b.session, { livemode: true })));
    assert.equal((await byNo(t, a.orderNo)).stripe.livemode, false);
    assert.equal((await byNo(t, b.orderNo)).stripe.livemode, true);
    // also when the status page finalizes it (the session as Stripe has it)
    const c = await checkout(t);
    await t.fake.pay(c.sessionId, { webhook: false });
    assert.equal((await t.call('GET', `/api/checkout/status?session_id=${c.sessionId}`)).json.payment, 'paid');
    assert.equal((await byNo(t, c.orderNo)).stripe.livemode, false);
    await t.close();
  });

  test('with a live key, a test-mode payment never marks an order paid (webhook 200, order pending, no personal data in the log)', async () => {
    for (const key of ['sk_live_0123456789', 'rk_live_0123456789']) {
      const t = await setup();
      const a = await checkout(t, genmai(1));
      t.env.STRIPE_SECRET_KEY = key;
      const logs = [];
      const warn = console.warn;
      console.warn = (...x) => logs.push(x.join(' '));
      let r;
      try { r = await webhook(t, sessionEvent('checkout.session.completed', paid(a.session))); } finally { console.warn = warn; }
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, { received: true });
      const o = await byNo(t, a.orderNo);
      assert.equal(o.payment, 'pending');
      assert.equal(o.paidAt, undefined);
      assert.match(logs.join('\n'), /test-mode payment/);
      assert.ok(!/hanako|山田|花子|MG-|cs_test|pi_test/.test(logs.join('\n')), logs.join('\n'));
      // a live payment for the same order is accepted
      await webhook(t, sessionEvent('checkout.session.completed', paid(a.session, { livemode: true })));
      const o2 = await byNo(t, a.orderNo);
      assert.equal(o2.payment, 'paid');
      assert.equal(o2.stripe.livemode, true);
      await t.close();
    }
  });
});

describe('test-mode payments with a live key (only livemode === true pays)', () => {
  test('a session without livemode, or with livemode as a string, never marks an order paid', async () => {
    const t = await setup();
    const a = await checkout(t);
    const b = await checkout(t);
    const c = await checkout(t);
    t.env.STRIPE_SECRET_KEY = 'sk_live_0123456789';
    const { livemode, ...noMode } = paid(a.session);
    assert.equal(livemode, false);
    const logs = [];
    const warn = console.warn;
    console.warn = (...x) => logs.push(x.join(' '));
    try {
      for (const s of [noMode, paid(b.session, { livemode: 'false' }), paid(c.session, { livemode: 'true' })]) {
        const r = await webhook(t, sessionEvent('checkout.session.completed', s));
        assert.equal(r.status, 200);
      }
    } finally { console.warn = warn; }
    for (const r of [a, b, c]) assert.equal((await byNo(t, r.orderNo)).payment, 'pending');
    assert.equal(logs.filter((l) => /test-mode payment/.test(l)).length, 3);
    await t.close();
  });
});

describe('checkout body', () => {
  test('the soft hold does not change what a normal checkout answers', async () => {
    const t = await setup();
    await setGenmaiStock(t, 2);
    const res = await t.call('POST', '/api/checkout', { body: checkoutBody(genmai(1)), headers: { Origin: ORIGIN } });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json).sort(), ['orderNo', 'sessionId', 'total', 'url']);
    await t.close();
  });
});
