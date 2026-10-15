/* Order records and the payment life cycle: pending → paid (finalize) or expired. */
import Core from './core.js';
import { isoAt, nowMs, later, sha256Hex } from './http.js';
import {
  loadCatalog, writeCatalog, getOrder, getOrderBySession, setOrderSession, markExpired, markPaid,
  stalePendingOrders, markChecked, expireOrphans, pruneLimits, openPendingOrders, heldKey, clearClientKeys,
} from './db.js';
import {
  retrieveCheckoutSession, expireCheckoutSession, stripeConfigured, liveKey, StripeError,
} from './stripe.js';

// How long a Checkout Session can be paid: SESSION_MINUTES (whole minutes, 30–1440; Stripe takes
// 30 minutes to 24 hours), 30 by default. Its order holds managed stock 10 minutes longer (for a
// late webhook), or until it is paid (the stock is then taken), cancelled or expired. A shorter
// session frees stock sooner when a shopper leaves Stripe's page open without paying.
export const SESSION_MINUTES = Object.freeze({ default: 30, min: 30, max: 1440 });
const HOLD_GRACE_MINUTES = 10;
// Stripe counts expires_at from when it creates the session (after any retries) and refuses less
// than 30 minutes: the time sent is this much later (and still under 24 hours)
const EXPIRY_MARGIN_S = 120;
let warnedMinutes = false;
export function sessionMinutes(env) {
  const raw = env.SESSION_MINUTES;
  if (raw === undefined || raw === null || String(raw).trim() === '') return SESSION_MINUTES.default;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= SESSION_MINUTES.min && n <= SESSION_MINUTES.max) return n;
  // out of range: the nearest allowed value; not a number: the default
  const use = Number.isFinite(n) ? Math.min(SESSION_MINUTES.max, Math.max(SESSION_MINUTES.min, Math.round(n))) : SESSION_MINUTES.default;
  if (!warnedMinutes) {
    warnedMinutes = true;
    console.warn(`[checkout] SESSION_MINUTES must be a whole number from ${SESSION_MINUTES.min} to ${SESSION_MINUTES.max}; using ${use}`);
  }
  return use;
}
export const holdMs = (env) => (sessionMinutes(env) + HOLD_GRACE_MINUTES) * 60 * 1000;
// expires_at for a Checkout Session created at `ms` (Unix seconds)
export const sessionExpiresAt = (env, ms) => Math.floor(ms / 1000)
  + Math.min(sessionMinutes(env) * 60 + EXPIRY_MARGIN_S, 24 * 3600 - EXPIRY_MARGIN_S);
// an order saved but whose Checkout Session is still being created (Stripe is retried for up to
// about a minute) holds its units too; after this it is a leftover and holds nothing
export const INFLIGHT_MS = 2 * 60 * 1000;
// Open Checkout Sessions are expired newest first (the shoppers who just started are the likeliest
// to pay), a batch at a time, until none is left or the time a Worker may keep working after its
// answer (ctx.waitUntil, about 30 seconds) is nearly used up. Anything left ends on its own when
// its session expires; it is counted for the log from the database (no Stripe calls) within a
// few more seconds. (Tests may set env.expireBatch / env.expireBudgetMs / env.expireCountBudgetMs.)
const EXPIRE_BATCH = 100;
const EXPIRE_PARALLEL = 5;
const EXPIRE_BUDGET_MS = 20 * 1000;
const COUNT_BUDGET_MS = 3 * 1000;

const address = (a) => `${a.pref}${a.addr1}${a.addr2 ? ' ' + a.addr2 : ''}`;

// The same order placed twice (the same shopper in two browsers, or after the browser's storage
// was cleared): the e-mail address (trimmed, lower case), the items (product|kind|number, in any
// order) and the delivery address (written the same way whatever the input: full-width
// characters, spaces, kinds of dashes) → SHA-256 hex, stored as orders.dup_key
const plain = (s) => String(s || '').normalize('NFKC').replace(/\s/g, '').replace(/[‐-―−ーｰ－]/g, '-').toLowerCase();
export function sameOrderKey(value, lines) {
  const d = value.shipTo || value.customer;
  return sha256Hex(JSON.stringify([
    String(value.customer.email || '').trim().toLowerCase(),
    lines.map((l) => `${l.pid}|${l.vid}|${l.qty}`).sort(),
    [plain(d.zip).replace(/-/g, ''), d.pref, plain(`${d.addr1}${d.addr2 || ''}`)],
  ]));
}

