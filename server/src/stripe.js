/* Minimal Stripe REST client (fetch + form encoding) and webhook signature check (WebCrypto).
 * No SDK: only Checkout Sessions are used. */
import { bytesEqual, hmacHex } from './http.js';

const DEFAULT_BASE = 'https://api.stripe.com';
// Every request names the API version it was written for, so a Stripe account whose default
// version is newer (or older) cannot change what the requests mean. 2026-09-30.endive removed
// payment_method_types from Checkout Sessions (allowed_payment_method_types replaces it).
// STRIPE_API_VERSION overrides this; the Webhook endpoint should use the same version.
export const DEFAULT_API_VERSION = '2026-09-30.endive';
export const apiVersion = (env) => String(env.STRIPE_API_VERSION || '').trim() || DEFAULT_API_VERSION;
const TIMEOUT_MS = 10000;
// a request with an Idempotency-Key is sent again (same key, same body) after a network error,
// a timeout, 409, 429 or 5xx — Stripe then answers with the result of the first one if it ran
const RETRY_DELAYS_MS = [500, 1000];

export class StripeError extends Error {
  // message is Stripe's (English, may mention parameters) — for logs only, never for shoppers
  constructor(status, err = {}) {
    super(err.message || `Stripe request failed (${status})`);
    this.name = 'StripeError';
    this.status = status;
    this.type = err.type || '';
    this.code = err.code || '';
    this.param = err.param || '';
  }
}

export const stripeConfigured = (env) => typeof env.STRIPE_SECRET_KEY === 'string' && env.STRIPE_SECRET_KEY.length > 0;
// the shop takes real money (a live secret or restricted key)
export const liveKey = (env) => /^(sk|rk)_live_/.test(String(env.STRIPE_SECRET_KEY || ''));

function apiBase(env) {
  const base = String(env.STRIPE_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, '');
  // a live key is only ever sent to Stripe itself
  if (liveKey(env) && base !== DEFAULT_BASE) {
    throw new StripeError(0, { message: 'STRIPE_API_BASE must not be overridden with a live key' });
  }
  return base;
}

// { a: { b: [ { c: 1 } ] } } → a[b][0][c]=1  (Stripe's form encoding for nested params)
export function encodeForm(params) {
  const out = new URLSearchParams();
  const walk = (value, key) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${key}[${i}]`));
    else if (typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, key ? `${key}[${k}]` : k);
    else out.append(key, typeof value === 'boolean' ? String(value) : String(value));
  };
  walk(params, '');
  return out.toString();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// like Stripe's own SDKs: Stripe-Should-Retry decides when present; otherwise network errors,
// timeouts, 409 (a request with the same key still running), 429 and 5xx are worth another try
function shouldRetry(status, headers) {
  const h = headers ? headers.get('Stripe-Should-Retry') : null;
  if (h === 'false') return false;
  if (h === 'true') return true;
  return status === 0 || status === 409 || status === 429 || status >= 500;
}

async function sendOnce(env, method, path, headers, body) {
  let res;
  try {
    res = await fetch(apiBase(env) + path, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    if (e instanceof StripeError) throw e;
    const err = new StripeError(0, { message: `network error: ${e && e.name}` });
    err.retryable = true;
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new StripeError(res.status, (data && data.error) || {});
    err.retryable = shouldRetry(res.status, res.headers);
    throw err;
  }
  if (!data || typeof data !== 'object') throw new StripeError(res.status, { message: 'invalid JSON from Stripe' });
  return data;
}

export async function stripeRequest(env, method, path, params, { idempotencyKey } = {}) {
  const headers = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    Accept: 'application/json',
    'Stripe-Version': apiVersion(env),
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let body;
  if (params && method !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = encodeForm(params);
  }
  // without an idempotency key a POST is never sent twice (it could run twice at Stripe)
  // (tests may shorten the waits with env.stripeRetryDelays)
  const waits = Array.isArray(env.stripeRetryDelays) ? env.stripeRetryDelays : RETRY_DELAYS_MS;
  const delays = idempotencyKey || method === 'GET' ? waits : [];
  for (let attempt = 0; ; attempt++) {
    try {
      return await sendOnce(env, method, path, headers, body);
    } catch (e) {
      if (!(e instanceof StripeError) || !e.retryable || attempt >= delays.length) throw e;
      console.warn('[stripe] retrying', method, path.split('/').slice(0, 3).join('/'), e.status, e.type);
      await sleep(delays[attempt]);
    }
  }
}

export const createCheckoutSession = (env, params, idempotencyKey) =>
  stripeRequest(env, 'POST', '/v1/checkout/sessions', params, { idempotencyKey });

export const retrieveCheckoutSession = (env, id) =>
  stripeRequest(env, 'GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);

// an open session can no longer be paid afterwards (Stripe answers 400 when it is not open)
export const expireCheckoutSession = (env, id) =>
  stripeRequest(env, 'POST', `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`, null, { idempotencyKey: `expire-${id}` });

export const SESSION_ID_RE = /^cs_[A-Za-z0-9_]{1,250}$/;

/* ---------- webhooks ---------- */
const enc = new TextEncoder();

// the signed payload is `${t}.${raw body}` (bytes exactly as received)
function signedPayload(t, rawBytes) {
  const head = enc.encode(`${t}.`);
  const out = new Uint8Array(head.length + rawBytes.length);
  out.set(head, 0);
  out.set(rawBytes, head.length);
  return out;
}

// for tests and the fake Stripe: the header Stripe would send
export async function signWebhook(payload, secret, t = Math.floor(Date.now() / 1000)) {
  const bytes = typeof payload === 'string' ? enc.encode(payload) : payload;
  return `t=${t},v1=${await hmacHex(secret, signedPayload(t, bytes))}`;
}

// Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>...][,v0=...]
// true only when the timestamp is within `tolerance` seconds and one v1 matches
export async function verifyWebhook(rawBytes, header, secret, { nowSec = Math.floor(Date.now() / 1000), tolerance = 300 } = {}) {
  if (!header || !secret) return false;
  let t = null;
  const sigs = [];
  for (const part of String(header).split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) sigs.push(v.toLowerCase());
  }
  if (t === null || !sigs.length) return false;
  if (Math.abs(nowSec - t) > tolerance) return false;
  const expected = enc.encode(await hmacHex(secret, signedPayload(t, rawBytes)));
  let ok = false;
  // check every candidate (no early exit) so timing does not depend on which one matched
  for (const s of sigs) ok = bytesEqual(enc.encode(s), expected) || ok;
  return ok;
}
