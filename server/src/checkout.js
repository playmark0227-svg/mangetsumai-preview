/* Shop endpoints: public catalog, checkout (→ Stripe Checkout), payment status, Stripe webhook. */
import Core from './core.js';
import { HttpError, json, readJSON, readBody, nowMs, siteUrl, clientKey, clientHash, randomHex, later } from './http.js';
import { validateCheckout } from './validate.js';
import {
  loadCatalog, publicCatalog, insertOrder, setOrderSession, markExpired, getOrderBySession, getOrder, hitLimit,
  heldStock, stockAndHeld, heldKey, sameOrders, samePendingOrders,
} from './db.js';
import {
  buildOrder, statusView, finalizeSession, expireSession, refreshFromStripe, applySession, sessionMissing,
  sameOrderKey, holdMs, sessionExpiresAt, INFLIGHT_MS,
} from './orders.js';
import {
  stripeConfigured, createCheckoutSession, retrieveCheckoutSession, expireCheckoutSession, StripeError,
  SESSION_ID_RE, verifyWebhook, apiVersion,
} from './stripe.js';

const JPY_MINIMUM = 50; // Stripe's smallest card charge in yen

// Requests per client address (IPv6: per /64) per minute, counted in D1 — the order rows and
// Stripe calls they cause are what is limited. An event venue's Wi-Fi or a mobile carrier's shared
// address can put hundreds of phones behind one address, so the limits only cap abuse, and the
// window is one minute: when one phone uses up the count of an address, the others behind it wait
// a minute at most. Each has its own count: polling the thanks page never uses up the cancels a
// new checkout needs first. LIMIT_CHECKOUT / LIMIT_STATUS / LIMIT_CANCEL (whole numbers ≥ 1)
// override the defaults (the same average rate as 300 / 1,200 / 1,200 in 10 minutes).
export const LIMIT_WINDOW_MS = 60 * 1000;
export const DEFAULT_LIMITS = Object.freeze({
  checkout: 30, // POST /api/checkout past the price checks (refusals for held stock count too)
  status: 120, // Stripe lookups from GET /api/checkout/status (past it: the stored state is answered)
  cancel: 120, // Stripe calls from POST /api/checkout/cancel (past it: 429)
});
const warnedLimits = new Set();
export function limitFor(env, name) {
  const key = `LIMIT_${name.toUpperCase()}`;
  const raw = env[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_LIMITS[name];
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1) return n;
  if (!warnedLimits.has(key)) {
    warnedLimits.add(key);
    console.warn(`[limits] ${key} is not a whole number of 1 or more; using ${DEFAULT_LIMITS[name]}`);
  }
  return DEFAULT_LIMITS[name];
}

// HOLD_PER_CLIENT: units of one variant that one client (an address, or an IPv6 /64) may hold on
// open checkouts at a time — a whole number, 0 (the default) = no cap per client. A cap stops one
// person from making managed stock look sold out by opening checkouts without paying, but at an
// event venue hundreds of phones share one address, and the cap is then shared by all of them:
// it is off unless abuse is seen (see server/README.md, 在庫の取り置き)
let warnedHoldCap = false;
export function holdPerClient(env) {
  const raw = env.HOLD_PER_CLIENT;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0) return n;
  if (!warnedHoldCap) {
    warnedHoldCap = true;
    console.warn('[hold] HOLD_PER_CLIENT is not a whole number of 0 or more; no cap per client');
  }
  return 0;
}

