/* A local imitation of the parts of Stripe this API uses (for tests and dev/serve.mjs).
 *   POST /v1/checkout/sessions            create (form-encoded, Bearer secret key, Idempotency-Key)
 *   GET  /v1/checkout/sessions/:id        retrieve
 *   POST /v1/checkout/sessions/:id/expire expire (sends checkout.session.expired)
 *   GET  /pay/:id                         a test payment page (「テスト決済する」「キャンセル」)
 *   POST /pay/:id/pay                     pay → signed checkout.session.completed webhook → 303 success_url
 *   POST /pay/:id/cancel                  303 cancel_url (the session stays open, like Stripe)
 * API versions: the Stripe-Version header, or the account's default (accountVersion, a new
 * account's: 2026-09-30.endive). From endive on, Checkout Sessions refuse payment_method_types
 * and take allowed_payment_method_types instead (like Stripe); older versions are the other way.
 * failNext() makes the next /v1 requests fail (a status, or a dropped connection after the
 * request ran) to try retries and idempotency keys. setDelay() makes every /v1 request slow.
 * beforeCreate(fn) runs fn once, while the next session is being created (before it exists), to
 * try what happens meanwhile. It is not Stripe: no cards, no emails, no Dashboard. Only for local trials. */
import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const rid = (n) => Array.from(randomBytes(n), (b) => ALNUM[b % ALNUM.length]).join('');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const yen = (n) => Number(n).toLocaleString('ja-JP');

// a[b][0][c]=1 → { a: { b: [ { c: '1' } ] } }
export function parseForm(text) {
  const root = {};
  for (const [key, value] of new URLSearchParams(text)) {
    const path = key.replace(/\]/g, '').split('[');
    let o = root;
    path.forEach((k, i) => {
      if (i === path.length - 1) o[k] = value;
      else o = o[k] && typeof o[k] === 'object' ? o[k] : (o[k] = {});
    });
  }
  const arrayify = (v) => {
    if (!v || typeof v !== 'object') return v;
    const keys = Object.keys(v);
    const out = keys.length && keys.every((k) => /^\d+$/.test(k))
      ? keys.sort((a, b) => a - b).map((k) => arrayify(v[k]))
      : Object.fromEntries(keys.map((k) => [k, arrayify(v[k])]));
    return out;
  };
  return arrayify(root);
}

const stripeError = (message, param, extra = {}) => ({ error: { type: 'invalid_request_error', message, param, ...extra } });
export const ACCOUNT_VERSION = '2026-09-30.endive';
// '2026-09-30.endive' → '2026-09-30' (versions sort by their date)
const versionDate = (v) => String(v || '').slice(0, 10);
const ENDIVE = '2026-09-30';
const isInt = (s) => typeof s === 'string' && /^\d+$/.test(s);
const absUrl = (s) => { try { return ['http:', 'https:'].includes(new URL(s).protocol); } catch { return false; } };

