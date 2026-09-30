/* =========================================================
   満月米 — store.js
   商品カタログ・ショップ設定・カート・注文のデータ層。
   ショップ（index.html / shop.html）と管理画面（admin/）で共有する。

   デモ版では保存先はこのブラウザの localStorage。
   本番運用ではこのファイルの load/save をサーバー API に置き換える。
   ========================================================= */
(() => {
  'use strict';

  const KEYS = {
    catalog: 'mangetsu.catalog.v1',
    cart: 'mangetsu.cart.v1',
    orders: 'mangetsu.orders.v1',
  };

  const RICE_STORE = '高温多湿・直射日光を避け、涼しい場所で保存してください';
  const PRODUCER = '満月農園（北海道士別市上士別町）';
  const G = {
    bowl: { src: 'assets/img/bowl.webp', alt: '茶碗に盛った炊きたての満月米', fit: 'contain' },
    hand: { src: 'assets/img/rice-hand-sm.webp', alt: '手のひらにすくった満月米の精米', fit: 'cover' },
    grains: { src: 'assets/img/photo/grains.webp', alt: '枡からこぼれる精米（イメージ）', fit: 'cover' },
    onigiri: { src: 'assets/img/photo/onigiri.webp', alt: 'おにぎり（イメージ）', fit: 'cover' },
    teishoku: { src: 'assets/img/photo/teishoku.webp', alt: '和食の食卓（イメージ）', fit: 'cover' },
    gohan: { src: 'assets/img/photo/gohan.webp', alt: '土鍋で炊いたごはん（イメージ）', fit: 'cover' },
    ears: { src: 'assets/img/photo/ears-moon.webp', alt: '月あかりに実る稲穂（イメージ）', fit: 'cover' },
  };
  const RICE_GALLERY = [G.bowl, G.grains, G.onigiri, G.hand];

  const DEFAULT_CATALOG = {
    version: 1,
    settings: {
      shipFee: 990,
      freeShipOver: 9000,
      giftFee: 220,
      codFee: 330,
      maxQty: 20,
      news: { show: true, text: '令和8年産 新米のご予約受付中', link: 'shinmai-r8' },
    },
    categories: [
      { id: 'rice', name: 'お米' },
      { id: 'shinmai', name: '新米予約' },
      { id: 'teiki', name: '定期便' },
    ],
    products: [
      {
        id: 'mangetsu-5kg',
        name: '満月米 ななつぼし 5kg',
        category: 'rice',
        status: 'published',
        featured: true,
        meta: '令和7年産・精米',
        badge: { text: '定番', line: true },
        card: 'まずはこちらから。毎日のごはんに、ちょうどいい量です。',
        when: '3〜5営業日で発送',
        lead: '北海道士別市上士別町の山奥で、天塩川最上流の水と大きな寒暖差のなかで育ったななつぼしです。冷めてもおいしく、お弁当やおにぎりにも向いています。',
        ship: 'ご注文から3〜5営業日で発送します',
        visual: { kind: 'bag', style: 'single', label: '5kg' },
        gallery: RICE_GALLERY,
        variants: [{ id: '5kg', label: '5kg', price: 4980, stock: null }],
        options: { gift: true, award: true, preorder: false, subscription: false, traits: true },
        specs: [
          ['名称', '精米'], ['原料玄米', '北海道産 ななつぼし 令和7年産'], ['内容量', '5kg'], ['精米年月日', '袋に記載'],
          ['賞味期限', '精米日より1ヵ月（目安）'], ['保存方法', RICE_STORE], ['配送方法', '常温便'], ['生産者', PRODUCER],
        ],
      },
      {
        id: 'mangetsu-10kg',
        name: '満月米 ななつぼし 10kg（5kg×2袋）',
        category: 'rice',
        status: 'published',
        featured: true,
        meta: '令和7年産・精米',
        badge: { text: '2袋セット', line: true },
        card: '5kgの袋が2つ。1袋ずつ開けられるので、最後までおいしく。',
        when: '3〜5営業日で発送',
        lead: '5kgの袋を2つお届けします。1袋ずつ開けられるので、たくさん召し上がるご家庭でも、最後までおいしさが続きます。',
        ship: 'ご注文から3〜5営業日で発送します',
        visual: { kind: 'bag', style: 'double', label: '5kg' },
        gallery: [G.bowl, G.teishoku, G.onigiri, G.hand],
        variants: [{ id: '10kg', label: '10kg（5kg×2袋）', price: 9680, stock: null }],
        options: { gift: true, award: true, preorder: false, subscription: false, traits: true },
        specs: [
          ['名称', '精米'], ['原料玄米', '北海道産 ななつぼし 令和7年産'], ['内容量', '10kg（5kg×2袋）'], ['精米年月日', '袋に記載'],
          ['賞味期限', '精米日より1ヵ月（目安）'], ['保存方法', RICE_STORE], ['配送方法', '常温便'], ['生産者', PRODUCER],
        ],
      },
      {
        id: 'shinmai-r8',
        name: '満月米 新米 令和8年産',
        category: 'shinmai',
        status: 'published',
        featured: true,
        meta: '精米・予約商品',
        badge: { text: '予約受付中', line: false },
        card: 'この秋に実った新米を、12月上旬より順次お届けします。',
        when: '12月上旬より順次発送',
        lead: 'この秋に実った、令和8年産の新米です。2026年12月上旬より順次お届けします。',
        ship: '2026年12月上旬より順次発送の予定です',
        visual: { kind: 'bag', style: 'seal', label: '5kg' },
        gallery: [G.ears, G.gohan, G.bowl, G.grains],
        variants: [
          { id: '5kg', label: '5kg', price: 5280, stock: null },
          { id: '10kg', label: '10kg（5kg×2袋）', price: 10280, stock: null },
        ],
        options: { gift: true, award: false, preorder: true, subscription: false, traits: true },
        specs: [
          ['名称', '精米'], ['原料玄米', '北海道産 ななつぼし 令和8年産'], ['内容量', '5kg／10kg（5kg×2袋）'], ['精米年月日', '袋に記載'],
          ['賞味期限', '精米日より1ヵ月（目安）'], ['保存方法', RICE_STORE], ['配送方法', '常温便'], ['生産者', PRODUCER],
          ['発送時期', '2026年12月上旬より順次発送の予定です'],
        ],
      },
      {
        id: 'teiki',
        name: '満月米 定期便',
        category: 'teiki',
        status: 'published',
        featured: true,
        meta: '精米・毎月／隔月',
        badge: { text: '5%お得', line: true },
        card: 'お米を切らさない暮らしに。通常価格より5%お得です。',
        when: '毎月・隔月でお届け',
        lead: 'お届けの周期と量を選べる定期便です。お米を切らさないよう、通常価格より5%お得に満月米をお届けします。',
        ship: '初回はご注文から3〜5営業日で発送します',
        visual: { kind: 'bag', style: 'phases', label: '5kg' },
        gallery: [G.teishoku, G.bowl, G.onigiri, G.grains],
        variants: [
          { id: 'm5', label: '毎月 5kg', price: 4731, stock: null },
          { id: 'b5', label: '隔月 5kg', price: 4731, stock: null },
          { id: 'm10', label: '毎月 10kg', price: 9196, stock: null },
        ],
        options: { gift: false, award: false, preorder: false, subscription: true, traits: true },
        specs: [
          ['名称', '精米'], ['原料玄米', '北海道産 ななつぼし 令和7年産（2026年12月上旬以降のお届け分は令和8年産）'], ['内容量', '5kg／10kg（5kg×2袋）'],
          ['精米年月日', '袋に記載'], ['賞味期限', '精米日より1ヵ月（目安）'], ['保存方法', RICE_STORE], ['配送方法', '常温便'], ['生産者', PRODUCER],
          ['お届け周期', '毎月／隔月からお選びいただけます'], ['休止・解約・お約束回数', '（準備中）'],
        ],
      },
    ],
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return { ok: true }; }
    catch (e) {
      const full = e && (e.name === 'QuotaExceededError' || e.code === 22);
      return { ok: false, error: full ? '保存容量がいっぱいです。画像の数や大きさを減らしてから、もう一度保存してください。' : 'このブラウザでは保存できませんでした（プライベートモードなど）。' };
    }
  };

  /* ---------- normalisation (keeps old or hand-edited data safe) ---------- */
  const int = (v, d = 0) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : d; };
  const str = (v, d = '') => (typeof v === 'string' ? v : d);
  // ids are used in URLs and HTML attributes, so only a safe alphabet is accepted
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const idOr = (v, d) => (typeof v === 'string' && ID_RE.test(v) ? v : d);
  function normProduct(p, i) {
    const vSeen = new Set();
    const variants = (Array.isArray(p.variants) ? p.variants : []).filter((v) => v && typeof v === 'object').map((v, j) => ({
      id: (() => { let id = idOr(v.id, `v${j + 1}`); while (vSeen.has(id)) id = `v${j + 1}-${vSeen.size}`; vSeen.add(id); return id; })(),
      label: str(v && v.label) || '通常',
      price: Math.max(0, int(v && v.price)),
      stock: v && v.stock !== null && v.stock !== '' && v.stock !== undefined ? Math.max(0, int(v.stock)) : null,
    }));
    return {
      id: idOr(p.id, `p${i + 1}`),
      name: str(p.name) || '名称未設定の商品',
      category: idOr(p.category, ''),
      status: ['published', 'draft', 'soldout'].includes(p.status) ? p.status : 'draft',
      featured: !!p.featured,
      meta: str(p.meta),
      badge: { text: str(p.badge && p.badge.text), line: p.badge ? p.badge.line !== false : true },
      card: str(p.card),
      when: str(p.when),
      lead: str(p.lead),
      ship: str(p.ship),
      visual: p.visual && p.visual.kind === 'image' && str(p.visual.src)
        ? { kind: 'image', src: p.visual.src, fit: p.visual.fit === 'contain' ? 'contain' : 'cover' }
        : { kind: 'bag', style: ['single', 'double', 'seal', 'phases'].includes(p.visual && p.visual.style) ? p.visual.style : 'single', label: str(p.visual && p.visual.label, '5kg') },
      gallery: (Array.isArray(p.gallery) ? p.gallery : []).filter((g) => g && str(g.src)).map((g) => ({ src: g.src, alt: str(g.alt), fit: g.fit === 'contain' ? 'contain' : 'cover' })),
      variants: variants.length ? variants : [{ id: 'v1', label: '通常', price: 0, stock: null }],
      options: {
        gift: !!(p.options && p.options.gift),
        award: !!(p.options && p.options.award),
        preorder: !!(p.options && p.options.preorder),
        subscription: !!(p.options && p.options.subscription),
        traits: !!(p.options && p.options.traits),
      },
      specs: (Array.isArray(p.specs) ? p.specs : []).filter((r) => Array.isArray(r) && (r[0] || r[1])).map((r) => [str(r[0]), str(r[1])]),
    };
  }
  function normalize(c) {
    if (!c || !Array.isArray(c.products) || !Array.isArray(c.categories)) return clone(DEFAULT_CATALOG);
    const d = DEFAULT_CATALOG.settings;
    const s = c.settings || {};
    const news = s.news || {};
    const cSeen = new Set(), pSeen = new Set();
    return {
      version: 1,
      settings: {
        shipFee: Math.max(0, int(s.shipFee, d.shipFee)),
        freeShipOver: Math.max(0, int(s.freeShipOver, d.freeShipOver)),
        giftFee: Math.max(0, int(s.giftFee, d.giftFee)),
        codFee: Math.max(0, int(s.codFee, d.codFee)),
        maxQty: Math.min(99, Math.max(1, int(s.maxQty, d.maxQty))),
        news: { show: news.show !== false, text: str(news.text, d.news.text), link: str(news.link) },
      },
      categories: c.categories.filter((k) => k && ID_RE.test(str(k.id)) && !cSeen.has(k.id) && cSeen.add(k.id)).map((k) => ({ id: k.id, name: str(k.name) || k.id })),
      products: c.products.filter((p) => p && typeof p === 'object').map(normProduct).map((p) => { let id = p.id, n = 2; while (pSeen.has(id)) id = `${p.id.slice(0, 36)}-${n++}`; pSeen.add(id); return { ...p, id }; }),
    };
  }

  /* ---------- catalog ---------- */
  let cache = null;
  function catalog() {
    if (!cache) cache = normalize(read(KEYS.catalog) || clone(DEFAULT_CATALOG));
    return cache;
  }
  function saveCatalog(next) {
    const n = normalize(next);
    const r = write(KEYS.catalog, n);
    if (r.ok) cache = n;
    return r;
  }
  function resetCatalog() {
    try { localStorage.removeItem(KEYS.catalog); } catch { /* ignore */ }
    cache = null;
    return catalog();
  }
  const isCustomized = () => { try { return localStorage.getItem(KEYS.catalog) !== null; } catch { return false; } };

  /* ---------- product helpers ---------- */
  const product = (id) => catalog().products.find((p) => p.id === id);
  const category = (id) => catalog().categories.find((c) => c.id === id);
  const isVisible = (p) => !!p && p.status !== 'draft';
  const visibleProducts = () => catalog().products.filter(isVisible);
  const variantSoldOut = (p, v) => p.status === 'soldout' || (v.stock !== null && v.stock <= 0);
  const productSoldOut = (p) => p.variants.every((v) => variantSoldOut(p, v));
  const minPrice = (p) => {
    const avail = p.variants.filter((v) => !variantSoldOut(p, v));
    return Math.min(...(avail.length ? avail : p.variants).map((v) => v.price));
  };
  // how many of this variant can be in one order
  const maxFor = (p, v) => Math.min(catalog().settings.maxQty, v.stock === null ? Infinity : v.stock);

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

  /* ---------- orders (demo) ---------- */
  const orders = () => { const o = read(KEYS.orders); return Array.isArray(o) ? o.filter((x) => x && typeof x === 'object' && typeof x.no === 'string') : []; };
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

  // reduce managed stock after an order
  function consumeStock(lines) {
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
      if (e.key === KEYS.catalog || e.key === null) cache = null;
      if (e.key === null || Object.values(KEYS).includes(e.key)) fn(e.key);
    });
  }

  window.MangetsuStore = {
    KEYS, DEFAULT_CATALOG, clone, ID_RE,
    catalog, saveCatalog, resetCatalog, isCustomized, normalize,
    product, category, isVisible, visibleProducts, variantSoldOut, productSoldOut, minPrice, maxFor,
    loadCart, saveCart,
    orders, addOrder, updateOrder, clearOrders, consumeStock,
    onChange,
    invalidate: () => { cache = null; },
  };
})();