const MSG = {
  invalid: '入力内容をご確認ください。',
  cart_changed: 'カートの商品に変更がありました。カートの内容をご確認のうえ、もう一度お手続きください。',
  event_only: 'イベント限定の商品は、イベントの期間中だけご注文いただけます。カートの内容をご確認のうえ、もう一度お手続きください。',
  price_changed: '価格または送料が変更されました。新しいお支払い合計をご確認のうえ、もう一度お手続きください。',
  subscription: '定期便は、オンラインでのお申し込みを準備しています。お手数ですが、カートから定期便を外してご注文ください。',
  payments_unavailable: 'ただいまカード決済をご利用いただけません。時間をおいて、もう一度お試しください。',
  stripe_error: '決済画面を準備できませんでした。時間をおいて、もう一度お試しください。',
  status_not_found: 'ご注文が見つかりませんでした。',
  too_many_requests: 'ただいまご注文の手続きが混み合っています。1分ほどおいて、もう一度お試しください。',
  duplicate_pending: '同じ内容のご注文の手続きが、ほかの画面で進んでいます。そちらの画面でお支払いを完了してください。',
};
// 409 duplicate_paid: the same order (e-mail address, items, delivery address) was paid a moment ago.
// details: { orderNo, paidAt } only (whoever knows the three can see that much; not the amount)
const duplicatePaidMessage = (no) => `同じ内容のご注文（ご注文番号 ${no}）のお支払いが、すでに完了しています。同じ商品をもう一度ご注文になる場合は、ご確認のうえ、改めてお手続きください。`;
const duplicatePaid = (o) => new HttpError(409, 'duplicate_paid', duplicatePaidMessage(o.no), { orderNo: o.no, paidAt: o.paidAt });

// 409 cart_changed with the cart problems as details. An event-only product outside its event
// ('event_only': the event is over, turned off, or the product was taken off its page) gets a
// message about the event period; the details are the same shape either way
const cartChanged = (problems) => new HttpError(409, 'cart_changed',
  problems.some((p) => p.code === 'event_only') ? MSG.event_only : MSG.cart_changed, problems);

// count one request toward a per-client limit → true while it is within the limit
async function withinLimit(env, request, name) {
  const n = await hitLimit(env, `${name}:${clientKey(request)}`, nowMs(env), LIMIT_WINDOW_MS);
  return n <= limitFor(env, name);
}
function tooMany() {
  const err = new HttpError(429, 'too_many_requests', MSG.too_many_requests);
  err.headers = { 'Retry-After': String(LIMIT_WINDOW_MS / 1000) };
  return err;
}

// card only (Apple Pay / Google Pay are cards too). From 2026-09-30.endive the parameter is
// allowed_payment_method_types; older versions (STRIPE_API_VERSION set to one) take payment_method_types
const cardOnly = (env) => (apiVersion(env) >= '2026-09-30'
  ? { allowed_payment_method_types: ['card'] }
  : { payment_method_types: ['card'] });

/* ---------- GET /api/catalog ---------- */
export async function getPublicCatalog({ env }) {
  const { catalog, rev } = await loadCatalog(env);
  return json(200, { catalog: publicCatalog(catalog), rev });
}

/* ---------- POST /api/checkout ---------- */
// Soft hold: units of managed stock (a stock number set in the admin) that other shoppers are
// paying for right now — pending orders whose Checkout Session can still be paid — cannot be
// sold again. Without it, the last units could be sold twice (both payments go through and the
// second order only gets a stockShort flag). With HOLD_PER_CLIENT set, one client (an address, or
// an IPv6 /64; stored as clientHash) holds at most that many units of a variant at a time; by
// default there is no cap per client (a venue's shoppers share one address), only the stock.
const holdRange = (env, ms, { before = '', client = '' } = {}) => ({ since: ms - holdMs(env), inflightSince: ms - INFLIGHT_MS, before, client });
const managedLines = (catalog, lines) => lines.filter((l) => {
  const p = catalog.products.find((x) => x.id === l.pid);
  const v = p && p.variants.find((x) => x.id === l.vid);
  return !!v && v.stock !== null;
});