// the ORDER RECORD (same shape as the demo's orders in the admin, plus payment fields)
// value: validated checkout body; priced: Core.priceCart result; event: the active event or null
// (checkout.js passes it for an order from the event page, and for any order with an event-only product)
export function buildOrder({ value, priced, event, at }) {
  const c = value.customer;
  const s = value.shipTo;
  const lines = priced.lines;
  const preLine = lines.find((l) => l.preorder);
  const preorder = !!preLine;
  const sh = priced.shipping;
  return {
    at: isoAt(at),
    status: 'new',
    payment: 'pending',
    customer: { name: `${c.name1} ${c.name2}`, kana: `${c.kana1} ${c.kana2}`, tel: c.tel, email: c.email, zip: c.zip, address: address(c) },
    shipTo: s ? { name: s.name, zip: s.zip, address: address(s), tel: s.tel } : null,
    // the postal code does not match the prefecture (validate.js): shown in the admin; only when there is one
    ...(value.addressWarnings && value.addressWarnings.length ? { addressWarnings: value.addressWarnings } : {}),
    items: lines.map((l) => ({ pid: l.pid, vid: l.vid, name: l.name, variant: l.variant, gift: '', qty: l.qty, unit: l.unit, total: l.total })),
    subtotal: priced.sub,
    ship: sh.fee,
    // included: the order has 送料込みの商品 (their shipping is in their price; they are not in parcels).
    // Only when there are some
    shipDetail: {
      region: sh.region ? sh.region.name : '', parcels: sh.parcels.map((p) => ({ kg: p.kg, fee: p.fee })), free: sh.free,
      ...(sh.included ? { included: true } : {}),
    },
    total: priced.total,
    source: event ? event.slug : '',
    sourceName: event ? event.title : '',
    pay: 'クレジットカード',
    // preorders and event orders ship on their own schedule: no delivery date
    date: preorder || event ? '' : value.date,
    time: value.time,
    noshi: '',
    memo: value.memo,
    preorder,
    stripe: { sessionId: '' },
    // shown on the thanks page (GET /api/checkout/status)
    notice: {
      mixed: preorder && lines.some((l) => !l.preorder),
      preorderShip: preLine ? preLine.ship : '',
      eventNote: event ? event.shipNote : '',
    },
  };
}

// what the thanks page needs
export function statusView(order) {
  const n = order.notice || {};
  return {
    orderNo: order.no,
    payment: order.payment,
    name: (order.customer && order.customer.name) || '',
    total: order.total,
    preorder: !!order.preorder,
    mixed: !!n.mixed,
    preorderShip: n.preorderShip || '',
    eventNote: n.eventNote || '',
  };
}

const sessionOrderNo = (s) => [s.client_reference_id, s.metadata && s.metadata.order_no].filter((x) => typeof x === 'string' && x);

// the order a Checkout Session belongs to (by session id, or by our order number when the
// session id was never stored, e.g. the Worker stopped right after creating the session)
async function findOrderForSession(env, session) {
  if (!session || typeof session.id !== 'string') return null;
  const bySession = await getOrderBySession(env, session.id);
  if (bySession) return bySession;
  for (const no of sessionOrderNo(session)) {
    const o = await getOrder(env, no);
    if (o && !o.stripe.sessionId) return setOrderSession(env, o, session.id, nowMs(env));
  }
  return null;
}

const itemName = (it) => (it.variant ? `${it.name} ${it.variant}` : it.name);
const findItem = (catalog, it) => {
  const p = catalog.products.find((x) => x.id === it.pid);
  return { p, v: p && p.variants.find((x) => x.id === it.vid) };
};

