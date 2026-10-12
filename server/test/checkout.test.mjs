/* POST /api/checkout: validation, server-side pricing, events, the Stripe request. */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Core from '../src/core.js';
import { otherPrefAtStart } from '../src/validate.js';
import { prefsForZip } from '../src/zip.js';
import {
  setup, clock, checkout, checkoutBody, customer, lastStripeRequest, sessionRequests, editCatalog, orders, ORIGIN, SITE,
} from './helpers.mjs';

const R = Core.DEFAULT_SHIP_RATES;
const fields = (res) => res.json.details.map((d) => d.field);

describe('checkout validation', () => {
  let t;
  before(async () => { t = await setup(); });
  after(() => t.close());

  test('every missing customer field is reported with its dotted path', async () => {
    const res = await t.call('POST', '/api/checkout', { body: checkoutBody({ customer: {} }) });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, 'invalid');
    assert.ok(res.json.error);
    assert.deepEqual(fields(res).sort(), [
      'customer.addr1', 'customer.email', 'customer.kana1', 'customer.kana2', 'customer.name1', 'customer.name2',
      'customer.pref', 'customer.tel', 'customer.zip',
    ]);
    for (const d of res.json.details) assert.match(d.message, /[ぁ-んァ-ヶ一-龠]/); // Japanese messages
  });

  test('format errors per field', async () => {
    const res = await t.call('POST', '/api/checkout', {
      body: checkoutBody({
        customer: customer({ name1: 'あ'.repeat(21), kana1: 'Yamada', zip: '12345', pref: '東京', tel: '9012345678', email: 'not-an-email', addr2: 'x'.repeat(81) }),
        shipTo: { name: '', zip: '1', pref: '', addr1: '', addr2: '', tel: 'abc' },
        date: 'x'.repeat(31),
        time: '深夜',
        memo: 'あ'.repeat(401),
      }),
    });
    assert.equal(res.status, 400);
    const f = fields(res);
    for (const k of ['customer.name1', 'customer.kana1', 'customer.zip', 'customer.pref', 'customer.tel', 'customer.email', 'customer.addr2',
      'shipTo.name', 'shipTo.zip', 'shipTo.pref', 'shipTo.addr1', 'shipTo.tel', 'date', 'time', 'memo']) {
      assert.ok(f.includes(k), `expected an error for ${k}: ${f.join(',')}`);
    }
    assert.ok(!f.includes('customer.name2'));
    const zip = res.json.details.find((d) => d.field === 'customer.zip');
    assert.equal(zip.message, '郵便番号は7桁の数字で入力してください（例：0950000）。');
  });

  test('items: empty, too many lines, unreadable', async () => {
    for (const items of [[], undefined, 'x', Array.from({ length: 31 }, (_, i) => ({ pid: `p${i}`, vid: 'v', qty: 1 })),
      [{ pid: 'shinmai-r8', vid: '5kg', qty: 0 }], [{ pid: 'shinmai-r8', vid: '5kg', qty: 1.5 }], [{ pid: 'shinmai-r8', qty: 1 }]]) {
      const res = await t.call('POST', '/api/checkout', { body: checkoutBody({ items }) });
      assert.equal(res.status, 400, JSON.stringify(items));
      assert.deepEqual(fields(res), ['items']);
    }
  });

  test('control and bidi characters are refused; the shop\'s input clean-up is mirrored', async () => {
    const rlo = String.fromCharCode(0x202e);
    let res = await t.call('POST', '/api/checkout', { body: checkoutBody({ customer: customer({ addr1: `士別市${rlo}1-2` }) }) });
    assert.equal(res.status, 400);
    assert.deepEqual(fields(res), ['customer.addr1']);
    res = await t.call('POST', '/api/checkout', { body: checkoutBody({ customer: customer({ name2: `花${String.fromCharCode(0)}子` }) }) });
    assert.deepEqual(fields(res), ['customer.name2']);
    res = await t.call('POST', '/api/checkout', { body: checkoutBody({ memo: `一行目${String.fromCharCode(7)}` }) });
    assert.deepEqual(fields(res), ['memo']);
    // full-width digits / dashes and hiragana are accepted like in the shop form; memo keeps new lines
    const ok = await checkout(t, { customer: customer({ zip: '０９５ー００００', tel: '０９０−１２３４−５６７８', kana1: 'やまだ', kana2: 'はなこ' }), memo: '置き配\r\nお願いします' });
    assert.equal(ok.res.status, 200, JSON.stringify(ok.res.json));
    const o = (await orders(t)).find((x) => x.no === ok.orderNo);
    assert.equal(o.customer.zip, '095-0000');
    assert.equal(o.customer.tel, '090-1234-5678');
    assert.equal(o.customer.kana, 'ヤマダ ハナコ');
    assert.equal(o.memo, '置き配\nお願いします');
  });

  test('a postal code from another prefecture is accepted with an address warning on the order (the table is not verified)', async () => {
    // 沖縄 postal code with 北海道 picked: the order goes through at the chosen prefecture's fee,
    // and the admin sees the warning before shipping
    let r = await checkout(t, { items: [{ pid: 'genmai-30kg', vid: '30kg', qty: 3 }], customer: customer({ zip: '９００ー０００１', pref: '北海道', addr1: '那覇市港町1-1' }) });
    assert.equal(r.res.status, 200, JSON.stringify(r.res.json));
    assert.deepEqual(Object.keys(r.res.json).sort(), ['orderNo', 'sessionId', 'total', 'url']); // nothing new for the shop
    assert.equal(r.res.json.total, (16500 + R.hokkaido[4]) * 3);
    let o = (await orders(t, 'pending')).find((x) => x.no === r.orderNo);
    assert.deepEqual(o.addressWarnings, [{ who: 'customer', code: 'zip_pref_mismatch', zip: '900-0001', pref: '北海道', expected: ['沖縄県'] }]);
    // still there once it is paid (what the admin lists by default)
    await t.fake.pay(r.sessionId, { webhook: false });
    assert.equal((await t.call('GET', `/api/checkout/status?session_id=${r.sessionId}`)).json.payment, 'paid');
    o = (await orders(t, 'paid')).find((x) => x.no === r.orderNo);
    assert.deepEqual(o.addressWarnings, [{ who: 'customer', code: 'zip_pref_mismatch', zip: '900-0001', pref: '北海道', expected: ['沖縄県'] }]);
    // the delivery address is checked the same way (the customer's own address agrees here)
    const shipTo = { name: '山田 太郎', zip: '900-0001', pref: '北海道', addr1: '那覇市1-1', addr2: '', tel: '098-123-4567' };
    r = await checkout(t, { shipTo });
    assert.equal(r.res.status, 200, JSON.stringify(r.res.json));
    o = (await orders(t, 'pending')).find((x) => x.no === r.orderNo);
    assert.deepEqual(o.addressWarnings, [{ who: 'shipTo', code: 'zip_pref_mismatch', zip: '900-0001', pref: '北海道', expected: ['沖縄県'] }]);
    // both, in that order; a shared prefix lists both prefectures
    r = await checkout(t, { customer: customer({ zip: '6180001', pref: '兵庫県', addr1: '尼崎市1' }), shipTo });
    assert.equal(r.res.status, 200, JSON.stringify(r.res.json));
    o = (await orders(t, 'pending')).find((x) => x.no === r.orderNo);
    assert.deepEqual(o.addressWarnings, [
      { who: 'customer', code: 'zip_pref_mismatch', zip: '6180001', pref: '兵庫県', expected: ['京都府', '大阪府'] },
      { who: 'shipTo', code: 'zip_pref_mismatch', zip: '900-0001', pref: '北海道', expected: ['沖縄県'] },
    ]);
  });

  test('a 市区町村 that starts with a different prefecture\'s name is refused (400)', async () => {
    const before = (await orders(t, 'all')).length;
    let res = await t.call('POST', '/api/checkout', { body: checkoutBody({ customer: customer({ addr1: '沖縄県那覇市港町1-1' }) }) });
    assert.equal(res.status, 400);
    assert.deepEqual(fields(res), ['customer.addr1']);
    assert.equal(res.json.details[0].message, '市区町村・番地が「沖縄県」から始まっていますが、都道府県は「北海道」が選ばれています。ご住所をご確認ください。');
    res = await t.call('POST', '/api/checkout', { body: checkoutBody({ shipTo: { name: '山田 太郎', zip: '900-0001', pref: '北海道', addr1: '沖縄県那覇市1-1', addr2: '', tel: '098-123-4567' } }) });
    assert.equal(res.status, 400);
    assert.deepEqual(fields(res), ['shipTo.addr1']);
    assert.match(res.json.details[0].message, /^お届け先の市区町村・番地が「沖縄県」から始まっていますが、都道府県は「北海道」/);
    // 東京都 / 京都府 share characters but are different prefectures
    res = await t.call('POST', '/api/checkout', { body: checkoutBody({ customer: customer({ zip: '600-8001', pref: '京都府', addr1: '東京都港区高輪1-1' }) }) });
    assert.deepEqual(fields(res), ['customer.addr1']);
    assert.match(res.json.details[0].message, /「東京都」から始まっていますが、都道府県は「京都府」/);
    res = await t.call('POST', '/api/checkout', { body: checkoutBody({ customer: customer({ zip: '108-0074', pref: '東京都', addr1: '京都府京都市下京区1' }) }) });
    assert.deepEqual(fields(res), ['customer.addr1']);
    // nothing was created for any of them
    assert.equal((await orders(t, 'all')).length, before);
  });

  test('otherPrefAtStart: only another prefecture\'s whole name at the very start counts', () => {
    for (const a of Core.PREFS) {
      assert.equal(otherPrefAtStart(`${a}1-1`, a), '', a); // the chosen prefecture repeated
      for (const b of Core.PREFS) if (b !== a) assert.equal(otherPrefAtStart(`${a}1-1`, b), a, `${a} with ${b}`);
    }
    for (const [addr, pref] of [
      ['京都市下京区1', '京都府'], ['京都市下京区1', '東京都'], ['東京都港区', '東京都'], ['北海道札幌市', '北海道'], ['札幌市北区北海道1', '北海道'],
      ['愛知郡愛荘町1', '滋賀県'], ['府中市1', '東京都'], ['港区 東京都1', '京都府'], ['', '東京都'],
    ]) assert.equal(otherPrefAtStart(addr, pref), '', `${addr} with ${pref}`);
    // no prefecture chosen: the 都道府県 error covers it
    assert.equal(otherPrefAtStart('沖縄県那覇市', ''), '');
    assert.equal(otherPrefAtStart('沖縄県那覇市', '東京'), '');
  });

  test('prefsForZip: listed prefixes, shared prefixes, unlisted and malformed codes', () => {
    assert.deepEqual(prefsForZip('900-0001'), ['沖縄県']);
    assert.deepEqual(prefsForZip('0600001'), ['北海道']);
    assert.deepEqual(prefsForZip('618-0001'), ['京都府', '大阪府']);
    assert.equal(prefsForZip('199-0001'), null); // not in the table: not checked
    for (const z of ['', '12345', '900-00011', 'abc-defg', null, undefined]) assert.equal(prefsForZip(z), null, String(z));
  });

  test('postal codes that agree are accepted with no warning: shared prefixes, the prefecture repeated in 市区町村, unknown prefixes', async () => {
    for (const c of [
      { zip: '900-0001', pref: '沖縄県', addr1: '那覇市港町1-1' },
      { zip: '6180001', pref: '大阪府', addr1: '三島郡島本町山崎1' }, // 618: 京都府 and 大阪府
      { zip: '6180011', pref: '京都府', addr1: '乙訓郡大山崎町1' },
      { zip: '498-0801', pref: '三重県', addr1: '桑名郡木曽岬町1' }, // 498: 愛知県 and 三重県
      { zip: '871-0901', pref: '福岡県', addr1: '築上郡吉富町1' }, // 871: 大分県 and 福岡県
      { zip: '108-0074', pref: '東京都', addr1: '東京都港区高輪1-1' },
      { zip: '600-8001', pref: '京都府', addr1: '京都市下京区1' },
      { zip: '600-8001', pref: '京都府', addr1: '京都府京都市下京区1' },
      { zip: '060-0001', pref: '北海道', addr1: '北海道札幌市中央区北1条西1' },
      { zip: '529-1234', pref: '滋賀県', addr1: '愛知郡愛荘町1' },
      { zip: '183-0001', pref: '東京都', addr1: '府中市1' },
      { zip: '0100001', pref: '秋田県', addr1: '秋田市1' },
      { zip: '4000001', pref: '山梨県', addr1: '甲府市1' },
      { zip: '199-0001', pref: '沖縄県', addr1: '那覇市1' }, // not in the table: not checked
    ]) {
      const r = await checkout(t, { customer: customer(c) });
      assert.equal(r.res.status, 200, `${c.zip} ${c.pref}: ${JSON.stringify(r.res.json)}`);
      const o = (await orders(t, 'pending')).find((x) => x.no === r.orderNo);
      assert.ok(!('addressWarnings' in o), `${c.zip} ${c.pref}: ${JSON.stringify(o.addressWarnings)}`);
    }
  });

  test('non-JSON, wrong content type, too large', async () => {
    let res = await t.call('POST', '/api/checkout', { raw: '{not json', headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, 'bad_json');
    res = await t.call('POST', '/api/checkout', { raw: JSON.stringify(checkoutBody()), headers: { 'Content-Type': 'text/plain' } });
    assert.equal(res.status, 415);
    res = await t.call('POST', '/api/checkout', { body: checkoutBody({ memo: 'x'.repeat(70 * 1024) }) });
    assert.equal(res.status, 413);
    assert.equal(res.json.code, 'too_large');
    res = await t.call('POST', '/api/checkout', { body: [1, 2] });
    assert.equal(res.status, 400);
  });
});