// → cart problems in the same shape as Core.priceCart's:
//   'held'     the stock is enough, but other checkouts that may still be paid hold part of it (max:
//              what can be ordered now, 0 or more), or this client already holds HOLD_PER_CLIENT
//              units (max: what it may still order) — the units come back if those checkouts are
//              not paid, so it is worth trying again later
//   'stock'    the stock itself is short (lowered in the admin meanwhile; max: what can be ordered)
//   'sold_out' stock 0 (a payment came in meanwhile)
// cap: holdPerClient(env) (0 = no cap per client)
const NO_HOLD = { all: 0, mine: 0 };
function holdProblems(catalog, lines, held, cap) {
  const out = [];
  for (const l of lines) {
    const p = catalog.products.find((x) => x.id === l.pid);
    const v = p && p.variants.find((x) => x.id === l.vid);
    if (!v || v.stock === null) continue;
    const h = held.get(heldKey(l.pid, l.vid)) || NO_HOLD;
    const left = Math.max(0, v.stock - h.all);
    const allowed = cap > 0 ? Math.max(0, cap - h.mine) : Infinity;
    if (l.qty <= left && l.qty <= allowed) continue;
    const name = l.variant ? `${l.name} ${l.variant}` : l.name;
    const at = { pid: l.pid, vid: l.vid };
    if (v.stock <= 0) out.push({ ...at, code: 'sold_out', name });
    else if (l.qty <= v.stock || left === 0 || allowed < left) out.push({ ...at, code: 'held', name, max: Math.min(left, allowed) });
    else out.push({ ...at, code: 'stock', name, max: Math.min(left, Core.maxFor(catalog.settings, p, v)) });
  }
  return out;
}

// The same shopper in two browsers (or after the browser's storage was cleared) can start two
// checkouts for one cart: the shop cancels the earlier one only in the browser that made it.
// Before a new order is saved, the earlier ones with the same e-mail address, items and delivery
// address (dup_key) that may still be paid are expired at Stripe (best effort; one found paid is
// finalized), and a matching order paid in the last 60 minutes stops the new one with 409
// duplicate_paid unless the shopper confirmed it (confirmDuplicate: true).
// → the order numbers of the earlier checkouts it tried to close
const SAME_PAID_MS = 60 * 60 * 1000;
const paidLately = (list, ms) => list.filter((o) => o.payment === 'paid' && o.status !== 'canceled' && Date.parse(o.paidAt) >= ms - SAME_PAID_MS)
  .sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt));
async function settleSameOrders(env, ctx, dupKey, ms, confirmed) {
  const hold = holdMs(env);
  const found = await sameOrders(env, dupKey, ms - SAME_PAID_MS - hold);
  const after = [];
  const tried = new Set();
  for (const o of found) {
    if (o.payment === 'pending' && o.stripe.sessionId && Date.parse(o.at) >= ms - hold) {
      tried.add(o.no);
      after.push(await closeEarlier(env, ctx, o));
    } else after.push(o);
  }
  const paid = paidLately(after, ms);
  if (paid.length && !confirmed) throw duplicatePaid(paid[0]);
  return tried;
}

// The same order from two browsers within the time Stripe takes to create a session: neither saw
// the other's session before its own was saved. Once this checkout's session is saved, the other
// pending checkouts for the same order that have a session by now (and were not handled above:
// `tried`) are looked at, and the newest checkout wins — the one its shopper started last:
//   a newer one exists → this one is withdrawn (409 duplicate_pending: pay on the other screen)
//   otherwise          → the older ones are closed (best effort, as above); one found paid stops
//                        this one with 409 duplicate_paid unless the shopper confirmed it
// Whichever finishes first, only the newest stays payable (both may see each other: the older
// one then gives way, the newer one closes it).
async function settleRacingOrders(env, ctx, order, sessionId, dupKey, ms, { tried, confirmed }) {
  const others = (await samePendingOrders(env, dupKey, ms - holdMs(env), order.no)).filter((o) => !tried.has(o.no));
  if (!others.length) return;
  if (others.some((o) => o.newer)) {
    await withdraw(env, ctx, order, sessionId, ms);
    throw new HttpError(409, 'duplicate_pending', MSG.duplicate_pending);
  }
  const after = [];
  for (const o of others) after.push(await closeEarlier(env, ctx, o));
  const paid = paidLately(after, ms);
  if (paid.length && !confirmed) {
    await withdraw(env, ctx, order, sessionId, ms);
    throw duplicatePaid(paid[0]);
  }
}

// a checkout whose session was just created but is not handed out (refused after all): the order
// is expired here at once (it holds no stock any more), and the session at Stripe after the answer
// (best effort: nobody else has its URL, so it cannot be paid anyway, and it ends on its own)
async function withdraw(env, ctx, order, sessionId, ms) {
  await markExpired(env, order.no, ms);
  await later(ctx, async () => {
    try { await expireCheckoutSession(env, sessionId); } catch (e) {
      if (!(e instanceof StripeError)) throw e;
      console.warn('[checkout] could not expire a session that was not handed out', e.status, e.type);
    }
  }, 'checkout');
}

