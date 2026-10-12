/* 満月米 API — portable request handler.
 * handle(request, env, ctx) uses only Fetch API objects and WebCrypto, so it runs on Cloudflare
 * Workers (src/index.js), Node 18+ (dev/serve.mjs, tests) and Deno.
 *
 * env: DB (D1), IMAGES (R2, optional), STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, ADMIN_TOKEN,
 *      SITE_URL, ALLOWED_ORIGINS, STRIPE_API_BASE (optional), STRIPE_API_VERSION (optional),
 *      SESSION_MINUTES (optional), HOLD_SALT (optional), LIMIT_CHECKOUT / LIMIT_STATUS /
 *      LIMIT_CANCEL (optional).
 *      Tests may also pass now() (fake clock), orderDigits() (fake order numbers),
 *      stripeRetryDelays (shorter waits between Stripe retries), expireBatch and
 *      expireBudgetMs (closing open checkouts in smaller batches / with less time).
 */
import { HttpError, json, errorResponse, corsHeaders, preflight, originAllowed } from './http.js';
import { getPublicCatalog, postCheckout, getCheckoutStatus, postCheckoutCancel, postWebhook } from './checkout.js';
import { requireAdmin, getSession, getAdminCatalog, putAdminCatalog, getOrders, patchOrder } from './admin.js';
import { postImage, getImage } from './images.js';
import { sweepPending } from './orders.js';

const admin = (fn) => async (c) => { await requireAdmin(c.request, c.env); return fn(c); };

// [path or RegExp, { METHOD: handler }]
const ROUTES = [
  ['/api/health', { GET: () => json(200, { ok: true }) }],
  ['/api/catalog', { GET: getPublicCatalog }],
  ['/api/checkout', { POST: postCheckout }],
  ['/api/checkout/status', { GET: getCheckoutStatus }],
  ['/api/checkout/cancel', { POST: postCheckoutCancel }],
  ['/api/stripe/webhook', { POST: postWebhook }],
  ['/api/admin/session', { GET: admin(getSession) }],
  ['/api/admin/catalog', { GET: admin(getAdminCatalog), PUT: admin(putAdminCatalog) }],
  ['/api/admin/orders', { GET: admin(getOrders) }],
  [/^\/api\/admin\/orders\/([^/]+)$/, { PATCH: admin(patchOrder) }],
  ['/api/admin/images', { POST: admin(postImage) }],
  [/^\/api\/images\/([^/]+)$/, { GET: getImage, HEAD: getImage }],
];
// server-to-server calls without the shop's Origin
const NO_ORIGIN_CHECK = new Set(['/api/stripe/webhook']);

function match(pathname) {
  for (const [p, methods] of ROUTES) {
    if (typeof p === 'string') { if (p === pathname) return { path: p, methods, params: [] }; continue; }
    const m = p.exec(pathname);
    if (m) {
      try { return { path: String(p), methods, params: m.slice(1).map(decodeURIComponent) }; } catch { return null; }
    }
  }
  return null;
}

function withHeaders(res, extra) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'Vary') out.headers.append('Vary', v); else out.headers.set(k, v);
  }
  return out;
}

export async function handle(request, env = {}, ctx = undefined) {
  const cors = corsHeaders(request, env);
  try {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return preflight(request, env);
    const route = match(url.pathname);
    if (!route) throw new HttpError(404, 'not_found');
    const fn = route.methods[request.method];
    if (!fn) {
      const err = new HttpError(405, 'method_not_allowed');
      err.headers = { Allow: Object.keys(route.methods).join(', ') };
      throw err;
    }
    // a page on another site may read public data, but not change anything here
    const origin = request.headers.get('Origin');
    if (origin && !['GET', 'HEAD'].includes(request.method) && !NO_ORIGIN_CHECK.has(route.path)
      && origin !== url.origin && !originAllowed(origin, env)) {
      throw new HttpError(403, 'forbidden_origin');
    }
    const res = await fn({ request, env, ctx, url, params: route.params });
    return withHeaders(res, cors);
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e, { ...cors, ...(e.headers || {}) });
    // no request data in logs: only the kind of failure
    console.error('[server_error]', e && e.name, e && e.message);
    return errorResponse(new HttpError(500, 'server_error'), cors);
  }
}

// cron trigger: settle pending orders whose webhook never arrived
export async function scheduled(env) {
  try {
    const r = await sweepPending(env);
    if (r.checked || r.orphans || r.forgotten) console.log('[sweep]', JSON.stringify(r));
  } catch (e) {
    console.error('[sweep] failed', e && e.name, e && e.message);
  }
}