// decrement managed stock (never below 0) → { catalog, touched, short, emptied (heldKeys now at 0) }
function takeStock(catalog, items) {
  const next = Core.clone(catalog);
  const short = [];
  const emptied = new Set();
  let touched = false;
  for (const it of items) {
    const { v } = findItem(next, it);
    if (!v || v.stock === null) continue;
    touched = true;
    if (v.stock < it.qty) short.push({ pid: it.pid, vid: it.vid, name: itemName(it), short: it.qty - v.stock });
    v.stock = Math.max(0, v.stock - it.qty);
    if (v.stock === 0) emptied.add(heldKey(it.pid, it.vid));
  }
  return { catalog: next, touched, short, emptied };
}

// items that were no longer for sale when the payment came in: the shop owner set the product
// to 売り切れ or 非公開, or deleted it (or the variant), while the shopper was on Stripe's page,
// or an event-only product's event ended (its end date passed, it was turned off, or the product
// was taken off the event page: 'event_ended'). today: the Japan date of the payment.
// The payment is kept (money was taken); the order is flagged for the admin.
// (Stock that ran out is recorded as stockShort instead.)
function unavailableItems(catalog, items, today) {
  const out = [];
  for (const it of items) {
    const { p, v } = findItem(catalog, it);
    const reason = !p || !v ? 'deleted' : p.status === 'draft' ? 'draft' : p.status === 'soldout' ? 'soldout'
      : !Core.eventSellable(catalog.settings, p, today) ? 'event_ended' : '';
    if (reason) out.push({ pid: it.pid, vid: it.vid, name: itemName(it), reason });
  }
  return out;
}

// an order item that can no longer be bought with `catalog` on `today` (Japan date): 売り切れ,
// 非公開, deleted, managed stock at 0, or an event-only product outside its event (the same rules
// as the shop and Core.priceCart)
export const unsellableIn = (catalog, today) => (it) => {
  const { p, v } = findItem(catalog, it);
  return !Core.isVisible(p) || !v || Core.variantSoldOut(p, v) || !Core.eventSellable(catalog.settings, p, today);
};

// a paid Checkout Session → order paid + stock taken, exactly once
// → { order, result: 'paid' | 'already' | 'unpaid' | 'mismatch' | 'testmode' | 'unknown' }
// opts.ctx (Workers): closing other checkouts for stock that ran out happens after the response
export async function finalizeSession(env, session, { ctx } = {}) {
  const order = await findOrderForSession(env, session);
  if (!order) return { order: null, result: 'unknown' };
  if (order.payment === 'paid') return { order, result: 'already' };
  if (session.payment_status !== 'paid') return { order, result: 'unpaid' };
  if (!sessionOrderNo(session).includes(order.no)) {
    console.warn('[finalize] session does not carry this order number; ignored');
    return { order, result: 'mismatch' };
  }
  // a test-mode payment (card 4242…, no money moved) never pays for an order once the shop takes
  // real money, e.g. a test session still open when the key was switched while STRIPE_WEBHOOK_SECRET
  // was still the test one. Only livemode === true counts as real (a missing or odd value does not).
  // The order stays pending (the sweep expires it: the live key does not know it)
  if (liveKey(env) && session.livemode !== true) {
    console.warn('[finalize] a test-mode payment arrived while the live key is set; the order stays pending');
    return { order, result: 'testmode' };
  }
  const ms = nowMs(env);
  // the Japan date of the payment, for event-only products: a session cannot be paid after it
  // expires, so a late webhook (or the sweep) never makes a payment made in time look late
  const paidBy = Number.isInteger(session.expires_at) && session.expires_at > 0 ? Math.min(ms, session.expires_at * 1000) : ms;
  const payDay = Core.japanToday(paidBy);
  const pi = session.payment_intent;
  const base = {
    ...order,
    payment: 'paid',
    paidAt: isoAt(ms),
    stripe: {
      ...order.stripe,
      sessionId: session.id,
      paymentIntent: typeof pi === 'string' ? pi : (pi && pi.id) || '',
      // false: a test-mode payment (shown as テスト決済 in the admin)
      ...(typeof session.livemode === 'boolean' ? { livemode: session.livemode } : {}),
    },
  };
  if (session.currency !== 'jpy' || session.amount_total !== order.total) {
    // money was taken, so the order still counts as paid — the admin has to look at it
    console.warn('[finalize] amount or currency differs from the order');
    base.amountMismatch = { expected: order.total, received: session.amount_total, currency: session.currency };
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const { catalog, rev } = await loadCatalog(env);
    const st = takeStock(catalog, order.items || []);
    const rec = { ...base };
    if (st.short.length) rec.stockShort = st.short;
    const gone = unavailableItems(catalog, order.items || [], payDay);
    if (gone.length) rec.unavailable = gone;
    let r;
    if (!st.touched) r = await markPaid(env, rec, ms);
    else if (rev === 0) {
      // the built-in catalog was never saved: store it first so there is a row to update
      await writeCatalog(env, catalog, 0, ms);
      continue;
    } else r = await markPaid(env, rec, ms, { catalog: st.catalog, rev });
    if (r === 'done') {
      // the last units are sold: other checkouts still open for them could only oversell
      if (st.emptied.size) {
        const emptied = st.emptied;
        await later(ctx, () => expireOpenCheckouts(env, (it) => emptied.has(heldKey(it.pid, it.vid)), { exceptNo: order.no }), 'expire');
      }
      return { order: rec, result: 'paid' };
    }
    if (r === 'already') return { order: await getOrder(env, order.no), result: 'already' };
  }
  throw new Error('the catalog kept changing while an order was being finalized');
}