// The admin may save 売り切れ / 非公開 / a deletion / a lower stock / the end of the event (or the
// last units may be paid for) while Stripe is creating this session: closing open checkouts then
// misses this one (its session id was not saved yet). So once it is saved, the cart is checked
// again with the catalog as it is now and today's date (Japan time) — what is no longer for sale
// (the same rule as unsellableIn: not_found / sold_out / event_only), then, for managed stock, the
// hold as before — and a refused checkout is withdrawn (409 cart_changed).
const GONE = new Set(['not_found', 'sold_out', 'event_only']);
async function recheckCart(env, ctx, order, sessionId, { value, priced, pref, managed, client, ms }) {
  const now = managed ? await stockAndHeld(env, holdRange(env, ms, { before: order.no, client })) : await loadCatalog(env);
  const gone = Core.priceCart(now.catalog, value.items, { pref, today: Core.japanToday(nowMs(env)) }).problems
    .filter((p) => GONE.has(p.code));
  const short = gone.length || !managed ? gone : holdProblems(now.catalog, priced.lines, now.held, holdPerClient(env));
  if (!short.length) return;
  await withdraw(env, ctx, order, sessionId, ms);
  throw cartChanged(short);
}

// an earlier checkout for the same order → expired at Stripe (or finalized if it was paid) → the order now
async function closeEarlier(env, ctx, order) {
  try {
    const session = await expireCheckoutSession(env, order.stripe.sessionId);
    return (await applySession(env, session, { ctx })).order || order;
  } catch (e) {
    if (!(e instanceof StripeError)) throw e;
    if (sessionMissing(e)) {
      await markExpired(env, order.no, nowMs(env));
      return { ...order, payment: 'expired' };
    }
    if (e.status === 400) {
      // not open any more: paid (finalized now) or expired
      try { return await refreshFromStripe(env, order, { ctx }); } catch (e2) {
        if (!(e2 instanceof StripeError)) throw e2;
        console.warn('[checkout] could not check an earlier checkout for the same order', e2.status, e2.type);
        return order;
      }
    }
    console.warn('[checkout] could not expire an earlier checkout for the same order', e.status, e.type);
    return order;
  }
}

// shippingAsLine: put the shipping fee in a line item instead of shipping_options
// (fallback in case Stripe ever refuses shipping_options for this account)
function sessionParams(env, order, value, priced, ms, { shippingAsLine = false } = {}) {
  const site = siteUrl(env);
  const c = value.customer;
  const dest = value.shipTo || { name: `${c.name1} ${c.name2}`, zip: c.zip, pref: c.pref, addr1: c.addr1, addr2: c.addr2, tel: c.tel };
  const sh = priced.shipping;
  // 「送料（関東・2箱）」: the same wording as the shop (shoppers see 箱; the admin says 個口).
  // 送料込みの商品 (shipIncluded) add no box: with only those in the order there is no fee at all
  // (「送料込み」); with other goods, the fee is for the other goods' boxes, written as usual
  const shipName = sh.fee === 0
    ? (sh.included && !sh.parcels.length ? '送料込み' : '送料無料')
    : `送料（${sh.region.name}${sh.parcels.length > 1 ? `・${sh.parcels.length}箱` : ''}）`;
  const lineName = (l) => `${l.variant ? `${l.name} ${l.variant}` : l.name}${l.shipIncluded ? '（送料込み）' : ''}`;
  return {
    mode: 'payment',
    locale: 'ja',
    ...cardOnly(env),
    submit_type: 'pay',
    customer_email: c.email,
    client_reference_id: order.no,
    metadata: { order_no: order.no },
    payment_intent_data: {
      description: `満月米 ご注文 ${order.no}`,
      metadata: { order_no: order.no },
      shipping: {
        name: dest.name,
        phone: dest.tel,
        address: { country: 'JP', postal_code: dest.zip, state: dest.pref, line1: dest.addr1, line2: dest.addr2 || undefined },
      },
    },
    line_items: [
      ...priced.lines.map((l) => ({
        quantity: l.qty,
        price_data: { currency: 'jpy', unit_amount: l.unit, product_data: { name: lineName(l) } },
      })),
      ...(shippingAsLine && sh.fee > 0 ? [{ quantity: 1, price_data: { currency: 'jpy', unit_amount: sh.fee, product_data: { name: shipName } } }] : []),
    ],
    shipping_options: shippingAsLine ? undefined : [{
      shipping_rate_data: { type: 'fixed_amount', display_name: shipName, fixed_amount: { amount: sh.fee, currency: 'jpy' } },
    }],
    // {CHECKOUT_SESSION_ID} is filled in by Stripe
    success_url: `${site}/shop.html?session_id={CHECKOUT_SESSION_ID}#thanks`,
    cancel_url: `${site}/shop.html?canceled=1#checkout-confirm`,
    expires_at: sessionExpiresAt(env, ms),
  };
}

