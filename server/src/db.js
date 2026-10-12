/* D1 storage: the catalog document and the orders table. */
import Core from './core.js';
import { HttpError, isoAt, randomHex } from './http.js';

export const CATALOG_MAX_BYTES = 1_800_000;
// MG-YYMMDD-NNNNNNNN (8 random digits). Numbers with 4 digits come from before 2026-10 and
// are still accepted (an order keeps its number).
export const ORDER_NO_RE = /^MG-\d{6}-(?:\d{8}|\d{4})$/;

const DB = (env) => {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('D1 binding "DB" is missing');
  return env.DB;
};
const byteLength = (s) => new TextEncoder().encode(s).length;

/* ---------- catalog ---------- */
export const defaultCatalog = () => Core.normalize(Core.clone(Core.DEFAULT_CATALOG));

const CATALOG_SQL = 'SELECT rev, data FROM catalog WHERE id = 1';

// → { catalog (normalized), rev }; rev 0 = nothing saved yet (the built-in catalog)
export async function loadCatalog(env) {
  return catalogFromRow(await DB(env).prepare(CATALOG_SQL).first());
}

function catalogFromRow(row) {
  if (!row) return { catalog: defaultCatalog(), rev: 0 };
  let data = null;
  try { data = JSON.parse(row.data); } catch { /* handled below */ }
  if (!data) console.error('[catalog] stored data is not valid JSON; serving the built-in catalog');
  return { catalog: data ? Core.normalize(data) : defaultCatalog(), rev: Number(row.rev) };
}

// what shoppers may see: no drafts (非公開)
export const publicCatalog = (catalog) => ({ ...catalog, products: catalog.products.filter((p) => p.status !== 'draft') });

export function catalogJSON(catalog) {
  const data = JSON.stringify(catalog);
  if (byteLength(data) > CATALOG_MAX_BYTES) {
    throw new HttpError(413, 'too_large', '保存するデータが大きすぎます。商品の画像の数や大きさを減らしてから、もう一度保存してください。');
  }
  return data;
}

// save `catalog` (already normalized) if the stored rev is still `rev` → { ok, rev }
export async function writeCatalog(env, catalog, rev, at) {
  const data = catalogJSON(catalog);
  const stamp = randomHex(16);
  const db = DB(env);
  const r = rev === 0
    ? await db.prepare(`INSERT INTO catalog (id, rev, data, stamp, updated_at) VALUES (1, 1, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET rev = catalog.rev + 1, data = excluded.data, stamp = excluded.stamp, updated_at = excluded.updated_at
        WHERE catalog.rev = 0`).bind(data, stamp, isoAt(at)).run()
    : await db.prepare('UPDATE catalog SET rev = rev + 1, data = ?, stamp = ?, updated_at = ? WHERE id = 1 AND rev = ?')
      .bind(data, stamp, isoAt(at), rev).run();
  return r.meta.changes === 1 ? { ok: true, rev: rev + 1 } : { ok: false };
}

/* ---------- orders ---------- */
function rowToOrder(row) {
  let data = {};
  try { data = JSON.parse(row.data) || {}; } catch { /* keep the columns at least */ }
  // the column is the source of truth for the session id
  const stripe = { ...(data.stripe || {}), sessionId: row.session_id || '' };
  return { ...data, no: row.no, at: row.created_at, payment: row.payment, status: row.status, stripe };
}

// 'MG-' + Japan date (YYMMDD) + '-' + 8 random digits: 100,000,000 numbers a day, so numbers
// used up by abandoned or refused checkouts never run short (every order row keeps its number)
const ORDER_DIGITS = 8;
const rand8 = () => {
  const a = new Uint32Array(1);
  // rejection sampling keeps the digits uniform (4,200,000,000 is a multiple of 10^8)
  do crypto.getRandomValues(a); while (a[0] >= 4_200_000_000);
  return String(a[0] % 10 ** ORDER_DIGITS).padStart(ORDER_DIGITS, '0');
};
export const orderNoFor = (ms, digits = rand8()) => `MG-${Core.japanToday(ms).slice(2).replace(/-/g, '')}-${digits}`;