describe('checkout pricing and the Stripe session', () => {
  let t;
  before(async () => { t = await setup({ now: clock('2026-10-12T03:00:00Z') }); });
  after(() => t.close());

  test('creates a pending order and a Checkout Session with the server\'s prices', async () => {
    const body = checkoutBody({
      items: [{ pid: 'shinmai-r8', vid: '10kg', qty: 1, price: 1, unit: 1, total: 1 }, { pid: 'shinmai-r8', vid: '5kg', qty: 1 }],
      total: 1, subtotal: 1, ship: 0, date: '10月20日（火）', time: '午前中', memo: '置き配希望',
    });
    const res = await t.call('POST', '/api/checkout', { body, headers: { Origin: ORIGIN } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const { orderNo, url, total } = res.json;
    assert.match(orderNo, /^MG-261012-\d{8}$/);
    // 10kg + 5kg → one 15kg parcel to 北海道
    assert.equal(total, 6900 + 3600 + R.hokkaido[2]);
    assert.ok(url.startsWith(t.fake.url + '/pay/cs_test_'));

    const req = lastStripeRequest(t);
    const f = req.form;
    // one key per checkout: the order number plus a random part (unique across databases)
    assert.match(req.headers['idempotency-key'], new RegExp(`^checkout-${orderNo}-[0-9a-f]{12}$`));
    // the API version is always pinned (the account's default never decides)
    assert.equal(req.headers['stripe-version'], '2026-09-30.endive');
    assert.equal(req.headers.authorization, `Bearer ${t.fake.secretKey}`);
    assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(f.mode, 'payment');
    assert.equal(f.locale, 'ja');
    // card only; payment_method_types was removed in 2026-09-30.endive
    assert.deepEqual(f.allowed_payment_method_types, ['card']);
    assert.equal(f.payment_method_types, undefined);
    assert.equal(f.submit_type, 'pay');
    assert.equal(f.customer_email, 'hanako@example.com');
    assert.equal(f.client_reference_id, orderNo);
    assert.deepEqual(f.metadata, { order_no: orderNo });
    assert.deepEqual(f.payment_intent_data.metadata, { order_no: orderNo });
    assert.equal(f.payment_intent_data.description, `満月米 ご注文 ${orderNo}`);
    assert.deepEqual(f.payment_intent_data.shipping, {
      name: '山田 花子', phone: '09012345678',
      address: { country: 'JP', postal_code: '0950000', state: '北海道', line1: '士別市上士別町1-2' },
    });
    assert.deepEqual(f.line_items, [
      { quantity: '1', price_data: { currency: 'jpy', unit_amount: '6900', product_data: { name: '満月米 ななつぼし 新米 令和8年産 10kg（5kg×2袋）' } } },
      { quantity: '1', price_data: { currency: 'jpy', unit_amount: '3600', product_data: { name: '満月米 ななつぼし 新米 令和8年産 5kg' } } },
    ]);
    assert.deepEqual(f.shipping_options, [{ shipping_rate_data: { type: 'fixed_amount', display_name: '送料（北海道）', fixed_amount: { amount: String(R.hokkaido[2]), currency: 'jpy' } } }]);
    assert.equal(f.success_url, `${SITE}/shop.html?session_id={CHECKOUT_SESSION_ID}#thanks`);
    assert.equal(f.cancel_url, `${SITE}/shop.html?canceled=1#checkout-confirm`);
    // SESSION_MINUTES (default 30), sent 2 minutes later: Stripe counts from when it creates the session
    assert.equal(Number(f.expires_at), Math.floor(t.now() / 1000) + 30 * 60 + 120);
    assert.equal(t.fake.sessions.get(url.split('/pay/')[1]).amount_total, total);

    const [o] = (await orders(t, 'pending')).filter((x) => x.no === orderNo);
    assert.equal(o.payment, 'pending');
    assert.equal(o.status, 'new');
    assert.equal(o.at, '2026-10-12T03:00:00.000Z');
    assert.deepEqual(o.customer, { name: '山田 花子', kana: 'ヤマダ ハナコ', tel: '09012345678', email: 'hanako@example.com', zip: '0950000', address: '北海道士別市上士別町1-2' });
    assert.equal(o.shipTo, null);
    assert.deepEqual(o.items, [
      { pid: 'shinmai-r8', vid: '10kg', name: '満月米 ななつぼし 新米 令和8年産', variant: '10kg（5kg×2袋）', gift: '', qty: 1, unit: 6900, total: 6900 },
      { pid: 'shinmai-r8', vid: '5kg', name: '満月米 ななつぼし 新米 令和8年産', variant: '5kg', gift: '', qty: 1, unit: 3600, total: 3600 },
    ]);
    assert.equal(o.subtotal, 10500);
    assert.equal(o.ship, R.hokkaido[2]);
    assert.deepEqual(o.shipDetail, { region: '北海道', parcels: [{ kg: 15, fee: R.hokkaido[2] }], free: false });
    assert.equal(o.total, total);
    assert.equal(o.pay, 'クレジットカード');
    assert.equal(o.date, '10月20日（火）');
    assert.equal(o.time, '午前中');
    assert.equal(o.memo, '置き配希望');
    assert.equal(o.source, '');
    assert.equal(o.preorder, false);
    assert.equal(o.stripe.sessionId, url.split('/pay/')[1]);
  });

  test('expectedTotal (the total the shop showed): a different server total → 409 price_changed, nothing created', async () => {
    const before = (await orders(t, 'all')).length;
    const total = 3600 + R.hokkaido[0];
    let res = await t.call('POST', '/api/checkout', { body: checkoutBody({ expectedTotal: total - 100 }) });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'price_changed');
    assert.deepEqual(res.json.details, { total });
    assert.equal((await orders(t, 'all')).length, before);
    res = await t.call('POST', '/api/checkout', { body: checkoutBody({ expectedTotal: total }) });
    assert.equal(res.status, 200);
    assert.equal(res.json.total, total);
    // absent or not a number (e.g. null while no prefecture was chosen) → not compared
    for (const expectedTotal of [undefined, null, '1']) {
      res = await t.call('POST', '/api/checkout', { body: checkoutBody({ expectedTotal }) });
      assert.equal(res.status, 200);
    }
  });

  test('duplicate lines are merged before the quantity limit is checked', async () => {
    const res = await t.call('POST', '/api/checkout', { body: checkoutBody({ items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 15 }, { pid: 'shinmai-r8', vid: '5kg', qty: 6 }] }) });
    assert.equal(res.status, 409);
    assert.deepEqual(res.json.details, [{ pid: 'shinmai-r8', vid: '5kg', code: 'qty', name: '満月米 ななつぼし 新米 令和8年産 5kg', max: 20 }]);
  });

  test('the delivery address decides the shipping; parcels show in the shipping name', async () => {
    const shipTo = { name: '山田 太郎', zip: '900-0001', pref: '沖縄県', addr1: '那覇市1-1', addr2: 'ハイツ101', tel: '098-123-4567' };
    const { res, orderNo } = await checkout(t, { items: [{ pid: 'genmai-30kg', vid: '30kg', qty: 2 }], shipTo });
    assert.equal(res.status, 200);
    assert.equal(res.json.total, 16500 * 2 + R.okinawa[4] * 2);
    const f = lastStripeRequest(t).form;
    assert.equal(f.shipping_options[0].shipping_rate_data.display_name, '送料（沖縄・2箱）');
    assert.equal(f.shipping_options[0].shipping_rate_data.fixed_amount.amount, String(R.okinawa[4] * 2));
    assert.deepEqual(f.payment_intent_data.shipping, { name: '山田 太郎', phone: '098-123-4567', address: { country: 'JP', postal_code: '900-0001', state: '沖縄県', line1: '那覇市1-1', line2: 'ハイツ101' } });
    const o = (await orders(t, 'pending')).find((x) => x.no === orderNo);
    assert.deepEqual(o.shipTo, { name: '山田 太郎', zip: '900-0001', address: '沖縄県那覇市1-1 ハイツ101', tel: '098-123-4567' });
    assert.deepEqual(o.shipDetail, { region: '沖縄', parcels: [{ kg: 30, fee: R.okinawa[4] }, { kg: 30, fee: R.okinawa[4] }], free: false });
  });

  test('free shipping over the threshold → 送料無料 with amount 0', async () => {
    const put = await editCatalog(t, (c) => { c.settings.ship.freeOver = 10000; });
    assert.equal(put.status, 200);
    const { res } = await checkout(t, { items: [{ pid: 'shinmai-r8', vid: '10kg', qty: 2 }] });
    assert.equal(res.json.total, 13800);
    const so = lastStripeRequest(t).form.shipping_options[0].shipping_rate_data;
    assert.equal(so.display_name, '送料無料');
    assert.equal(so.fixed_amount.amount, '0');
    await editCatalog(t, (c) => { c.settings.ship.freeOver = 0; });
  });

  test('order numbers use the Japan date and skip numbers already taken', async () => {
    const t2 = await setup({ now: clock('2026-10-12T15:30:00Z') }); // 2026-10-13 00:30 in Japan
    const seq = ['00001234', '00001234', '00001234', '56781234'];
    t2.env.orderDigits = () => seq.shift() || '99999999';
    const a = await checkout(t2);
    const b = await checkout(t2);
    assert.equal(a.orderNo, 'MG-261013-00001234');
    assert.equal(b.orderNo, 'MG-261013-56781234');
    await t2.close();
  });
});

