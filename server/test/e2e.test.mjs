/* End to end over real HTTP: API (node:http) + fake Stripe in-process.
 * checkout → fake payment page → pay → signed webhook → status 'paid' → admin sees the order. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/app.js';
import { createD1 } from '../dev/d1-sqlite.mjs';
import { serve } from '../dev/node-adapter.mjs';
import { startFakeStripe } from '../dev/fake-stripe.mjs';
import { checkoutBody, ORIGIN, SITE, ADMIN } from './helpers.mjs';

test('checkout → pay on the fake Stripe page → webhook → paid', async () => {
  const fake = await startFakeStripe({ webhookSecret: 'whsec_e2e_secret' });
  const env = {
    DB: createD1(),
    SITE_URL: SITE,
    ALLOWED_ORIGINS: ORIGIN,
    ADMIN_TOKEN: ADMIN,
    STRIPE_SECRET_KEY: fake.secretKey,
    STRIPE_WEBHOOK_SECRET: fake.webhookSecret,
    STRIPE_API_BASE: fake.url,
    stripeRetryDelays: [5, 5],
  };
  const api = await serve(handle, env);
  fake.setWebhookUrl(`${api.url}/api/stripe/webhook`);
  try {
    // the shop page asks for the catalog (CORS)
    let r = await fetch(`${api.url}/api/catalog`, { headers: { Origin: ORIGIN } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);

    // preflight + checkout, like the browser
    r = await fetch(`${api.url}/api/checkout`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    assert.equal(r.status, 204);
    r = await fetch(`${api.url}/api/checkout`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify(checkoutBody({ items: [{ pid: 'genmai-30kg', vid: '30kg', qty: 1 }, { pid: 'shinmai-r8', vid: '5kg', qty: 1 }], customer: { ...checkoutBody().customer, zip: '108-0074', pref: '東京都', addr1: '港区高輪1-1' } })),
    });
    const created = await r.json();
    assert.equal(r.status, 200, JSON.stringify(created));
    // 30kg + 5kg → two parcels to 関東: 1,560 + 840
    assert.equal(created.total, 16500 + 3600 + 1560 + 840);

    // the payment page shows the order
    r = await fetch(created.url);
    const html = await r.text();
    assert.equal(r.status, 200);
    assert.ok(html.includes('テスト決済する'));
    assert.ok(html.includes('送料（関東・2箱）'));
    assert.ok(html.includes(`¥${created.total.toLocaleString('ja-JP')}`));

    // pay → webhook → redirect back to the shop's thanks page
    const sid = created.url.split('/pay/')[1];
    r = await fetch(`${fake.url}/pay/${sid}/pay`, { method: 'POST', redirect: 'manual' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), `${SITE}/shop.html?session_id=${sid}#thanks`);
    assert.deepEqual(fake.events.map((e) => [e.type, e.status]), [['checkout.session.completed', 200]]);

    r = await fetch(`${api.url}/api/checkout/status?session_id=${encodeURIComponent(sid)}`, { headers: { Origin: ORIGIN } });
    const st = await r.json();
    assert.equal(st.payment, 'paid');
    assert.equal(st.orderNo, created.orderNo);
    assert.equal(st.total, created.total);
    assert.equal(st.name, '山田 花子');

    r = await fetch(`${api.url}/api/admin/orders`, { headers: { Origin: ORIGIN, Authorization: `Bearer ${ADMIN}` } });
    const { orders } = await r.json();
    assert.equal(orders.length, 1);
    assert.equal(orders[0].no, created.orderNo);
    assert.equal(orders[0].payment, 'paid');
    assert.deepEqual(orders[0].shipDetail, { region: '関東', parcels: [{ kg: 30, fee: 1560 }, { kg: 5, fee: 840 }], free: false });

    // a second order, canceled on the payment page → back to the confirm step, still pending
    r = await fetch(`${api.url}/api/checkout`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(checkoutBody()) });
    const second = await r.json();
    const sid2 = second.url.split('/pay/')[1];
    r = await fetch(`${fake.url}/pay/${sid2}/cancel`, { method: 'POST', redirect: 'manual' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), `${SITE}/shop.html?canceled=1#checkout-confirm`);
    r = await fetch(`${api.url}/api/checkout/status?session_id=${sid2}`);
    assert.equal((await r.json()).payment, 'pending');
    // the shop cancels the session it kept (sessionId) → Stripe expires it → it cannot be paid later
    assert.equal(second.sessionId, sid2);
    r = await fetch(`${api.url}/api/checkout/cancel`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sid2 }) });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal((await r.json()).payment, 'expired');
    assert.deepEqual(fake.events.map((e) => [e.type, e.status]).at(-1), ['checkout.session.expired', 200]);
    r = await fetch(`${fake.url}/pay/${sid2}/pay`, { method: 'POST', redirect: 'manual' });
    assert.equal(r.status, 400);
  } finally {
    await api.close();
    await fake.close();
    env.DB.close();
  }
});