// Checkout Sessions still open (pending orders within the hold window) with an item for which
// `unsellable(item)` is true → expired at Stripe, so they can no longer be paid, and marked expired
// here. Newest first, in batches, within the time budget (see EXPIRE_BUDGET_MS). Best effort,
// never throws: a session Stripe could not expire (or not reached in time) ends on its own when it
// expires, and if it is paid first, finalize flags the order (stockShort / unavailable).
// → { expired, failed, left, batches, stopped, more }
//   left     open checkouts for those items that were not tried (out of time), on every page:
//            the pages not reached are counted from the database only, without calling Stripe
//   batches  pages of open checkouts gone through to expire them
//   stopped  out of time; more: even counting ran out of time (left is then at least that many)
export async function expireOpenCheckouts(env, unsellable, { exceptNo = '' } = {}) {
  const out = { expired: 0, failed: 0, left: 0, batches: 0, stopped: false, more: false };
  const started = Date.now();
  const budget = Number.isFinite(env.expireBudgetMs) ? env.expireBudgetMs : EXPIRE_BUDGET_MS;
  const countBudget = Number.isFinite(env.expireCountBudgetMs) ? env.expireCountBudgetMs : COUNT_BUDGET_MS;
  const size = Number.isInteger(env.expireBatch) && env.expireBatch > 0 ? env.expireBatch : EXPIRE_BATCH;
  const timeUp = () => Date.now() - started >= budget;
  const affected = (o) => o.no !== exceptNo && Array.isArray(o.items) && o.items.some((it) => it && unsellable(it));
  try {
    if (!stripeConfigured(env)) return out;
    const since = nowMs(env) - holdMs(env);
    const one = async (o) => {
      try {
        const s = await expireCheckoutSession(env, o.stripe.sessionId);
        if (s && s.status === 'expired') {
          // (Stripe's checkout.session.expired webhook may have marked it already)
          await markExpired(env, o.no, nowMs(env));
          out.expired++;
        }
      } catch (e) {
        if (sessionMissing(e)) {
          await markExpired(env, o.no, nowMs(env));
          out.expired++;
        } else if (!(e instanceof StripeError && e.status === 400)) {
          // (400: no longer open — paid or expired at Stripe; the webhook or the sweep settles it)
          out.failed++;
          console.warn('[expire] could not expire an open checkout', e instanceof StripeError ? `stripe ${e.status} ${e.type}` : e && e.name);
        }
      }
    };
    // pages by (created_at, no): orders expired meanwhile drop out without shifting the next page
    let after = null;
    for (;;) {
      const rows = await openPendingOrders(env, since, { after, limit: size });
      if (!rows.length) break;
      out.batches++;
      after = rows.at(-1);
      const queue = rows.filter(affected);
      await Promise.all(Array.from({ length: Math.min(EXPIRE_PARALLEL, queue.length) }, async () => {
        while (queue.length) {
          if (timeUp()) { out.stopped = true; break; }
          await one(queue.shift());
        }
      }));
      out.left += queue.length;
      if (out.stopped || rows.length < size) break;
      // more pages may follow
      if (timeUp()) { out.stopped = true; break; }
    }
    // out of time: the pages not reached are only counted (database reads, no Stripe calls)
    if (out.stopped && after) {
      const until = Date.now() + countBudget;
      for (;;) {
        const rows = await openPendingOrders(env, since, { after, limit: size });
        if (!rows.length) break;
        after = rows.at(-1);
        out.left += rows.filter(affected).length;
        if (rows.length < size) break;
        if (Date.now() >= until) { out.more = true; break; }
      }
    }
  } catch (e) {
    out.failed++;
    console.warn('[expire] failed', e && e.name, e && e.message);
  }
  if (out.expired || out.failed || out.left || out.stopped) console.log('[expire]', JSON.stringify(out));
  return out;
}