export async function postCheckout({ request, env, ctx }) {
  if (!stripeConfigured(env) || !siteUrl(env)) {
    console.error('[checkout] STRIPE_SECRET_KEY or SITE_URL is not set');
    throw new HttpError(503, 'payments_unavailable', MSG.payments_unavailable);
  }
  const body = await readJSON(request, 64 * 1024);
  const { value, errors } = validateCheckout(body);
  if (errors.length) throw new HttpError(400, 'invalid', MSG.invalid, errors);

  // everything is priced here; whatever amounts the browser may have sent are ignored.
  // Event-only products can be bought only on the event's dates in Japan time, by the server's clock
  const { catalog } = await loadCatalog(env);
  const ms = nowMs(env);
  const today = Core.japanToday(ms);
  const pref = value.shipTo ? value.shipTo.pref : value.customer.pref;
  const priced = Core.priceCart(catalog, value.items, { pref, today });
  if (priced.problems.length) throw cartChanged(priced.problems);
  if (priced.lines.some((l) => l.subscription)) throw new HttpError(400, 'subscription_not_supported', MSG.subscription);
  if (!Number.isInteger(priced.total) || priced.total <= 0 || priced.shipping.fee === null) {
    throw new HttpError(400, 'invalid', MSG.invalid, [{ field: 'items', message: 'ご注文の金額を計算できませんでした。カートの内容をご確認ください。' }]);
  }
  if (priced.total < JPY_MINIMUM) {
    throw new HttpError(400, 'invalid', MSG.invalid, [{ field: 'items', message: `カード決済は${JPY_MINIMUM}円からご利用いただけます。` }]);
  }
  // expectedTotal (optional) is the お支払い合計 the shop showed. It is never charged; when it
  // differs, a price or the shipping table changed after the page was loaded, and the shopper
  // confirms the new total before anything is created
  if (Number.isInteger(body.expectedTotal) && body.expectedTotal !== priced.total) {
    throw new HttpError(409, 'price_changed', MSG.price_changed, { total: priced.total });
  }

  // an event order: the shopper came from the event page (source) while the event is on, or the
  // order has an event-only product (priceCart let it through, so the event is on) — the latter
  // whatever source was sent (the cart may have been opened from another page)
  const ev = catalog.settings.event;
  const fromEvent = !!ev && (priced.lines.some((l) => l.eventOnly) || (!!value.source && value.source === ev.slug));
  const event = fromEvent && Core.eventActive(ev, today) ? ev : null;

  // every order row keeps its number, and the checks below read every open checkout or call
  // Stripe, so what one client can do from here on is limited (refusals for held stock included:
  // they cost the same and would otherwise let anyone probe the stock for free)
  if (!(await withinLimit(env, request, 'checkout'))) {
    console.warn('[checkout] too many checkouts from one address');
    throw tooMany();
  }
  // the same order started earlier (another browser): closed first, so that only one can be paid
  const dupKey = await sameOrderKey(value, priced.lines);
  const tried = await settleSameOrders(env, ctx, dupKey, ms, value.confirmDuplicate);
  // managed stock that other checkouts hold, and what this client holds (nothing is created when
  // it is not enough). The client is kept on the order even without HOLD_PER_CLIENT, so that
  // setting it later counts the checkouts already open
  const client = await clientHash(env, request);
  const cap = holdPerClient(env);
  const managed = managedLines(catalog, priced.lines).length > 0;
  if (managed) {
    const short = holdProblems(catalog, priced.lines, await heldStock(env, holdRange(env, ms, { client })), cap);
    if (short.length) throw cartChanged(short);
  }
  const order = await insertOrder(env, buildOrder({ value, priced, event, at: ms }), ms, { client, dupKey });
  if (managed) {
    // two checkouts for the last units (or from one client) at the same moment both pass the
    // check above: counted again with the stock as it is now, only orders saved before this one
    // keep their units
    const now = await stockAndHeld(env, holdRange(env, ms, { before: order.no, client }));
    const short = holdProblems(now.catalog, priced.lines, now.held, cap);
    if (short.length) {
      await markExpired(env, order.no, ms);
      throw cartChanged(short);
    }
  }
  // one key per checkout, unique across databases (a local test database and a deployed Worker
  // can share a Stripe test account); stripeRequest resends with the same key when it retries
  const idem = `checkout-${order.no}-${randomHex(6)}`;
  let session;
  try {
    try {
      session = await createCheckoutSession(env, sessionParams(env, order, value, priced, ms), idem);
    } catch (e) {
      if (!(e instanceof StripeError && /^shipping_options/.test(e.param))) throw e;
      console.warn('[checkout] shipping_options refused; sending the shipping fee as a line item');
      session = await createCheckoutSession(env, sessionParams(env, order, value, priced, ms, { shippingAsLine: true }), `${idem}-line`);
    }
    if (typeof session.id !== 'string' || typeof session.url !== 'string') throw new StripeError(502, { message: 'session without id/url' });
  } catch (e) {
    await markExpired(env, order.no, ms);
    if (!(e instanceof StripeError)) throw e;
    console.error('[checkout] Stripe refused the session', e.status, e.type, e.code, e.param);
    if (e.param === 'customer_email') {
      throw new HttpError(400, 'invalid', MSG.invalid, [{ field: 'customer.email', message: 'このメールアドレスはご利用いただけません。別のメールアドレスをご入力ください。' }]);
    }
    throw new HttpError(502, 'stripe_error', MSG.stripe_error);
  }
  await setOrderSession(env, order, session.id, ms);
  // what changed while Stripe was creating the session (the catalog; the same order from another
  // browser): a checkout refused now is withdrawn before its URL is handed out
  await recheckCart(env, ctx, order, session.id, { value, priced, pref, managed, client, ms });
  await settleRacingOrders(env, ctx, order, session.id, dupKey, ms, { tried, confirmed: value.confirmDuplicate });
  // sessionId: the shop keeps it to cancel this session (POST /api/checkout/cancel) when the
  // shopper comes back without paying or starts another checkout
  return json(200, { orderNo: order.no, url: session.url, total: order.total, sessionId: session.id });
}

