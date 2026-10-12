/* Holding managed stock fairly: how long a Checkout Session can be paid (SESSION_MINUTES), the
 * stock one client may hold (HOLD_PER_CLIENT; no cap by default, for a venue behind one address),
 * 'held' when other checkouts hold what the cart needs, and the client key kept on orders (an
 * HMAC, never the address). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sessionMinutes, holdMs, sessionExpiresAt, SESSION_MINUTES } from '../src/orders.js';
import { holdPerClient } from '../src/checkout.js';
import { hmacHex } from '../src/http.js';
import { scheduled } from '../src/app.js';
import {
  setup, clock, checkoutBody, customer, editCatalog, variant, orders, lastStripeRequest, ORIGIN, ADMIN,
} from './helpers.mjs';

const GENMAI = '満月米 ななつぼし 玄米 令和8年産 30kg';
const SALT = 'hold-salt-0123456789abcdef0123456789';
let shopper = 0;
// `qty` bags of 30kg 玄米 from the address `ip`, by a shopper of their own
const buy = (t, ip, qty, over = {}) => t.call('POST', '/api/checkout', {
  body: checkoutBody({ items: [{ pid: 'genmai-30kg', vid: '30kg', qty }], customer: customer({ email: `shopper${++shopper}@example.com` }), ...over }),
  headers: { Origin: ORIGIN, 'CF-Connecting-IP': ip },
});
const setStock = (t, stock) => editCatalog(t, (c) => { variant(c, 'genmai-30kg', '30kg').stock = stock; });
const held = (max) => [{ pid: 'genmai-30kg', vid: '30kg', code: 'held', name: GENMAI, max }];
const rows = (t) => t.env.DB.db.prepare('SELECT no, client_key, dup_key FROM orders ORDER BY rowid').all();
const quiet = async (fn) => {
  const warn = console.warn;
  const logs = [];
  console.warn = (...a) => logs.push(a.join(' '));
  try { await fn(); } finally { console.warn = warn; }
  return logs;
};

describe('SESSION_MINUTES', () => {
  test('30 by default; whole minutes from 30 to 1440; anything else is replaced (warned once)', async () => {
    assert.deepEqual({ ...SESSION_MINUTES }, { default: 30, min: 30, max: 1440 });
    assert.equal(sessionMinutes({}), 30);
    assert.equal(sessionMinutes({ SESSION_MINUTES: '45' }), 45);
    assert.equal(sessionMinutes({ SESSION_MINUTES: 1440 }), 1440);
    // the hold is 10 minutes longer (a late webhook)
    assert.equal(holdMs({}), 40 * 60 * 1000);
    assert.equal(holdMs({ SESSION_MINUTES: '60' }), 70 * 60 * 1000);
    const logs = await quiet(() => {
      assert.equal(sessionMinutes({ SESSION_MINUTES: '10' }), 30); // Stripe's shortest
      assert.equal(sessionMinutes({ SESSION_MINUTES: '5000' }), 1440); // Stripe's longest
      assert.equal(sessionMinutes({ SESSION_MINUTES: 'abc' }), 30);
      assert.equal(sessionMinutes({ SESSION_MINUTES: '  ' }), 30);
    });
    assert.equal(logs.filter((l) => /SESSION_MINUTES/.test(l)).length, 1);
    // what Stripe gets: 2 minutes more (it counts from when it creates the session), under 24 hours
    assert.equal(sessionExpiresAt({}, 1_000_000), 1000 + 30 * 60 + 120);
    assert.equal(sessionExpiresAt({ SESSION_MINUTES: '1440' }, 1_000_000), 1000 + 24 * 3600 - 120);
  });

  test('the Stripe session lasts SESSION_MINUTES, and its stock is held 10 minutes longer', async () => {
    const now = clock('2026-10-12T03:00:00Z');
    const t = await setup({ now, env: { SESSION_MINUTES: '45' } });
    await setStock(t, 1);
    assert.equal((await buy(t, '203.0.113.1', 1)).status, 200);
    assert.equal(Number(lastStripeRequest(t).form.expires_at), Math.floor(now() / 1000) + 45 * 60 + 120);
    now.advance(54 * 60 * 1000);
    const r = await buy(t, '203.0.113.2', 1);
    assert.equal(r.status, 409);
    assert.deepEqual(r.json.details, held(0));
    now.advance(61 * 1000);
    assert.equal((await buy(t, '203.0.113.2', 1)).status, 200);
    await t.close();
  });

  test('the longest (1440 minutes) is accepted', async () => {
    const t = await setup({ env: { SESSION_MINUTES: '1440' } });
    assert.equal((await buy(t, '203.0.113.1', 1)).status, 200);
    assert.equal(Number(lastStripeRequest(t).form.expires_at), Math.floor(t.now() / 1000) + 24 * 3600 - 120);
    await t.close();
  });
});

describe('the stock one client may hold (HOLD_PER_CLIENT)', () => {
  test('a whole number of units, 0 or more; unset, blank or anything else: 0 = no cap per client (warned once)', async () => {
    assert.equal(holdPerClient({}), 0);
    assert.equal(holdPerClient({ HOLD_PER_CLIENT: '' }), 0);
    assert.equal(holdPerClient({ HOLD_PER_CLIENT: '0' }), 0);
    assert.equal(holdPerClient({ HOLD_PER_CLIENT: '5' }), 5);
    assert.equal(holdPerClient({ HOLD_PER_CLIENT: 40 }), 40);
    const logs = await quiet(() => {
      for (const v of ['-1', '2.5', 'abc']) assert.equal(holdPerClient({ HOLD_PER_CLIENT: v }), 0, v);
    });
    assert.equal(logs.filter((l) => /HOLD_PER_CLIENT/.test(l)).length, 1);
  });

  test('by default there is no cap per client: a venue behind one address can have more than maxQty units on open checkouts; only the stock limits them', async () => {
    const t = await setup();
    await setStock(t, 100);
    const venue = '203.0.113.200';
    for (let i = 0; i < 5; i++) assert.equal((await buy(t, venue, 20)).status, 200, `shopper ${i + 1}`);
    // all 100 are on open checkouts now: the next one is told they are held (they may come back)
    const r = await buy(t, venue, 1);
    assert.equal(r.status, 409);
    assert.deepEqual(r.json.details, held(0));
    await t.close();
  });

  test('HOLD_PER_CLIENT=20: one address holds at most 20 units of a variant; the others get the rest; all of it on open checkouts → held (max 0)', async () => {
    const t = await setup({ env: { HOLD_PER_CLIENT: '20' } });
    await setStock(t, 60);
    const one = '203.0.113.66';
    assert.equal((await buy(t, one, 20)).status, 200);
    const r = await buy(t, one, 20);
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'cart_changed');
    assert.deepEqual(r.json.details, held(0));
    assert.equal((await orders(t, 'all')).length, 1); // nothing was created for it
    // other addresses buy the other 40
    assert.equal((await buy(t, '198.51.100.1', 20)).status, 200);
    assert.equal((await buy(t, '198.51.100.2', 20)).status, 200);
    // stock is left (60), but every unit is on a checkout that may still be paid: held, not sold out
    const later = await buy(t, '198.51.100.3', 1);
    assert.equal(later.status, 409);
    assert.deepEqual(later.json.details, held(0));
    // stock that is not managed is never held
    for (let i = 0; i < 3; i++) {
      const s = await t.call('POST', '/api/checkout', {
        body: checkoutBody({ items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 20 }], customer: customer({ email: `rice${i}@example.com` }) }),
        headers: { Origin: ORIGIN, 'CF-Connecting-IP': one },
      });
      assert.equal(s.status, 200);
    }
    await t.close();
  });

  test('part of the allowance left → held with max (what this client may still order); it comes back when a checkout is cancelled', async () => {
    const t = await setup({ env: { HOLD_PER_CLIENT: '20' } });
    await setStock(t, 60);
    const ip = '203.0.113.67';
    const a = await buy(t, ip, 15);
    assert.equal(a.status, 200);
    let r = await buy(t, ip, 10);
    assert.equal(r.status, 409);
    assert.deepEqual(r.json.details, held(5));
    assert.equal((await buy(t, ip, 5)).status, 200);
    r = await buy(t, ip, 1);
    assert.deepEqual(r.json.details, held(0));
    // back from Stripe without paying: the shop cancels → the 15 are free again
    const c = await t.call('POST', '/api/checkout/cancel', { body: { session_id: a.json.sessionId }, headers: { Origin: ORIGIN, 'CF-Connecting-IP': ip } });
    assert.equal(c.json.payment, 'expired');
    assert.equal((await buy(t, ip, 15)).status, 200);
    await t.close();
  });

  test('the cap is its own number, not the per-order maximum (maxQty)', async () => {
    const t = await setup({ env: { HOLD_PER_CLIENT: '3' } });
    await setStock(t, 60);
    assert.equal((await buy(t, '203.0.113.68', 2)).status, 200);
    assert.deepEqual((await buy(t, '203.0.113.68', 2)).json.details, held(1));
    assert.equal((await buy(t, '203.0.113.68', 1)).status, 200);
    await t.close();
  });

  test('IPv6: one /64 is one client', async () => {
    const t = await setup({ env: { HOLD_PER_CLIENT: '20' } });
    await setStock(t, 60);
    assert.equal((await buy(t, '2001:db8:1:2::1', 20)).status, 200);
    assert.deepEqual((await buy(t, '2001:db8:1:2:ffff:ffff:ffff:ffff', 1)).json.details, held(0));
    assert.equal((await buy(t, '2001:db8:1:3::1', 20)).status, 200);
    await t.close();
  });

  test('parallel checkouts from one client: no more than HOLD_PER_CLIENT units get a payable session', async () => {
    const t = await setup({ env: { HOLD_PER_CLIENT: '20' } });
    await setStock(t, 60);
    const rs = await Promise.all(Array.from({ length: 6 }, () => buy(t, '203.0.113.77', 10)));
    const ok = rs.filter((r) => r.status === 200);
    assert.ok(ok.length >= 1 && ok.length <= 2, JSON.stringify(rs.map((r) => r.status)));
    for (const r of rs.filter((x) => x.status !== 200)) {
      assert.equal(r.status, 409);
      assert.equal(r.json.details[0].code, 'held');
    }
    const open = [...t.fake.sessions.values()].filter((s) => s.status === 'open');
    assert.equal(open.length, ok.length);
    assert.deepEqual((await orders(t, 'pending')).map((o) => o.no).sort(), ok.map((r) => r.json.orderNo).sort());
    await t.close();
  });
});

describe('the client kept on an order', () => {
  test('an HMAC of the address with HOLD_SALT (else ADMIN_TOKEN), never the address; cleared by the cron sweep after a day', async () => {
    const now = clock('2026-10-12T03:00:00Z');
    const t = await setup({ now, env: { HOLD_SALT: SALT } });
    await setStock(t, 60);
    assert.equal((await buy(t, '203.0.113.5', 1)).status, 200);
    assert.equal(rows(t)[0].client_key, (await hmacHex(SALT, 'client:203.0.113.5')).slice(0, 32));
    assert.match(rows(t)[0].dup_key, /^[0-9a-f]{64}$/);
    delete t.env.HOLD_SALT;
    assert.equal((await buy(t, '203.0.113.5', 1)).status, 200);
    assert.equal(rows(t)[1].client_key, (await hmacHex(ADMIN, 'client:203.0.113.5')).slice(0, 32));
    // the address is nowhere in the database, and the admin's order list does not show the key
    assert.ok(!JSON.stringify(t.env.DB.db.prepare('SELECT * FROM orders').all()).includes('203.0.113'));
    assert.ok(!JSON.stringify(await orders(t, 'all')).includes(rows(t)[1].client_key));
    now.advance(24 * 60 * 60 * 1000 + 1000);
    await quiet(() => scheduled(t.env));
    assert.deepEqual(rows(t).map((r) => r.client_key), [null, null]);
    await t.close();
  });

  test('neither HOLD_SALT nor ADMIN_TOKEN: nothing is counted per client even with HOLD_PER_CLIENT (warned once); the stock itself is still held', async () => {
    const t = await setup({ env: { HOLD_PER_CLIENT: '20' } });
    await setStock(t, 50);
    t.env.ADMIN_TOKEN = '';
    let logs = await quiet(async () => {
      assert.equal((await buy(t, '203.0.113.9', 20)).status, 200);
      assert.equal((await buy(t, '203.0.113.9', 20)).status, 200);
    });
    assert.equal(logs.filter((l) => /HOLD_SALT/.test(l)).length, 1);
    assert.deepEqual(rows(t).map((r) => r.client_key), [null, null]);
    logs = await quiet(async () => {
      // 50 in stock, 40 on open checkouts: 'held' with what is left (not 'stock')
      assert.deepEqual((await buy(t, '203.0.113.9', 20)).json.details, held(10));
    });
    assert.equal(logs.filter((l) => /HOLD_SALT/.test(l)).length, 0);
    await t.close();
  });
});