describe('checkout: cart problems, subscriptions, configuration', () => {
  let t;
  before(async () => { t = await setup(); });
  after(() => t.close());

  test('sold out / not enough stock / quantity → 409 cart_changed with details', async () => {
    await editCatalog(t, (c) => {
      c.products.find((p) => p.id === 'genmai-30kg').status = 'soldout';
      c.products.find((p) => p.id === 'shinmai-r8').variants.find((v) => v.id === '10kg').stock = 1;
    });
    const res = await t.call('POST', '/api/checkout', {
      body: checkoutBody({ items: [
        { pid: 'genmai-30kg', vid: '30kg', qty: 1 },
        { pid: 'shinmai-r8', vid: '10kg', qty: 2 },
        { pid: 'shinmai-r8', vid: '5kg', qty: 25 },
        { pid: 'teiki', vid: 'm5', qty: 1 },
      ] }),
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'cart_changed');
    assert.deepEqual(res.json.details, [
      { pid: 'genmai-30kg', vid: '30kg', code: 'sold_out', name: '満月米 ななつぼし 玄米 令和8年産 30kg' },
      { pid: 'shinmai-r8', vid: '10kg', code: 'stock', name: '満月米 ななつぼし 新米 令和8年産 10kg（5kg×2袋）', max: 1 },
      { pid: 'shinmai-r8', vid: '5kg', code: 'qty', name: '満月米 ななつぼし 新米 令和8年産 5kg', max: 20 },
      { pid: 'teiki', vid: 'm5', code: 'not_found', name: '満月米 定期便' },
    ]);
    assert.equal((await orders(t)).length, 0);
  });

  test('a 定期便 (subscription) product is refused', async () => {
    await editCatalog(t, (c) => { c.products.find((p) => p.id === 'teiki').status = 'published'; });
    const res = await t.call('POST', '/api/checkout', { body: checkoutBody({ items: [{ pid: 'teiki', vid: 'm5', qty: 1 }, { pid: 'shinmai-r8', vid: '5kg', qty: 1 }] }) });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, 'subscription_not_supported');
    assert.equal((await orders(t)).length, 0);
  });

  test('without Stripe keys → 503 payments_unavailable', async () => {
    const t2 = await setup({ stripe: false });
    const res = await t2.call('POST', '/api/checkout', { body: checkoutBody() });
    assert.equal(res.status, 503);
    assert.equal(res.json.code, 'payments_unavailable');
    await t2.close();
  });

  test('Stripe refuses → 502 stripe_error, order expired, nothing secret leaks', async () => {
    const t2 = await setup();
    t2.env.STRIPE_SECRET_KEY = 'sk_test_wrong_key_123';
    const res = await t2.call('POST', '/api/checkout', { body: checkoutBody() });
    assert.equal(res.status, 502);
    assert.equal(res.json.code, 'stripe_error');
    assert.ok(!/sk_test|Invalid API Key/.test(res.text));
    const [o] = await orders(t2);
    assert.equal(o.payment, 'expired');
    await t2.close();
  });

  test('Stripe unreachable → 502 stripe_error', async () => {
    const t2 = await setup();
    await t2.fake.close();
    const res = await t2.call('POST', '/api/checkout', { body: checkoutBody() });
    assert.equal(res.status, 502);
    assert.equal(res.json.code, 'stripe_error');
    t2.env.DB.close();
  });

  test('an e-mail address Stripe refuses → 400 on customer.email, before any order number is used', async () => {
    const before = (await orders(t)).length;
    const asked = t.fake.requests.length;
    for (const email of ['taro..yamada.@docomo.ne.jp', 'a..b@example.com', '.taro@example.com', 'taro.@example.com']) {
      const res = await t.call('POST', '/api/checkout', { body: checkoutBody({ customer: customer({ email }) }) });
      assert.equal(res.status, 400, email);
      assert.deepEqual(fields(res), ['customer.email']);
      assert.match(res.json.details[0].message, /ご利用いただけません/);
    }
    assert.equal((await orders(t)).length, before);
    assert.equal(t.fake.requests.length, asked);
    // a dot inside the local part is fine
    const ok = await checkout(t, { customer: customer({ email: 'taro.yamada@example.com' }) });
    assert.equal(ok.res.status, 200);
  });

  test('if Stripe refuses shipping_options, the fee goes in as a line item (same total)', async () => {
    const t2 = await setup();
    t2.fake.setRejectShippingOptions(true);
    const { res, orderNo, session } = await checkout(t2, { items: [{ pid: 'genmai-30kg', vid: '30kg', qty: 1 }] });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.total, 16500 + R.hokkaido[4]);
    assert.equal(session.amount_total, res.json.total);
    const [first, req] = sessionRequests(t2);
    assert.equal(req.headers['idempotency-key'], `${first.headers['idempotency-key']}-line`);
    assert.ok(req.headers['idempotency-key'].startsWith(`checkout-${orderNo}-`));
    assert.equal(req.form.shipping_options, undefined);
    assert.deepEqual(req.form.line_items.at(-1), { quantity: '1', price_data: { currency: 'jpy', unit_amount: String(R.hokkaido[4]), product_data: { name: '送料（北海道）' } } });
    await t2.close();
  });

  test('a live key is never sent anywhere but api.stripe.com', async () => {
    const t2 = await setup();
    t2.env.STRIPE_SECRET_KEY = 'sk_live_should_not_leave';
    const res = await t2.call('POST', '/api/checkout', { body: checkoutBody() });
    assert.equal(res.status, 502);
    assert.equal(t2.fake.requests.length, 0);
    await t2.close();
  });
});