/* ---------- GET /api/checkout/status?session_id= ---------- */
export async function getCheckoutStatus({ request, env, ctx, url }) {
  const sid = url.searchParams.get('session_id') || '';
  if (!SESSION_ID_RE.test(sid)) throw new HttpError(404, 'not_found', MSG.status_not_found);
  let order = await getOrderBySession(env, sid);
  if (!order) throw new HttpError(404, 'not_found', MSG.status_not_found);
  // the webhook may not have arrived yet: ask Stripe directly (a limited number of times per
  // client; past the limit the stored state is answered and the shop simply asks again later)
  if (order.payment === 'pending' && stripeConfigured(env)) {
    if (!(await withinLimit(env, request, 'status'))) {
      console.warn('[status] too many lookups from one address; answering without asking Stripe');
    } else {
      try { order = await refreshFromStripe(env, order, { ctx }); } catch (e) {
        if (!(e instanceof StripeError)) throw e;
        console.warn('[status] could not reach Stripe', e.status, e.type);
      }
    }
  }
  return json(200, statusView(order));
}

/* ---------- POST /api/checkout/cancel { session_id } ---------- */
// The shopper came back from Stripe without paying, or starts another checkout: the old Checkout
// Session is expired at Stripe so it can no longer be paid (it would otherwise stay payable until
// it expires — SESSION_MINUTES — and paying it as well would charge twice). The session id is long and random and
// only the shopper's browser has it, so it is the permission to cancel. A paid order is never
// touched; the answer is the same as GET /api/checkout/status.
export async function postCheckoutCancel({ request, env, ctx }) {
  const body = await readJSON(request, 4 * 1024);
  const sid = body && typeof body.session_id === 'string' ? body.session_id : '';
  if (!SESSION_ID_RE.test(sid)) throw new HttpError(404, 'not_found', MSG.status_not_found);
  let order = await getOrderBySession(env, sid);
  if (!order) throw new HttpError(404, 'not_found', MSG.status_not_found);
  if (order.payment !== 'pending' || !stripeConfigured(env)) return json(200, statusView(order));
  if (!(await withinLimit(env, request, 'cancel'))) {
    console.warn('[cancel] too many cancels from one address');
    throw tooMany();
  }
  try {
    const session = await expireCheckoutSession(env, sid);
    order = (await applySession(env, session, { ctx })).order || order;
  } catch (e) {
    if (!(e instanceof StripeError)) throw e;
    if (sessionMissing(e)) {
      await markExpired(env, order.no, nowMs(env));
    } else if (e.status === 400) {
      // not open any more (paid, or already expired): take Stripe's answer as it is
      try { order = await refreshFromStripe(env, order, { ctx }); } catch (e2) {
        if (!(e2 instanceof StripeError)) throw e2;
        console.warn('[cancel] could not reach Stripe', e2.status, e2.type);
      }
    } else {
      console.warn('[cancel] could not expire the session', e.status, e.type);
      throw new HttpError(502, 'stripe_error', MSG.stripe_error);
    }
  }
  return json(200, statusView((await getOrder(env, order.no)) || order));
}

