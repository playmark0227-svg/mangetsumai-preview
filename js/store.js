/* =========================================================
   満月米 — store.js
   商品カタログ・ショップ設定・カート・注文のデータ層。
   ショップ（index.html / shop.html）と管理画面（admin/）で共有する。
   商品データの中身・検証・送料計算は core.js（サーバーと共通）。

   2つのモードがある（js/config.js の apiBase で切り替え）：
   - デモ：apiBase が空。商品・注文はこのブラウザの localStorage に保存し、決済はしない。
   - 本番：apiBase に API（server/）の URL。商品は API から読み、注文と決済は Stripe へ。
     このモードでは catalog はメモリ上だけで持ち、localStorage には書かない。
   ========================================================= */
(() => {
  'use strict';

  const C = window.MangetsuCore;
  const API = window.MangetsuAPI || { enabled: false };
  const LIVE = !!API.enabled;

  const KEYS = {
    // v6: 2026-10-12 送料表（地域×重さ）と商品の重さ
    catalog: 'mangetsu.catalog.v6',
    cart: 'mangetsu.cart.v1',
    orders: 'mangetsu.orders.v2',
  };
  // clean up data from earlier demo versions (old catalog, test orders paid by 代金引換)
  try { ['mangetsu.catalog.v1', 'mangetsu.catalog.v2', 'mangetsu.catalog.v3', 'mangetsu.catalog.v4', 'mangetsu.catalog.v5', 'mangetsu.orders.v1'].forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }

  const { DEFAULT_CATALOG, DEFAULT_EVENT, ID_RE, clone, normalize } = C;

  const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return { ok: true }; }
    catch (e) {
      const full = e && (e.name === 'QuotaExceededError' || e.code === 22);
      return { ok: false, error: full ? '保存容量がいっぱいです。画像の数や大きさを減らしてから、もう一度保存してください。' : 'このブラウザでは保存できませんでした（プライベートモードなど）。' };
    }
  };
  const int = (v, d = 0) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : d; };

  /* ---------- catalog ---------- */
  let cache = null;
  let rev = null; // live mode: the server's revision of the catalog (for conflict checks)
  function catalog() {
    if (!cache) cache = normalize(LIVE ? clone(DEFAULT_CATALOG) : read(KEYS.catalog) || clone(DEFAULT_CATALOG));
    return cache;
  }
  // demo: save to this browser. live: the admin screen saves through MangetsuAPI and
  // then hands the server's copy to setCatalog(), so this only refuses.
  function saveCatalog(next) {
    if (LIVE) return { ok: false, error: '本番モードでは、管理画面からサーバーに保存してください。' };
    const n = normalize(next);
    const r = write(KEYS.catalog, n);
    if (r.ok) cache = n;
    return r;
  }
  // replace the in-memory catalog (live mode: data that came from the API)
  function setCatalog(next, nextRev = rev) {
    cache = normalize(next);
    rev = nextRev;
    return cache;
  }
  function resetCatalog() {
    try { localStorage.removeItem(KEYS.catalog); } catch { /* ignore */ }
    cache = null;
    return catalog();
  }
  const isCustomized = () => { try { return localStorage.getItem(KEYS.catalog) !== null; } catch { return false; } };

  // resolves when the catalog can be used. demo: at once. live: after the public catalog
  // has been fetched (on failure the built-in data is used and `error` is set)
  let readyPromise = null;
  function ready() {
    if (readyPromise) return readyPromise;
    if (!LIVE) { readyPromise = Promise.resolve({ live: false }); return readyPromise; }
    readyPromise = API.getCatalog()
      .then((d) => { setCatalog(d.catalog, d.rev); return { live: true }; })
      .catch((error) => { catalog(); return { live: true, error }; });
    return readyPromise;
  }

  /* ---------- product helpers ---------- */
  const product = (id) => catalog().products.find((p) => p.id === id);
  const category = (id) => catalog().categories.find((c) => c.id === id);
  const { isVisible, variantSoldOut, productSoldOut, minPrice } = C;
  const visibleProducts = () => catalog().products.filter(isVisible);
  // how many of this variant can be in one order
  const maxFor = (p, v) => C.maxFor(catalog().settings, p, v);

  /* ---------- shipping ---------- */
  // lines: [{ pid, vid, qty }] (cart lines) → C.shippingQuote result
  const weightLines = (lines) => lines.map((l) => {
    const p = product(l.pid);
    const v = p && p.variants.find((x) => x.id === l.vid);
    return { weight: v ? v.weight : 0, qty: v ? l.qty : 0 };
  });
  const shippingFor = (lines, pref, sub) => C.shippingQuote({ lines: weightLines(lines), pref, sub, ship: catalog().settings.ship });

  /* ---------- event page (期間限定) ---------- */
  // dates follow Japan time, the same as the server
  const today = () => C.japanToday();
  const eventActive = (e = catalog().settings.event) => C.eventActive(e, today());
  // visitors who arrive through the event page: their next orders are tagged for 3 days
  const SRC_KEY = 'mangetsu.source.v1';
  const markEventVisit = (slug) => write(SRC_KEY, { src: slug, at: Date.now() });
  const eventSource = () => {
    const v = read(SRC_KEY);
    return v && typeof v.src === 'string' && ID_RE.test(v.src) && Date.now() - v.at < 3 * 86400000 ? v.src : '';
  };

  /* ---------- cart ---------- */
  function loadCart() {
    const raw = read(KEYS.cart);
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const l of raw) {
      const p = l && product(l.pid);
      if (!isVisible(p)) continue;
      const v = p.variants.find((x) => x.id === l.vid);
      if (!v || variantSoldOut(p, v)) continue;
      const gift = p.options.gift && typeof l.gift === 'string' ? l.gift : 'none';
      const qty = Math.min(maxFor(p, v), Math.max(1, int(l.qty, 1)));
      const dup = out.find((x) => x.pid === l.pid && x.vid === l.vid && x.gift === gift);
      if (dup) dup.qty = Math.min(maxFor(p, v), dup.qty + qty);
      else out.push({ pid: l.pid, vid: l.vid, gift, qty });
    }
    return out;
  }
  const saveCart = (lines) => write(KEYS.cart, lines);

  /* ---------- orders (demo only; live orders live on the server) ---------- */
  const orders = () => { if (LIVE) return []; const o = read(KEYS.orders); return Array.isArray(o) ? o.filter((x) => x && typeof x === 'object' && typeof x.no === 'string') : []; };
  function addOrder(order) {
    const list = orders();
    list.unshift(order);
    return write(KEYS.orders, list.slice(0, 200));
  }
  function updateOrder(no, patch) {
    const list = orders().map((o) => (o.no === no ? { ...o, ...patch } : o));
    return write(KEYS.orders, list);
  }
  const clearOrders = () => write(KEYS.orders, []);

  // reduce managed stock after an order (demo; the server does this in live mode)
  function consumeStock(lines) {
    if (LIVE) return { ok: true };
    const c = clone(catalog());
    let changed = false;
    for (const l of lines) {
      const p = c.products.find((x) => x.id === l.pid);
      const v = p && p.variants.find((x) => x.id === l.vid);
      if (v && v.stock !== null) { v.stock = Math.max(0, v.stock - l.qty); changed = true; }
    }
    return changed ? saveCatalog(c) : { ok: true };
  }

  /* ---------- cross-tab updates ---------- */
  function onChange(fn) {
    window.addEventListener('storage', (e) => {
      if (!LIVE && (e.key === KEYS.catalog || e.key === null)) cache = null;
      if (e.key === null || Object.values(KEYS).includes(e.key)) fn(e.key);
    });
  }

  window.MangetsuStore = {
    LIVE, KEYS, DEFAULT_CATALOG, DEFAULT_EVENT, clone, ID_RE,
    today, eventActive, markEventVisit, eventSource,
    ready, catalog, saveCatalog, setCatalog, rev: () => rev, resetCatalog, isCustomized, normalize,
    product, category, isVisible, visibleProducts, variantSoldOut, productSoldOut, minPrice, maxFor,
    shippingFor,
    loadCart, saveCart,
    orders, addOrder, updateOrder, clearOrders, consumeStock,
    onChange,
    invalidate: () => { if (!LIVE) cache = null; },
  };
})();