describe('event orders (source)', () => {
  test('kept only while the event is active (Japan date) and the slug matches', async () => {
    const now = clock('2026-10-25T01:00:00Z');
    const t = await setup({ now });
    const ev = Core.DEFAULT_EVENT;

    let r = await checkout(t, { source: 'takanawa', date: '10月30日（金）' });
    let o = (await orders(t)).find((x) => x.no === r.orderNo);
    assert.equal(o.source, 'takanawa');
    assert.equal(o.sourceName, ev.title);
    assert.equal(o.date, ''); // event orders ship on their own schedule
    assert.equal(o.notice.eventNote, ev.shipNote);

    r = await checkout(t, { source: 'other-event', date: '10月30日（金）' });
    o = (await orders(t)).find((x) => x.no === r.orderNo);
    assert.equal(o.source, '');
    assert.equal(o.sourceName, '');
    assert.equal(o.date, '10月30日（金）');

    // the day after the end date, in Japan time (2027-01-26 00:30 JST)
    now.set('2027-01-25T15:30:00Z');
    r = await checkout(t, { source: 'takanawa' });
    o = (await orders(t)).find((x) => x.no === r.orderNo);
    assert.equal(o.source, '');
    // still the last day in Japan (2027-01-25 23:30 JST)
    now.set('2027-01-25T14:30:00Z');
    r = await checkout(t, { source: 'takanawa' });
    o = (await orders(t)).find((x) => x.no === r.orderNo);
    assert.equal(o.source, 'takanawa');

    await editCatalog(t, (c) => { c.settings.event.enabled = false; });
    r = await checkout(t, { source: 'takanawa' });
    o = (await orders(t)).find((x) => x.no === r.orderNo);
    assert.equal(o.source, '');
    await t.close();
  });

  test('preorder products: no delivery date, thanks-page notice', async () => {
    const t = await setup();
    await editCatalog(t, (c) => {
      const p = c.products.find((x) => x.id === 'genmai-30kg');
      p.options.preorder = true;
      p.ship = '12月上旬から順次発送';
    });
    const r = await checkout(t, { items: [{ pid: 'genmai-30kg', vid: '30kg', qty: 1 }, { pid: 'shinmai-r8', vid: '5kg', qty: 1 }], date: '10月30日（金）' });
    const o = (await orders(t)).find((x) => x.no === r.orderNo);
    assert.equal(o.preorder, true);
    assert.equal(o.date, '');
    assert.deepEqual(o.notice, { mixed: true, preorderShip: '12月上旬から順次発送', eventNote: '' });
    await t.close();
  });
});