// → { error } | { session fields }
function buildSession(p, base, nowSec, opts = {}, version = ACCOUNT_VERSION) {
  if (p.mode !== 'payment') return { error: stripeError('mode must be payment in this fake', 'mode') };
  const cardOnly = (v) => Array.isArray(v) && v.length === 1 && v[0] === 'card';
  if (versionDate(version) >= ENDIVE) {
    if (p.payment_method_types !== undefined) return { error: stripeError('The `payment_method_types` parameter is no longer supported. Use `allowed_payment_method_types` or dynamic payment methods instead.', 'payment_method_types') };
    if (!cardOnly(p.allowed_payment_method_types)) return { error: stripeError('allowed_payment_method_types must be [card] in this fake', 'allowed_payment_method_types') };
  } else {
    if (p.allowed_payment_method_types !== undefined) return { error: stripeError('Received unknown parameter: allowed_payment_method_types', 'allowed_payment_method_types') };
    if (!cardOnly(p.payment_method_types)) return { error: stripeError('payment_method_types must be [card] in this fake', 'payment_method_types') };
  }
  if (!absUrl(p.success_url)) return { error: stripeError('Not a valid URL', 'success_url') };
  if (!absUrl(p.cancel_url)) return { error: stripeError('Not a valid URL', 'cancel_url') };
  // like Stripe, also refuse addresses that are not RFC-valid (e.g. "taro..yamada.@docomo.ne.jp")
  if (p.customer_email !== undefined && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.customer_email) || /^\.|\.\.|\.@/.test(p.customer_email))) return { error: stripeError('Invalid email address: ' + p.customer_email, 'customer_email', { code: 'email_invalid' }) };
  if (!Array.isArray(p.line_items) || !p.line_items.length || p.line_items.length > 100) return { error: stripeError('line_items is required', 'line_items') };
  let subtotal = 0;
  for (const [i, li] of p.line_items.entries()) {
    const pd = li.price_data || {};
    if (!isInt(li.quantity) || Number(li.quantity) < 1) return { error: stripeError('Invalid integer', `line_items[${i}][quantity]`) };
    if (pd.currency !== 'jpy') return { error: stripeError('Only jpy in this fake', `line_items[${i}][price_data][currency]`) };
    if (!isInt(pd.unit_amount)) return { error: stripeError('Invalid integer', `line_items[${i}][price_data][unit_amount]`) };
    if (!pd.product_data || !pd.product_data.name) return { error: stripeError('Missing required param', `line_items[${i}][price_data][product_data][name]`) };
    subtotal += Number(pd.unit_amount) * Number(li.quantity);
  }
  let shipping = 0;
  const so = p.shipping_options;
  if (so !== undefined && opts.rejectShippingOptions) return { error: stripeError('shipping_options is not available (simulated)', 'shipping_options') };
  if (so !== undefined) {
    if (!Array.isArray(so) || so.length > 5) return { error: stripeError('Invalid array', 'shipping_options') };
    const r = so[0] && so[0].shipping_rate_data;
    if (!r || r.type !== 'fixed_amount' || !r.display_name || !r.fixed_amount || !isInt(r.fixed_amount.amount) || r.fixed_amount.currency !== 'jpy') {
      return { error: stripeError('Invalid shipping_rate_data', 'shipping_options[0][shipping_rate_data]') };
    }
    shipping = Number(r.fixed_amount.amount);
  }
  if (p.expires_at !== undefined) {
    const e = Number(p.expires_at);
    if (!isInt(p.expires_at) || e < nowSec + 30 * 60 - 5 || e > nowSec + 24 * 3600 + 5) return { error: stripeError('expires_at must be 30 minutes to 24 hours from now', 'expires_at') };
  }
  for (const [k, v] of Object.entries(p.metadata || {})) if (k.length > 40 || String(v).length > 500) return { error: stripeError('Invalid metadata', `metadata[${k}]`) };
  const total = subtotal + shipping;
  if (total < 50) return { error: stripeError('Amount must be at least ¥50 jpy', null, { code: 'amount_too_small' }) };
  const id = `cs_test_${rid(58)}`;
  return {
    session: {
      id,
      object: 'checkout.session',
      url: `${base}/pay/${id}`,
      mode: 'payment',
      locale: p.locale || null,
      currency: 'jpy',
      amount_subtotal: subtotal,
      amount_total: total,
      total_details: { amount_discount: 0, amount_shipping: shipping, amount_tax: 0 },
      shipping_cost: so ? { amount_subtotal: shipping, amount_total: shipping, amount_tax: 0, shipping_rate: `shr_${rid(24)}` } : null,
      payment_status: 'unpaid',
      status: 'open',
      client_reference_id: p.client_reference_id || null,
      customer_email: p.customer_email || null,
      customer_details: null,
      metadata: p.metadata || {},
      payment_intent: null,
      payment_method_types: ['card'],
      submit_type: p.submit_type || null,
      success_url: p.success_url,
      cancel_url: p.cancel_url,
      expires_at: p.expires_at ? Number(p.expires_at) : nowSec + 24 * 3600,
      created: nowSec,
      livemode: false,
    },
  };
}