// insert a new order, picking a free order number → the stored record (with `no`)
// client: clientHash of the shopper's address; dupKey: sameOrderKey (both columns only, never in data)
export async function insertOrder(env, record, ms, { client = '', dupKey = '' } = {}) {
  const db = DB(env);
  const digits = typeof env.orderDigits === 'function' ? env.orderDigits : rand8; // tests can force collisions
  for (let i = 0; i < 20; i++) {
    const rec = { ...record, no: orderNoFor(ms, digits()) };
    const r = await db.prepare(`INSERT INTO orders (no, created_at, payment, status, session_id, data, updated_at, client_key, dup_key)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?) ON CONFLICT (no) DO NOTHING`)
      .bind(rec.no, rec.at, rec.payment, rec.status, JSON.stringify(rec), rec.at, client || null, dupKey || null).run();
    if (r.meta.changes === 1) return rec;
  }
  throw new Error('could not allocate an order number');
}

export async function getOrder(env, no) {
  const row = await DB(env).prepare('SELECT * FROM orders WHERE no = ?').bind(no).first();
  return row ? rowToOrder(row) : null;
}

export async function getOrderBySession(env, sessionId) {
  const row = await DB(env).prepare('SELECT * FROM orders WHERE session_id = ?').bind(sessionId).first();
  return row ? rowToOrder(row) : null;
}

export async function setOrderSession(env, order, sessionId, at) {
  const rec = { ...order, stripe: { ...(order.stripe || {}), sessionId } };
  await DB(env).prepare('UPDATE orders SET session_id = ?, data = ?, updated_at = ? WHERE no = ?')
    .bind(sessionId, JSON.stringify(rec), isoAt(at), order.no).run();
  return rec;
}

// pending → expired (never touches a paid order) → true when it changed
export async function markExpired(env, no, at) {
  const r = await DB(env).prepare("UPDATE orders SET payment = 'expired', updated_at = ? WHERE no = ? AND payment = 'pending'")
    .bind(isoAt(at), no).run();
  return r.meta.changes === 1;
}

// mark the order paid with its new data. When `stock` ({ catalog, rev }) is given, the catalog
// (with stock already decremented) is written in the same transaction, and only if the catalog
// is still at `rev` and the order is still unpaid — so stock moves exactly once per order.
// → 'done' | 'already' (someone else marked it paid) | 'conflict' (catalog changed; retry)
export async function markPaid(env, order, at, stock = null) {
  const db = DB(env);
  const data = JSON.stringify({ ...order, payment: 'paid' });
  if (!stock) {
    const r = await db.prepare("UPDATE orders SET payment = 'paid', data = ?, updated_at = ? WHERE no = ? AND payment != 'paid'")
      .bind(data, isoAt(at), order.no).run();
    return r.meta.changes === 1 ? 'done' : 'already';
  }
  const stamp = randomHex(16);
  const [, paid] = await db.batch([
    db.prepare(`UPDATE catalog SET rev = rev + 1, data = ?, stamp = ?, updated_at = ?
      WHERE id = 1 AND rev = ? AND EXISTS (SELECT 1 FROM orders WHERE no = ? AND payment != 'paid')`)
      .bind(catalogJSON(stock.catalog), stamp, isoAt(at), stock.rev, order.no),
    db.prepare(`UPDATE orders SET payment = 'paid', data = ?, updated_at = ?
      WHERE no = ? AND payment != 'paid' AND (SELECT stamp FROM catalog WHERE id = 1) = ?`)
      .bind(data, isoAt(at), order.no, stamp),
  ]);
  if (paid.meta.changes === 1) return 'done';
  const now = await getOrder(env, order.no);
  return now && now.payment === 'paid' ? 'already' : 'conflict';
}

export async function listOrders(env, payment = 'paid', limit = 1000) {
  const sql = payment === 'all'
    ? 'SELECT * FROM orders ORDER BY created_at DESC, no DESC LIMIT ?'
    : 'SELECT * FROM orders WHERE payment = ? ORDER BY created_at DESC, no DESC LIMIT ?';
  const stmt = DB(env).prepare(sql);
  const { results } = await (payment === 'all' ? stmt.bind(limit) : stmt.bind(payment, limit)).all();
  return results.map(rowToOrder);
}

