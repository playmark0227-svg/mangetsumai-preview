/* HTTP helpers: JSON responses, errors, body reading with size limits, CORS. */

// Japanese messages shown to shoppers / the shop owner (the browser displays `error` as is)
export const MSG = {
  server_error: 'サーバーでエラーが発生しました。時間をおいて、もう一度お試しください。',
  not_found: '見つかりませんでした。',
  method_not_allowed: 'この操作には対応していません。',
  bad_json: '送信された内容を読み取れませんでした。ページを開き直して、もう一度お試しください。',
  unsupported_media_type: '送信された内容の形式に対応していません。',
  too_large: '送信された内容が大きすぎます。',
  forbidden_origin: 'このサイトからは利用できません。',
};

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || MSG[code] || MSG.server_error);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export function errorResponse(err, headers = {}) {
  const body = { error: err.message, code: err.code };
  if (err.details !== undefined) body.details = err.details;
  return json(err.status, body, headers);
}

// read the whole body, refusing anything over `limit` bytes (checked while streaming)
export async function readBody(request, limit) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, 'too_large');
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new HttpError(413, 'too_large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

const mediaType = (request) => (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();

// JSON bodies must say so: this also forces a CORS preflight for cross-site browsers
export async function readJSON(request, limit) {
  if (mediaType(request) !== 'application/json') throw new HttpError(415, 'unsupported_media_type');
  const bytes = await readBody(request, limit);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError(400, 'bad_json');
  }
}

export { mediaType };

/* ---------- CORS ---------- */
export function allowedOrigins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean));
}

export function originAllowed(origin, env) {
  return !!origin && allowedOrigins(env).has(origin);
}

export const CORS_METHODS = 'GET, POST, PUT, PATCH, OPTIONS';
export const CORS_HEADERS = 'Content-Type, Authorization';

// headers added to every response for an allowed origin
export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const h = { Vary: 'Origin' };
  if (originAllowed(origin, env)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

export function preflight(request, env) {
  const origin = request.headers.get('Origin');
  if (!originAllowed(origin, env)) {
    return new Response(null, { status: 403, headers: { Vary: 'Origin', 'Cache-Control': 'no-store' } });
  }
  return new Response(null, {
    status: 204,
    headers: {
      Vary: 'Origin',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': CORS_METHODS,
      'Access-Control-Allow-Headers': CORS_HEADERS,
      'Access-Control-Max-Age': '86400',
      'Cache-Control': 'no-store',
    },
  });
}

/* ---------- client address (for request limits and the admin lock-out) ---------- */
// an IPv6 address → its /64 prefix as 4 groups ('2001:db8:0:0'), or null when it does not parse.
// Cloudflare sends addresses in the compressed form ('2001:db8::5'), so '::' is expanded first:
// otherwise every address in one /64 would get a key of its own.
export function ipv6Prefix64(ip) {
  const s = String(ip).toLowerCase().split('%')[0];
  if (!/^[0-9a-f:.]+$/.test(s)) return null;
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const split = (x) => (x ? x.split(':') : []);
  const head = split(parts[0]);
  const tail = parts.length === 2 ? split(parts[1]) : [];
  // an IPv4 tail ('::ffff:192.0.2.1') takes the room of two groups
  const width = (list) => list.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0);
  const known = width(head) + width(tail);
  if (parts.length === 1 ? known !== 8 : known > 7) return null;
  const groups = [...head, ...Array(8 - known).fill('0'), ...tail];
  const first4 = groups.slice(0, 4);
  if (first4.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return first4.map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}

// one key per client: an IPv4 address, or an IPv6 /64 ('2001:db8:0:0::/64'); IPv4-mapped
// IPv6 addresses count as the IPv4 address. 'unknown' when there is no CF-Connecting-IP.
export function clientKey(request) {
  const ip = (request.headers.get('CF-Connecting-IP') || '').trim();
  if (!ip) return 'unknown';
  if (!ip.includes(':')) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  const p = ipv6Prefix64(ip);
  return p ? `${p}::/64` : ip.toLowerCase();
}

// the client as stored on an order (to count the stock one client holds): an HMAC of clientKey
// with a server secret — HOLD_SALT, else ADMIN_TOKEN — so the address itself is never stored.
// '' when neither is set (stock held is then not counted per client)
let warnedNoSalt = false;
export async function clientHash(env, request) {
  const secret = String(env.HOLD_SALT || env.ADMIN_TOKEN || '');
  if (!secret) {
    if (!warnedNoSalt) {
      warnedNoSalt = true;
      console.warn('[hold] neither HOLD_SALT nor ADMIN_TOKEN is set; stock held is not limited per client');
    }
    return '';
  }
  return (await hmacHex(secret, `client:${clientKey(request)}`)).slice(0, 32);
}

/* ---------- hashes (WebCrypto) ---------- */
const enc = new TextEncoder();
const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

// HMAC-SHA256 of a string or bytes → hex
export async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, typeof data === 'string' ? enc.encode(data) : data));
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/* ---------- small utils ---------- */
export const nowMs = (env) => (env && typeof env.now === 'function' ? Number(env.now()) : Date.now());
export const isoAt = (ms) => new Date(ms).toISOString();

// work the answer does not wait for: on Workers it runs after the response (ctx.waitUntil);
// without a ctx (tests, scripts) it runs before the answer. Never throws.
export async function later(ctx, task, label = 'later') {
  const p = (async () => {
    try { await task(); } catch (e) { console.warn(`[${label}] failed`, e && e.name, e && e.message); }
  })();
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
  else await p;
}

export function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

// constant-time comparison of two byte arrays of the same length
export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// compare secrets without leaking length or content through timing: compare SHA-256 digests
export async function secretEqual(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(given))),
    crypto.subtle.digest('SHA-256', enc.encode(String(expected))),
  ]);
  return bytesEqual(new Uint8Array(a), new Uint8Array(b));
}

// the shop's base URL (for Stripe success / cancel URLs), or '' when not configured
export function siteUrl(env) {
  const raw = String(env.SITE_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? raw : '';
  } catch {
    return '';
  }
}
