/* Order numbers, per-client request limits, the admin lock-out under parallel guessing, and
 * client addresses (IPv6 per /64). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ORDER_NO_RE, insertOrder } from '../src/db.js';
import { clientKey, ipv6Prefix64 } from '../src/http.js';
import { limitFor, DEFAULT_LIMITS, LIMIT_WINDOW_MS } from '../src/checkout.js';
import {
  setup, clock, checkout, checkoutBody, customer, orders, editCatalog, variant, ORIGIN, ADMIN,
} from './helpers.mjs';

const count = (list) => list.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});

describe('order numbers', () => {
  test('8 random digits a day; the old 4-digit numbers are still accepted', async () => {
    assert.ok(ORDER_NO_RE.test('MG-261012-48213907'));
    assert.ok(ORDER_NO_RE.test('MG-261012-0001'));
    for (const no of ['MG-261012-123456', 'MG-261012-123456789', 'MG-26101-12345678', 'mg-261012-12345678']) assert.ok(!ORDER_NO_RE.test(no), no);
    const t = await setup({ stripe: false });
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      const o = await insertOrder(t.env, { at: new Date(t.now()).toISOString(), status: 'new', payment: 'pending' }, t.now());
      assert.match(o.no, /^MG-261012-\d{8}$/);
      seen.add(o.no);
    }
    assert.equal(seen.size, 300);
    // the digits are spread over the whole range (not only 0000xxxx)
    assert.ok([...seen].some((no) => Number(no.slice(-8)) > 50_000_000));
    await t.close();
  });

  test('10,000 orders on one day (all the old 4-digit numbers) do not stop the next checkout', async () => {
    const t = await setup();
    const day = new Date(t.now()).toISOString();
    const db = t.env.DB.db;
    db.exec('BEGIN');
    const ins = db.prepare("INSERT INTO orders (no, created_at, payment, status, session_id, data, updated_at) VALUES (?, ?, 'expired', 'new', NULL, '{}', ?)");
    for (let i = 0; i < 10000; i++) ins.run(`MG-261012-${String(i).padStart(4, '0')}`, day, day);
    db.exec('COMMIT');
    const r = await checkout(t);
    assert.equal(r.res.status, 200, JSON.stringify(r.res.json));
    await t.close();
  });
});

describe('per-client limits', () => {
  test('defaults fit an event crowd behind one address, counted per minute; LIMIT_* override them (whole numbers ≥ 1 only)', () => {
    // the same average as 300 / 1,200 / 1,200 in 10 minutes, but a lock-out lasts a minute at most
    assert.equal(LIMIT_WINDOW_MS, 60 * 1000);
    assert.deepEqual({ ...DEFAULT_LIMITS }, { checkout: 30, status: 120, cancel: 120 });
    assert.equal(limitFor({}, 'checkout'), 30);
    assert.equal(limitFor({}, 'status'), 120);
    assert.equal(limitFor({}, 'cancel'), 120);
    // wrangler [vars] may give a string or a number
    assert.equal(limitFor({ LIMIT_CHECKOUT: '500' }, 'checkout'), 500);
    assert.equal(limitFor({ LIMIT_STATUS: 2000 }, 'status'), 2000);
    assert.equal(limitFor({ LIMIT_CANCEL: ' 50 ' }, 'cancel'), 50);
    const warn = console.warn;
    const logs = [];
    console.warn = (...a) => logs.push(a.join(' '));
    try {
      for (const bad of ['0', '-5', '1.5', 'abc', 0]) assert.equal(limitFor({ LIMIT_CHECKOUT: bad }, 'checkout'), 30, String(bad));
      for (const unset of ['', '  ', undefined, null]) assert.equal(limitFor({ LIMIT_STATUS: unset }, 'status'), 120);
    } finally { console.warn = warn; }
    assert.equal(logs.filter((l) => /LIMIT_CHECKOUT/.test(l)).length, 1); // warned once, not on every request
  });

  test('POST /api/checkout: 30 a minute per address by default, then 429 for a minute at most (other addresses are fine)', async () => {
    const now = clock();
    const t = await setup({ now });
    let phone = 0;
    const from = (ip) => t.call('POST', '/api/checkout', {
      body: checkoutBody({ customer: customer({ email: `phone${++phone}@example.com` }) }),
      headers: { Origin: ORIGIN, 'CF-Connecting-IP': ip },
    });
    // e.g. a venue's Wi-Fi: 30 phones each start a checkout within a minute
    for (let i = 0; i < 30; i++) assert.equal((await from('203.0.113.7')).status, 200, `checkout ${i + 1}`);
    const r = await from('203.0.113.7');
    assert.equal(r.status, 429);
    assert.equal(r.json.code, 'too_many_requests');
    assert.match(r.json.error, /1分ほどおいて/);
    assert.equal(r.headers.get('Retry-After'), '60');
    assert.equal((await orders(t, 'all')).length, 30); // the refused one used no order number
    assert.equal((await from('198.51.100.20')).status, 200);
    // the phones behind that address wait a minute at most, not 10
    now.advance(30 * 1000);
    assert.equal((await from('203.0.113.7')).status, 429);
    now.advance(31 * 1000);
    assert.equal((await from('203.0.113.7')).status, 200);
    // 30 a minute keeps going minute after minute (the same 300 in 10 minutes as before)
    for (let m = 0; m < 3; m++) {
      now.advance(61 * 1000);
      for (let i = 0; i < 30; i++) assert.equal((await from('203.0.113.7')).status, 200, `minute ${m + 1}, checkout ${i + 1}`);
    }
    await t.close();
  });

  test('refusals for held stock count toward LIMIT_CHECKOUT (probing the stock is not free)', async () => {
    const t = await setup({ env: { LIMIT_CHECKOUT: '3' } });
    await editCatalog(t, (c) => { variant(c, 'genmai-30kg', '30kg').stock = 1; });
    const genmai = { items: [{ pid: 'genmai-30kg', vid: '30kg', qty: 1 }] };
    const from = (ip, email) => t.call('POST', '/api/checkout', {
      body: checkoutBody({ ...genmai, customer: customer({ email }) }),
      headers: { Origin: ORIGIN, 'CF-Connecting-IP': ip },
    });
    // another shopper is paying for the last bag
    assert.equal((await from('198.51.100.40', 'first@example.com')).status, 200);
    for (let i = 0; i < 3; i++) {
      const r = await from('203.0.113.12', `probe${i}@example.com`);
      assert.equal(r.status, 409);
      assert.equal(r.json.details[0].code, 'held');
    }
    const r = await from('203.0.113.12', 'probe9@example.com');
    assert.equal(r.status, 429);
    await t.close();
  });

  test('LIMIT_CHECKOUT: the limit is configurable; one IPv6 /64 is one client', async () => {
    const t = await setup({ env: { LIMIT_CHECKOUT: '5' } });
    const from = (ip) => t.call('POST', '/api/checkout', { body: checkoutBody(), headers: { Origin: ORIGIN, 'CF-Connecting-IP': ip } });
    for (let i = 1; i <= 5; i++) assert.equal((await from(`2001:db8:1:2::${i.toString(16)}`)).status, 200);
    assert.equal((await from('2001:db8:1:2:ffff:ffff:ffff:ffff')).status, 429);
    assert.equal((await from('2001:db8:1:3::1')).status, 200);
    await t.close();
  });

  test('requests that fail validation are not counted', async () => {
    const t = await setup({ env: { LIMIT_CHECKOUT: '5' } });
    for (let i = 0; i < 40; i++) {
      const r = await t.call('POST', '/api/checkout', { body: checkoutBody({ customer: {} }), headers: { 'CF-Connecting-IP': '203.0.113.8' } });
      assert.equal(r.status, 400);
    }
    const ok = await t.call('POST', '/api/checkout', { body: checkoutBody(), headers: { 'CF-Connecting-IP': '203.0.113.8' } });
    assert.equal(ok.status, 200);
    await t.close();
  });

  test('GET /api/checkout/status asks Stripe at most LIMIT_STATUS times a minute per address, then answers from D1', async () => {
    const t = await setup({ env: { LIMIT_STATUS: '60' } });
    const a = await checkout(t);
    const lookups = () => t.fake.requests.filter((r) => r.method === 'GET').length;
    const status = () => t.call('GET', `/api/checkout/status?session_id=${a.sessionId}`, { headers: { 'CF-Connecting-IP': '203.0.113.9' } });
    for (let i = 0; i < 60; i++) assert.equal((await status()).json.payment, 'pending');
    assert.equal(lookups(), 60);
    await t.fake.pay(a.sessionId, { webhook: false });
    const r = await status();
    assert.equal(r.status, 200);
    assert.equal(r.json.payment, 'pending'); // no Stripe call this time
    assert.equal(lookups(), 60);
    // another address still gets the Stripe lookup
    const other = await t.call('GET', `/api/checkout/status?session_id=${a.sessionId}`, { headers: { 'CF-Connecting-IP': '198.51.100.9' } });
    assert.equal(other.json.payment, 'paid');
    await t.close();
  });

  test('status polling past its limit never blocks the cancel a new checkout needs first', async () => {
    const t = await setup({ env: { LIMIT_STATUS: '3' } });
    const ip = { 'CF-Connecting-IP': '203.0.113.10' };
    const a = await checkout(t);
    for (let i = 0; i < 20; i++) await t.call('GET', `/api/checkout/status?session_id=${a.sessionId}`, { headers: ip });
    const c = await t.call('POST', '/api/checkout/cancel', { body: { session_id: a.sessionId }, headers: { Origin: ORIGIN, ...ip } });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    assert.equal(c.json.payment, 'expired');
    const b = await t.call('POST', '/api/checkout', { body: checkoutBody(), headers: { Origin: ORIGIN, ...ip } });
    assert.equal(b.status, 200);
    await t.close();
  });

  test('POST /api/checkout/cancel has its own limit (LIMIT_CANCEL): past it 429; status and checkout are unaffected', async () => {
    const t = await setup({ env: { LIMIT_CANCEL: '2' } });
    const ip = { 'CF-Connecting-IP': '203.0.113.11' };
    const cancel = (sid) => t.call('POST', '/api/checkout/cancel', { body: { session_id: sid }, headers: { Origin: ORIGIN, ...ip } });
    const [a, b, c] = [await checkout(t), await checkout(t), await checkout(t)];
    assert.equal((await cancel(a.sessionId)).status, 200);
    assert.equal((await cancel(b.sessionId)).status, 200);
    // an already-closed session is answered without Stripe and is not counted
    assert.equal((await cancel(a.sessionId)).json.payment, 'expired');
    const r = await cancel(c.sessionId);
    assert.equal(r.status, 429);
    assert.equal(r.json.code, 'too_many_requests');
    assert.equal(r.headers.get('Retry-After'), '60');
    await t.fake.pay(c.sessionId, { webhook: false });
    assert.equal((await t.call('GET', `/api/checkout/status?session_id=${c.sessionId}`, { headers: ip })).json.payment, 'paid');
    assert.equal((await t.call('POST', '/api/checkout', { body: checkoutBody(), headers: { Origin: ORIGIN, ...ip } })).status, 200);
    await t.close();
  });
});

describe('admin lock-out', () => {
  test('200 wrong passwords sent at once: at most 10 are checked, the rest get 429', async () => {
    const t = await setup({ stripe: false });
    const from = (ip, admin) => t.call('GET', '/api/admin/session', { admin, headers: { 'CF-Connecting-IP': ip } });
    const rs = await Promise.all(Array.from({ length: 200 }, (_, i) => from('203.0.113.7', `wrong-password-guess-number-${i}-xxxxx`)));
    const c = count(rs);
    assert.equal(c[401], 10, JSON.stringify(c));
    assert.equal(c[429], 190);
    await t.close();
  });

  test('the right password inside a parallel burst is locked out too (no oracle past the limit)', async () => {
    const t = await setup({ stripe: false });
    const from = (admin) => t.call('GET', '/api/admin/session', { admin, headers: { 'CF-Connecting-IP': '203.0.113.70' } });
    const burst = Array.from({ length: 50 }, (_, i) => from(`wrong-password-guess-number-${i}-xxxxx`));
    const rs = await Promise.all([...burst, from(ADMIN)]);
    assert.equal(rs.at(-1).status, 429);
    assert.equal(count(rs)[401], 10);
    await t.close();
  });

  test('IPv6: compressed addresses in one /64 share one counter', async () => {
    const t = await setup({ stripe: false });
    const from = (ip, admin) => t.call('GET', '/api/admin/session', { admin, headers: { 'CF-Connecting-IP': ip } });
    const statuses = [];
    for (let i = 1; i <= 40; i++) statuses.push((await from(`2001:db8::${i.toString(16)}`, 'wrong-password-guess-xxxxxxxxxxxxx')).status);
    assert.deepEqual(count(statuses.map((status) => ({ status }))), { 401: 10, 429: 30 });
    // another /64 is another client
    assert.equal((await from('2001:db8:0:1::1', ADMIN)).status, 200);
    await t.close();
  });

  test('a successful login clears the count; requests without a password are not counted', async () => {
    const t = await setup({ stripe: false });
    const from = (admin) => t.call('GET', '/api/admin/session', { admin, headers: { 'CF-Connecting-IP': '198.51.100.30' } });
    for (let i = 0; i < 9; i++) assert.equal((await from('wrong-password-guess-xxxxxxxxxxxxx')).status, 401);
    assert.equal((await from(ADMIN)).status, 200);
    for (let i = 0; i < 9; i++) assert.equal((await from('wrong-password-guess-xxxxxxxxxxxxx')).status, 401);
    for (let i = 0; i < 20; i++) assert.equal((await from(undefined)).status, 401);
    assert.equal((await from(ADMIN)).status, 200);
    // an admin page's normal requests never lock it out
    for (let i = 0; i < 30; i++) assert.equal((await from(ADMIN)).status, 200);
    await t.close();
  });
});

describe('client addresses', () => {
  const key = (ip) => clientKey(new Request('https://api.example/', { headers: ip === undefined ? {} : { 'CF-Connecting-IP': ip } }));
  test('IPv4 as is, IPv6 per /64 (compressed or not), IPv4-mapped as IPv4', () => {
    assert.equal(key('203.0.113.7'), '203.0.113.7');
    assert.equal(key(undefined), 'unknown');
    assert.equal(key('2001:db8::5'), '2001:db8:0:0::/64');
    assert.equal(key('2001:0DB8:0000:0000:0001::'), '2001:db8:0:0::/64');
    assert.equal(key('2001:db8:0:0:ffff:1:2:3'), '2001:db8:0:0::/64');
    assert.equal(key('2400:4051:abcd:1200:1:2:3:4'), '2400:4051:abcd:1200::/64');
    assert.equal(key('2400:4051:abcd:1201::1'), '2400:4051:abcd:1201::/64');
    assert.equal(key('::1'), '0:0:0:0::/64');
    assert.equal(key('::ffff:192.0.2.1'), '192.0.2.1');
    assert.equal(key('fe80::1%eth0'), 'fe80:0:0:0::/64');
    assert.equal(ipv6Prefix64('2001:db8::1::2'), null);
    assert.equal(ipv6Prefix64('1:2:3'), null);
    assert.equal(key('not:an:ip:zz'), 'not:an:ip:zz');
  });
});