function payPage(s) {
  const p = s._params;
  const ship = p.shipping_options && p.shipping_options[0] && p.shipping_options[0].shipping_rate_data;
  const addr = p.payment_intent_data && p.payment_intent_data.shipping;
  const rows = p.line_items.map((li) => `<tr><td>${esc(li.price_data.product_data.name)}</td><td class="n">× ${esc(li.quantity)}</td><td class="n">¥${yen(Number(li.price_data.unit_amount) * Number(li.quantity))}</td></tr>`).join('');
  const open = s.status === 'open';
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>テスト決済（ローカル）</title><meta name="robots" content="noindex"><link rel="icon" href="data:,">
<style>
:root{color-scheme:light dark;--bg:#f6f7fb;--fg:#1a1f36;--card:#fff;--line:#e3e8ee;--sub:#697386;--btn:#635bff}
@media (prefers-color-scheme:dark){:root{--bg:#0f1220;--fg:#e8eaf2;--card:#1a1e30;--line:#2c3148;--sub:#9aa3b8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
main{max-width:560px;margin:0 auto;padding:24px 16px 48px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px}
.tag{display:inline-block;font-size:12px;background:#ffecb3;color:#5d4200;border-radius:999px;padding:2px 10px;margin-bottom:8px}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 12px;color:var(--sub)}table{width:100%;border-collapse:collapse;margin:12px 0}
td{padding:8px 0;border-bottom:1px solid var(--line);vertical-align:top}td.n{text-align:right;white-space:nowrap;padding-left:12px}
tr.total td{font-weight:700;font-size:18px;border-bottom:0}.btns{display:grid;gap:10px;margin-top:16px}
button{font:inherit;border-radius:8px;padding:12px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer;width:100%}
button.pay{background:var(--btn);border-color:var(--btn);color:#fff;font-weight:700}.small{font-size:13px}
</style></head><body><main>
<div class="card">
<span class="tag">ローカルの擬似 Stripe（本物の決済ではありません）</span>
<h1>テスト決済</h1>
<p class="small">ご注文番号 ${esc(s.client_reference_id)}／${esc(s.customer_email)}</p>
<table><tbody>${rows}
${ship ? `<tr><td>${esc(ship.display_name)}</td><td></td><td class="n">¥${yen(s.total_details.amount_shipping)}</td></tr>` : ''}
<tr class="total"><td>お支払い合計</td><td></td><td class="n">¥${yen(s.amount_total)}</td></tr></tbody></table>
${addr ? `<p class="small">お届け先：${esc(addr.name)} さま ／ 〒${esc(addr.address.postal_code)} ${esc(addr.address.state)}${esc(addr.address.line1)}${addr.address.line2 ? ' ' + esc(addr.address.line2) : ''}</p>` : ''}
${open ? `<div class="btns">
<form method="post" action="/pay/${esc(s.id)}/pay"><button class="pay" type="submit">テスト決済する</button></form>
<form method="post" action="/pay/${esc(s.id)}/cancel"><button type="submit">キャンセル（ショップに戻る）</button></form>
</div>` : `<p>この決済は終了しています（${esc(s.status)}）。</p>`}
</div></main></body></html>`;
}

const readBody = async (req) => { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks).toString('utf8'); };
const send = (res, status, body, headers = {}) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json', ...headers });
  res.end(text);
};

export function startFakeStripe({
  port = 0, host = '127.0.0.1', secretKey = 'sk_test_fake_local', webhookSecret = 'whsec_fake_local',
  webhookUrl = '', webhooks = true, now = () => Date.now(), rejectShippingOptions = false,
  accountVersion = ACCOUNT_VERSION,
} = {}) {
  const sessions = new Map();
  const idem = new Map();
  const requests = [];
  const events = [];
  // { status, drop, headers } for the next /v1 requests, in order
  const faults = [];
  // one-shot functions awaited while the next session creates are in progress, in order
  const createHooks = [];
  const state = { webhookUrl, webhooks, rejectShippingOptions, base: '', accountVersion, delayMs: 0 };
  const nowSec = () => Math.floor(now() / 1000);
  const pub = (s) => { const { _params, ...rest } = s; return rest; };

  async function sendEvent(type, s) {
    if (!state.webhooks || !state.webhookUrl) { events.push({ type, status: null, skipped: true }); return; }
    const event = { id: `evt_test_${rid(24)}`, object: 'event', api_version: state.accountVersion, created: nowSec(), livemode: false, type, data: { object: pub(s) }, pending_webhooks: 1, request: { id: null, idempotency_key: null } };
    const payload = JSON.stringify(event);
    const t = nowSec();
    const sig = createHmac('sha256', webhookSecret).update(`${t}.${payload}`).digest('hex');
    try {
      const r = await fetch(state.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Stripe-Signature': `t=${t},v1=${sig}`, 'User-Agent': 'Stripe/1.0 (fake)' }, body: payload });
      events.push({ type, status: r.status, event });
    } catch (e) {
      events.push({ type, status: 0, error: e.message, event });
    }
  }

  async function pay(id, { webhook = true } = {}) {
    const s = sessions.get(id);
    if (!s || s.status !== 'open') return null;
    Object.assign(s, { status: 'complete', payment_status: 'paid', payment_intent: `pi_test_${rid(24)}`, customer_details: { email: s.customer_email, name: null } });
    if (webhook) await sendEvent('checkout.session.completed', s);
    return s;
  }

  async function expire(id, { webhook = true } = {}) {
    const s = sessions.get(id);
    if (!s || s.status !== 'open') return null;
    s.status = 'expired';
    if (webhook) await sendEvent('checkout.session.expired', s);
    return s;
  }

  // the /v1 API → { status, body, headers }
  async function handleV1(req, url, body, form, version) {
    let m;
    if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const key = req.headers['idempotency-key'];
      if (key && idem.has(key)) {
        const prev = idem.get(key);
        if (prev.body !== body) return { status: 400, body: { error: { type: 'idempotency_error', message: 'Keys for idempotent requests can only be used with the same parameters they were first used with.' } } };
        return { status: 200, body: pub(sessions.get(prev.id)), headers: { 'Idempotent-Replayed': 'true' } };
      }
      const r = buildSession(form, state.base, nowSec(), state, version);
      if (r.error) return { status: 400, body: r.error };
      const s = { ...r.session, _params: form };
      sessions.set(s.id, s);
      if (key) idem.set(key, { body, id: s.id });
      return { status: 200, body: pub(s) };
    }
    if ((m = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(url.pathname)) && req.method === 'GET') {
      const s = sessions.get(m[1]);
      return s ? { status: 200, body: pub(s) } : { status: 404, body: stripeError(`No such checkout.session: '${m[1]}'`, 'id', { code: 'resource_missing' }) };
    }
    if ((m = /^\/v1\/checkout\/sessions\/([^/]+)\/expire$/.exec(url.pathname)) && req.method === 'POST') {
      const s = sessions.get(m[1]);
      if (!s) return { status: 404, body: stripeError(`No such checkout.session: '${m[1]}'`, 'id', { code: 'resource_missing' }) };
      if (s.status !== 'open') return { status: 400, body: stripeError(`Only Checkout Sessions with a status in ["open"] can be expired. This Checkout Session has a status of "${s.status}".`, null) };
      await expire(s.id);
      return { status: 200, body: pub(s) };
    }
    return { status: 404, body: stripeError('Unrecognized request URL', null) };
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, state.base);
      const body = req.method === 'POST' ? await readBody(req) : '';
      let m;
      if (url.pathname.startsWith('/v1/')) {
        const auth = req.headers.authorization || '';
        if (auth !== `Bearer ${secretKey}`) return send(res, 401, { error: { type: 'invalid_request_error', message: 'Invalid API Key provided' } });
        const form = body ? parseForm(body) : {};
        const version = req.headers['stripe-version'] || state.accountVersion;
        requests.push({ method: req.method, path: url.pathname, headers: { ...req.headers }, body, form, version });
        if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
        if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions' && createHooks.length) await createHooks.shift()(form);
        const fault = faults.shift();
        // a failure before the request runs (nothing is created, nothing is remembered for the key)
        if (fault && !fault.drop) return send(res, fault.status, { error: { type: 'api_error', message: 'simulated failure' } }, fault.headers || {});
        const out = await handleV1(req, url, body, form, version);
        // the request ran, but the answer never reaches the caller (like a timeout)
        if (fault && fault.drop) { req.socket.destroy(); return undefined; }
        return send(res, out.status, out.body, out.headers || {});
      }
      if ((m = /^\/pay\/([^/]+)$/.exec(url.pathname)) && req.method === 'GET') {
        const s = sessions.get(m[1]);
        return s ? send(res, 200, payPage(s)) : send(res, 404, '<!doctype html><meta charset="utf-8"><p>決済が見つかりません。</p>');
      }
      if ((m = /^\/pay\/([^/]+)\/(pay|cancel)$/.exec(url.pathname)) && req.method === 'POST') {
        const s = sessions.get(m[1]);
        if (!s) return send(res, 404, '<!doctype html><meta charset="utf-8"><p>決済が見つかりません。</p>');
        if (m[2] === 'cancel') return send(res, 303, '', { Location: s.cancel_url });
        if (s.status !== 'open') return send(res, 400, payPage(s));
        await pay(s.id);
        return send(res, 303, '', { Location: s.success_url.replace('{CHECKOUT_SESSION_ID}', s.id) });
      }
      return send(res, 404, { error: { message: 'not found' } });
    } catch (e) {
      send(res, 500, { error: { type: 'api_error', message: e.message } });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      state.base = `http://${host}:${server.address().port}`;
      resolve({
        url: state.base,
        secretKey,
        webhookSecret,
        sessions,
        requests,
        events,
        pay,
        expire,
        setWebhookUrl: (u) => { state.webhookUrl = u; },
        setWebhooks: (on) => { state.webhooks = on; },
        // simulate an account where Stripe refuses shipping_options
        setRejectShippingOptions: (on) => { state.rejectShippingOptions = on; },
        // the account's default API version (used when a request sends no Stripe-Version)
        setAccountVersion: (v) => { state.accountVersion = v; },
        // every /v1 request answers `ms` later (a slow Stripe)
        setDelay: (ms) => { state.delayMs = ms; },
        // the next `n` /v1 requests fail: { status } before running, or { drop: true } after running
        failNext: (n = 1, fault = { status: 503 }) => { for (let i = 0; i < n; i++) faults.push({ ...fault }); },
        // the next session create waits for `fn` (async; gets the form) before the session is made
        beforeCreate: (fn) => { createHooks.push(fn); },
        close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }),
      });
    });
  });
}