export async function setOrderStatus(env, no, status, at) {
  const r = await DB(env).prepare('UPDATE orders SET status = ?, updated_at = ? WHERE no = ?').bind(status, isoAt(at), no).run();
  return r.meta.changes === 1 ? getOrder(env, no) : null;
}

/* ---------- stock held by checkouts in progress ---------- */
// Units per variant in pending orders that may still be paid: their Checkout Session was created
// after `since`, or it is being created right now (no session id yet, order saved after
// `inflightSince`). With `before` (an order number), only orders saved before that one count:
// of two checkouts that reach this point at the same moment, the one saved first keeps the units.
// `mine`: the part held by `client` (a clientHash; '' = none)
const HELD_SQL = `SELECT json_extract(i.value, '$.pid') AS pid, json_extract(i.value, '$.vid') AS vid,
    SUM(json_extract(i.value, '$.qty')) AS qty,
    SUM(CASE WHEN o.client_key = ? THEN json_extract(i.value, '$.qty') ELSE 0 END) AS mine
  FROM orders AS o, json_each(CASE WHEN json_valid(o.data) THEN o.data ELSE '{}' END, '$.items') AS i
  WHERE o.payment = 'pending' AND o.created_at >= ? AND (o.session_id IS NOT NULL OR o.created_at >= ?)
    AND (? = '' OR o.rowid < (SELECT rowid FROM orders WHERE no = ?))
  GROUP BY 1, 2`;

export const heldKey = (pid, vid) => `${pid}\n${vid}`;
const heldMap = (rows) => new Map(rows.map((r) => [heldKey(r.pid, r.vid), { all: Number(r.qty) || 0, mine: Number(r.mine) || 0 }]));
const heldStmt = (db, { since, inflightSince, before = '', client = '' }) => db.prepare(HELD_SQL)
  .bind(client || null, isoAt(since), isoAt(inflightSince), before, before);

// → Map heldKey(pid, vid) → { all, mine } (units)
export async function heldStock(env, range) {
  const { results } = await heldStmt(DB(env), range).all();
  return heldMap(results);
}

// the catalog and the held units read together, in one transaction (a payment in between cannot
// make the stock look larger than it is) → { catalog, rev, held }
export async function stockAndHeld(env, range) {
  const db = DB(env);
  const [cat, held] = await db.batch([db.prepare(CATALOG_SQL), heldStmt(db, range)]);
  return { ...catalogFromRow(cat.results[0] || null), held: heldMap(held.results) };
}

// pending orders with a Checkout Session created after `since` (sessions that may still be paid),
// newest first; `after` (an order of the previous page) continues from there
export async function openPendingOrders(env, since, { after = null, limit = 100 } = {}) {
  const db = DB(env);
  const stmt = after
    ? db.prepare(`SELECT * FROM orders WHERE payment = 'pending' AND session_id IS NOT NULL AND created_at >= ?
        AND (created_at < ? OR (created_at = ? AND no < ?)) ORDER BY created_at DESC, no DESC LIMIT ?`)
      .bind(isoAt(since), after.at, after.at, after.no, limit)
    : db.prepare(`SELECT * FROM orders WHERE payment = 'pending' AND session_id IS NOT NULL AND created_at >= ?
        ORDER BY created_at DESC, no DESC LIMIT ?`).bind(isoAt(since), limit);
  const { results } = await stmt.all();
  return results.map(rowToOrder);
}

/* ---------- the same order placed twice ---------- */
// pending or paid orders with this dup_key (sameOrderKey) saved after `since`, newest first
export async function sameOrders(env, dupKey, since, limit = 10) {
  const { results } = await DB(env).prepare(`SELECT * FROM orders WHERE dup_key = ? AND created_at >= ? AND payment IN ('pending', 'paid')
    ORDER BY created_at DESC, no DESC LIMIT ?`).bind(dupKey, isoAt(since), limit).all();
  return results.map(rowToOrder);
}