// an expired / failed Checkout Session → pending order expired (a paid order is never touched)
export async function expireSession(env, session) {
  const order = await findOrderForSession(env, session);
  if (!order) return { order: null, result: 'unknown' };
  const changed = await markExpired(env, order.no, nowMs(env));
  return { order: changed ? await getOrder(env, order.no) : order, result: changed ? 'expired' : 'unchanged' };
}

// a Checkout Session as Stripe has it now → finalize (paid) or expire the order it belongs to
// → { order, result } (result 'open' when there is nothing to do yet)
export async function applySession(env, session, opts = {}) {
  if (session.payment_status === 'paid') return finalizeSession(env, session, opts);
  if (session.status === 'expired') return expireSession(env, session);
  return { order: null, result: 'open' };
}

// ask Stripe about a pending order's session and apply the answer → the order afterwards
export async function refreshFromStripe(env, order, opts = {}) {
  if (order.payment !== 'pending' || !order.stripe.sessionId) return order;
  const session = await retrieveCheckoutSession(env, order.stripe.sessionId);
  return (await applySession(env, session, opts)).order || order;
}

// Stripe does not know the session: it belongs to another account or mode (e.g. a test-mode
// session after the secret key was switched to the live one) and can never be paid with this key
export const sessionMissing = (e) => e instanceof StripeError && e.status === 404 && e.code === 'resource_missing';

// cron: settle orders whose webhook never arrived (5 minutes after their hold ended: the session
// expired at Stripe by then)
export async function sweepPending(env) {
  const ms = nowMs(env);
  const settled = ms - holdMs(env) - 5 * 60 * 1000;
  const out = { checked: 0, failed: 0, missing: 0 };
  // the client of an order (for the stock it holds) is not kept longer than a day
  try { out.forgotten = await clearClientKeys(env, ms - 24 * 60 * 60 * 1000); } catch (e) {
    console.warn('[sweep] could not clear client keys', e && e.name, e && e.message);
  }
  if (!env.STRIPE_SECRET_KEY) return out;
  for (const o of await stalePendingOrders(env, settled)) {
    out.checked++;
    // recorded whatever the answer: orders that keep failing move to the back of the queue
    await markChecked(env, o.no, ms);
    try { await refreshFromStripe(env, o); } catch (e) {
      if (sessionMissing(e)) {
        // expired, not deleted: a late webhook for a paid session can still finalize it
        out.missing++;
        await markExpired(env, o.no, ms);
        console.warn('[sweep] Stripe does not know the session of a pending order; marked expired');
        continue;
      }
      out.failed++;
      console.warn('[sweep] could not check a pending order', e instanceof StripeError ? `stripe ${e.status} ${e.type}` : e && e.name);
    }
  }
  // orders whose Checkout Session was never created (the Worker stopped in between)
  out.orphans = await expireOrphans(env, settled, ms);
  // request-limit rows from more than a day ago
  out.pruned = await pruneLimits(env, ms - 24 * 60 * 60 * 1000);
  return out;
}