/* ---------- POST /api/stripe/webhook ---------- */
// The Webhook endpoint should send "Snapshot" events (the full Checkout Session in data.object).
export async function postWebhook({ request, env, ctx }) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET is not set');
    // 5xx so that Stripe retries once the secret is configured
    throw new HttpError(503, 'webhook_unavailable', 'Webhook is not configured.');
  }
  const raw = await readBody(request, 1024 * 1024);
  const ok = await verifyWebhook(raw, request.headers.get('Stripe-Signature'), secret, { nowSec: Math.floor(nowMs(env) / 1000) });
  if (!ok) throw new HttpError(400, 'bad_signature', 'Invalid signature.');
  let event;
  try { event = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new HttpError(400, 'bad_json'); }
  const type = event && typeof event.type === 'string' ? event.type : '';

  // a "Thin" event destination (the Dashboard's recommended format) sends only the session id:
  // look the session up at Stripe instead of dropping the event
  if (event && event.object === 'v2.core.event' && /^v1\.checkout\.session\./.test(type)) {
    console.warn('[webhook] a Thin event arrived; set the Webhook endpoint to Snapshot (see server/README.md)');
    const rel = event.related_object;
    if (rel && rel.type === 'checkout.session' && SESSION_ID_RE.test(String(rel.id || '')) && stripeConfigured(env)) {
      let session;
      try { session = await retrieveCheckoutSession(env, rel.id); } catch (e) {
        if (!(e instanceof StripeError)) throw e;
        if (sessionMissing(e)) return json(200, { received: true });
        // 5xx: Stripe sends the event again later
        throw new HttpError(503, 'stripe_unavailable', 'Could not reach Stripe.');
      }
      if (type === 'v1.checkout.session.async_payment_failed' && session.payment_status !== 'paid') await expireSession(env, session);
      else await applySession(env, session, { ctx });
    }
    return json(200, { received: true });
  }

  const session = event && event.data && event.data.object;
  const isSession = !!session && session.object === 'checkout.session';
  switch (type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      if (isSession && session.payment_status === 'paid') await finalizeSession(env, session, { ctx });
      break;
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed':
      if (isSession) await expireSession(env, session);
      break;
    default:
      // other events are acknowledged and ignored
      if (/checkout\.session/.test(type)) console.warn('[webhook] unexpected event type', type.slice(0, 80));
      break;
  }
  return json(200, { received: true });
}