// pending orders other than `no` with this dup_key whose Checkout Session is created, saved after
// `since`, newest first; newer: true when saved after `no`
export async function samePendingOrders(env, dupKey, since, no, limit = 10) {
  const { results } = await DB(env).prepare(`SELECT *, rowid > (SELECT rowid FROM orders WHERE no = ?) AS newer FROM orders
    WHERE dup_key = ? AND created_at >= ? AND payment = 'pending' AND session_id IS NOT NULL AND no != ?
    ORDER BY rowid DESC LIMIT ?`).bind(no, dupKey, isoAt(since), no, limit).all();
  return results.map((r) => ({ ...rowToOrder(r), newer: Number(r.newer) === 1 }));
}

// the client of orders saved before `before` is no longer needed (cron) → how many were cleared
export async function clearClientKeys(env, before) {
  const r = await DB(env).prepare('UPDATE orders SET client_key = NULL WHERE client_key IS NOT NULL AND created_at < ?')
    .bind(isoAt(before)).run();
  return r.meta.changes;
}

// pending orders whose Checkout Session should have finished by now (for the cron sweep).
// Orders never checked come first, then the ones checked longest ago: an order Stripe keeps
// failing on moves to the back instead of taking a slot in every run.
export async function stalePendingOrders(env, before, limit = 20) {
  const { results } = await DB(env).prepare(`SELECT * FROM orders WHERE payment = 'pending' AND session_id IS NOT NULL AND created_at < ?
    ORDER BY checked_at IS NOT NULL, checked_at, created_at LIMIT ?`).bind(isoAt(before), limit).all();
  return results.map(rowToOrder);
}

// the sweep asked Stripe about this order (whatever the answer was)
export async function markChecked(env, no, at) {
  await DB(env).prepare('UPDATE orders SET checked_at = ? WHERE no = ?').bind(isoAt(at), no).run();
}

// pending orders that never got a Checkout Session → expired; → how many
export async function expireOrphans(env, before, at) {
  const r = await DB(env).prepare("UPDATE orders SET payment = 'expired', updated_at = ? WHERE payment = 'pending' AND session_id IS NULL AND created_at < ?")
    .bind(isoAt(at), isoAt(before)).run();
  return r.meta.changes;
}

/* ---------- admin login attempts (per client address) ---------- */
// one fixed window per key: (count, window_start). The upsert starts a new window once the old
// one is over, and returns the count including this hit — in one statement, so requests sent
// at the same time cannot all see the old count.
const windowUpsert = (table, keyCol) => `INSERT INTO ${table} (${keyCol}, count, window_start) VALUES (?, 1, ?)
  ON CONFLICT (${keyCol}) DO UPDATE SET
    count = CASE WHEN ${table}.window_start < ? THEN 1 ELSE ${table}.count + 1 END,
    window_start = CASE WHEN ${table}.window_start < ? THEN excluded.window_start ELSE ${table}.window_start END
  RETURNING count`;

// count a password attempt (before the password is checked) → attempts in the current window
export async function recordAttempt(env, ip, ms, windowMs) {
  const row = await DB(env).prepare(windowUpsert('admin_failures', 'ip')).bind(ip, ms, ms - windowMs, ms - windowMs).first();
  return Number(row.count);
}

export async function clearFailures(env, ip) {
  await DB(env).prepare('DELETE FROM admin_failures WHERE ip = ?').bind(ip).run();
}

/* ---------- request limits (per client address) ---------- */
// count one request for `key` → requests in the current window, this one included
export async function hitLimit(env, key, ms, windowMs) {
  const row = await DB(env).prepare(windowUpsert('rate_limits', 'key')).bind(key, ms, ms - windowMs, ms - windowMs).first();
  return Number(row.count);
}

// rows whose window ended long ago (cron) → how many were deleted
export async function pruneLimits(env, before) {
  const db = DB(env);
  const [a, b] = await db.batch([
    db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(before),
    db.prepare('DELETE FROM admin_failures WHERE window_start < ?').bind(before),
  ]);
  return a.meta.changes + b.meta.changes;
}
