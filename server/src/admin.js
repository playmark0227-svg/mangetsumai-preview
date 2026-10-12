/* Admin endpoints (Authorization: Bearer <ADMIN_TOKEN>). */
import Core from './core.js';
import { HttpError, json, readJSON, nowMs, secretEqual, clientKey, later } from './http.js';
import {
  loadCatalog, writeCatalog, listOrders, setOrderStatus, ORDER_NO_RE,
  recordAttempt, clearFailures,
} from './db.js';
import { expireOpenCheckouts, unsellableIn } from './orders.js';

// what `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` gives:
// a short password a person made up could be found by guessing, so it is refused
export const MIN_TOKEN = 32;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MAX = 10;
const STATUSES = ['new', 'preparing', 'shipped', 'canceled'];
const PAYMENTS = ['paid', 'pending', 'expired', 'all'];

export async function requireAdmin(request, env) {
  const token = env.ADMIN_TOKEN;
  if (typeof token !== 'string' || token.length < MIN_TOKEN) {
    console.error(`[admin] ADMIN_TOKEN is not set or shorter than ${MIN_TOKEN} characters; admin access is off`);
    throw new HttpError(503, 'admin_unavailable', `管理画面はまだ使えません。サーバーに管理用パスワード（${MIN_TOKEN}文字以上）を設定してください。`);
  }
  const header = request.headers.get('Authorization') || '';
  // a request without any password is not a guess and does not count toward the lock
  if (!header) throw new HttpError(401, 'unauthorized', '管理用パスワードが違います。');
  const ms = nowMs(env);
  const ip = clientKey(request);
  // every attempt is counted BEFORE the password is checked (one atomic statement), so a burst
  // of requests sent at the same time gets at most LOCK_MAX checks per window
  const attempts = await recordAttempt(env, ip, ms, LOCK_WINDOW_MS);
  if (attempts > LOCK_MAX) {
    const err = new HttpError(429, 'too_many_attempts', 'パスワードの入力に続けて失敗したため、しばらくログインできません。15分ほどおいて、もう一度お試しください。');
    err.headers = { 'Retry-After': String(LOCK_WINDOW_MS / 1000) };
    throw err;
  }
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m || !(await secretEqual(m[1], token))) throw new HttpError(401, 'unauthorized', '管理用パスワードが違います。');
  await clearFailures(env, ip);
}

/* ---------- GET /api/admin/session ---------- */
export async function getSession() {
  return json(200, { ok: true });
}

/* ---------- GET /api/admin/catalog ---------- */
export async function getAdminCatalog({ env }) {
  const { catalog, rev } = await loadCatalog(env);
  return json(200, { catalog, rev });
}

/* ---------- PUT /api/admin/catalog ---------- */
export async function putAdminCatalog({ request, env, ctx }) {
  let body;
  try {
    body = await readJSON(request, 2_500_000);
  } catch (e) {
    if (e instanceof HttpError && e.code === 'too_large') {
      throw new HttpError(413, 'too_large', '保存するデータが大きすぎます。商品の画像の数や大きさを減らしてから、もう一度保存してください。');
    }
    throw e;
  }
  const c = body && body.catalog;
  // never let a broken payload reset the shop to the built-in catalog
  if (!c || typeof c !== 'object' || !Array.isArray(c.products) || !Array.isArray(c.categories)) {
    throw new HttpError(400, 'invalid', '商品データの形式が正しくありません。', [{ field: 'catalog', message: '商品データの形式が正しくありません。' }]);
  }
  if (!Number.isInteger(body.rev) || body.rev < 0) {
    throw new HttpError(400, 'invalid', '商品データの版（rev）が正しくありません。ページを開き直してください。', [{ field: 'rev', message: '商品データの版が正しくありません。' }]);
  }
  const catalog = Core.normalize(c);
  const ms = nowMs(env);
  const current = await loadCatalog(env);
  const r = current.rev === body.rev ? await writeCatalog(env, catalog, body.rev, ms) : { ok: false };
  if (!r.ok) {
    const latest = await loadCatalog(env);
    throw new HttpError(409, 'conflict', 'ほかの画面で商品データが更新されていました。最新の内容を読み込みましたので、もう一度変更してから保存してください。', latest);
  }
  // shoppers still on Stripe's page for something that is no longer for sale (売り切れ・非公開・
  // deleted・managed stock at 0) can no longer pay for it: their sessions are expired at Stripe.
  // On Workers this runs after the answer; Stripe being unreachable never fails the save (the
  // sessions then end on their own, and a payment that gets through is flagged on the order)
  await later(ctx, () => expireOpenCheckouts(env, unsellableIn(catalog)), 'expire');
  return json(200, { catalog, rev: r.rev });
}

/* ---------- GET /api/admin/orders?payment= ---------- */
export async function getOrders({ env, url }) {
  const payment = url.searchParams.get('payment') || 'paid';
  if (!PAYMENTS.includes(payment)) {
    throw new HttpError(400, 'invalid', '絞り込みの指定が正しくありません。', [{ field: 'payment', message: 'paid・pending・expired・all のいずれかを指定してください。' }]);
  }
  return json(200, { orders: await listOrders(env, payment) });
}

/* ---------- PATCH /api/admin/orders/:no ---------- */
export async function patchOrder({ request, env, params }) {
  const no = params[0];
  if (!ORDER_NO_RE.test(no)) throw new HttpError(404, 'not_found', '注文が見つかりませんでした。');
  const body = await readJSON(request, 4 * 1024);
  const status = body && body.status;
  if (!STATUSES.includes(status)) {
    throw new HttpError(400, 'invalid', '注文の状態の指定が正しくありません。', [{ field: 'status', message: '新規・発送準備中・発送済み・キャンセルのいずれかを選んでください。' }]);
  }
  const order = await setOrderStatus(env, no, status, nowMs(env));
  if (!order) throw new HttpError(404, 'not_found', '注文が見つかりませんでした。');
  return json(200, { order });
}
