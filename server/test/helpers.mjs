/* Shared test setup: in-memory D1, fake Stripe, a fake clock and request helpers. */
import { handle } from '../src/app.js';
import { createD1 } from '../dev/d1-sqlite.mjs';
import { startFakeStripe } from '../dev/fake-stripe.mjs';
import { signWebhook } from '../src/stripe.js';

export const ORIGIN = 'https://shop.example';
export const SITE = 'https://shop.example/mangetsu';
export const API = 'https://api.example';
export const ADMIN = 'test-admin-token-0123456789abcdef'; // 32+ characters
export const WHSEC = 'whsec_test_0123456789abcdef';

// a settable clock: env.now()
export function clock(iso = '2026-10-12T03:00:00Z') {
  let t = Date.parse(iso);
  const now = () => t;
  now.set = (s) => { t = Date.parse(s); };
  now.advance = (ms) => { t += ms; };
  return now;
}

export async function setup({ stripe = true, now = clock(), env: over = {} } = {}) {
  const fake = stripe ? await startFakeStripe({ webhookSecret: WHSEC, now }) : null;
  const env = {
    DB: createD1(),
    SITE_URL: SITE,
    ALLOWED_ORIGINS: ORIGIN,
    ADMIN_TOKEN: ADMIN,
    STRIPE_SECRET_KEY: fake ? fake.secretKey : '',
    STRIPE_WEBHOOK_SECRET: WHSEC,
    now,
    stripeRetryDelays: [5, 5],
    ...(fake ? { STRIPE_API_BASE: fake.url } : {}),
    ...over,
  };
  // → { status, headers, json, text }
  const call = async (method, path, { body, raw, headers = {}, admin } = {}) => {
    const h = { ...headers };
    let b;
    if (raw !== undefined) b = raw;
    else if (body !== undefined) {
      b = JSON.stringify(body);
      if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/json';
    }
    if (admin) h.Authorization = `Bearer ${admin === true ? ADMIN : admin}`;
    const res = await handle(new Request(API + path, { method, headers: h, body: b }), env);
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(buf);
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, json, text, bytes: buf };
  };
  const close = async () => { if (fake) await fake.close(); env.DB.close(); };
  return { env, fake, call, now, close };
}

export const customer = (over = {}) => ({
  name1: '山田', name2: '花子', kana1: 'ヤマダ', kana2: 'ハナコ', zip: '0950000', pref: '北海道',
  addr1: '士別市上士別町1-2', addr2: '', tel: '09012345678', email: 'hanako@example.com', ...over,
});

export const checkoutBody = (over = {}) => ({
  items: [{ pid: 'shinmai-r8', vid: '5kg', qty: 1 }],
  customer: customer(),
  shipTo: null,
  date: '',
  time: '指定なし',
  memo: '',
  source: '',
  ...over,
});

// create an order through the API → { res, orderNo, sessionId, session }
// Each call is another shopper (an e-mail address of its own) unless `over` gives the customer:
// the same e-mail address, items and delivery address would close the earlier checkout.
let shopperNo = 0;
export async function checkout(t, over = {}) {
  const body = checkoutBody({ customer: customer({ email: `hanako+${++shopperNo}@example.com` }), ...over });
  const res = await t.call('POST', '/api/checkout', { body, headers: { Origin: ORIGIN } });
  if (res.status !== 200) return { res };
  const sessionId = res.json.url.split('/pay/')[1];
  return { res, orderNo: res.json.orderNo, sessionId, session: t.fake.sessions.get(sessionId) };
}

// the last Checkout Session request the fake received
export const lastStripeRequest = (t) => t.fake.requests.filter((r) => r.path === '/v1/checkout/sessions').at(-1);
export const sessionRequests = (t) => t.fake.requests.filter((r) => r.path === '/v1/checkout/sessions');

// POST a signed webhook event
export async function webhook(t, event, { secret = WHSEC, ts, header } = {}) {
  const payload = typeof event === 'string' ? event : JSON.stringify(event);
  const sig = header ?? await signWebhook(payload, secret, ts ?? Math.floor(t.now() / 1000));
  return t.call('POST', '/api/stripe/webhook', { raw: payload, headers: { 'Stripe-Signature': sig, 'Content-Type': 'application/json; charset=utf-8' } });
}

export const sessionEvent = (type, session) => ({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type, data: { object: session } });

// change the stored catalog like the admin would → PUT response
export async function editCatalog(t, mutate) {
  const r = await t.call('GET', '/api/admin/catalog', { admin: true });
  const c = r.json.catalog;
  mutate(c);
  return t.call('PUT', '/api/admin/catalog', { admin: true, body: { catalog: c, rev: r.json.rev } });
}

export const variant = (catalog, pid, vid) => catalog.products.find((p) => p.id === pid).variants.find((v) => v.id === vid);

export async function adminCatalog(t) {
  return (await t.call('GET', '/api/admin/catalog', { admin: true })).json;
}

export async function orders(t, payment = 'all') {
  return (await t.call('GET', `/api/admin/orders?payment=${payment}`, { admin: true })).json.orders;
}
