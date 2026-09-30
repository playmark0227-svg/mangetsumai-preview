/* =========================================================
   満月米 オンラインショップ — app.js
   静的なトップページ + ハッシュルーティングによる
   商品詳細 / カート / ご購入手続き / ご利用ガイド
   ========================================================= */
(() => {
  'use strict';

  /* ---------- settings (仮の値) ---------- */
  const SHIP_FEE = 990;
  const FREE_SHIP_OVER = 9000;
  const GIFT_FEE = 220;
  const COD_FEE = 330;
  const MAX_QTY = 20;
  const STORAGE_KEY = 'mangetsu.cart.v1';

  const GIFT_OPTIONS = [
    { id: 'none', label: 'なし', fee: 0 },
    { id: 'wrap', label: 'ギフト包装のみ', fee: GIFT_FEE },
    { id: 'oseibo', label: 'ギフト包装＋のし「御歳暮」', fee: GIFT_FEE },
    { id: 'orei', label: 'ギフト包装＋のし「御礼」', fee: GIFT_FEE },
    { id: 'uchiiwai', label: 'ギフト包装＋のし「内祝」', fee: GIFT_FEE },
    { id: 'muji', label: 'ギフト包装＋のし「無地」', fee: GIFT_FEE },
  ];

  const BASE_SPEC = [
    ['名称', '精米'],
    ['原料玄米', '北海道産 ななつぼし {year}'],
    ['内容量', '{weight}'],
    ['精米年月日', '袋に記載'],
    ['賞味期限', '精米日より1ヵ月（目安）'],
    ['保存方法', '高温多湿・直射日光を避け、涼しい場所で保存してください'],
    ['配送方法', '常温便'],
    ['生産者', '満月農園（北海道士別市上士別町）'],
  ];

  const PRODUCTS = [
    {
      id: 'mangetsu-5kg',
      name: '満月米 ななつぼし 5kg',
      meta: '令和7年産・精米',
      badge: { text: '定番', line: true },
      card: 'まずはこちらから。毎日のごはんに、ちょうどいい量です。',
      when: '3〜5営業日で発送',
      lead: '北海道士別市上士別町の山奥で、天塩川最上流の水と大きな寒暖差のなかで育ったななつぼしです。冷めてもおいしく、お弁当やおにぎりにも向いています。',
      art: { type: 'single' },
      year: '令和7年産',
      award: true,
      variants: [{ id: '5kg', label: '5kg', weight: '5kg', price: 4980 }],
      gift: true,
      ship: 'ご注文から3〜5営業日で発送します',
    },
    {
      id: 'mangetsu-10kg',
      name: '満月米 ななつぼし 10kg（5kg×2袋）',
      meta: '令和7年産・精米',
      badge: { text: '2袋セット', line: true },
      card: '5kgの袋が2つ。1袋ずつ開けられるので、最後までおいしく。',
      when: '3〜5営業日で発送',
      lead: '5kgの袋を2つお届けします。1袋ずつ開けられるので、たくさん召し上がるご家庭でも、最後までおいしさが続きます。',
      art: { type: 'double' },
      year: '令和7年産',
      award: true,
      variants: [{ id: '10kg', label: '10kg（5kg×2袋）', weight: '10kg（5kg×2袋）', price: 9680 }],
      gift: true,
      ship: 'ご注文から3〜5営業日で発送します',
    },
    {
      id: 'shinmai-r8',
      name: '満月米 新米 令和8年産',
      meta: '精米・予約商品',
      badge: { text: '予約受付中', line: false },
      card: 'この秋に実った新米を、12月上旬より順次お届けします。',
      when: '12月上旬より順次発送',
      lead: 'この秋に実った、令和8年産の新米です。2026年12月上旬より順次お届けします。',
      art: { type: 'single', seal: true },
      year: '令和8年産',
      variants: [
        { id: '5kg', label: '5kg', weight: '5kg', price: 5280 },
        { id: '10kg', label: '10kg（5kg×2袋）', weight: '10kg（5kg×2袋）', price: 10280 },
      ],
      gift: true,
      ship: '2026年12月上旬より順次発送の予定です',
      preorder: true,
    },
    {
      id: 'teiki',
      name: '満月米 定期便',
      meta: '精米・毎月／隔月',
      badge: { text: '5%お得', line: true },
      card: 'お米を切らさない暮らしに。通常価格より5%お得です。',
      when: '毎月・隔月でお届け',
      lead: 'お届けの周期と量を選べる定期便です。お米を切らさないよう、通常価格より5%お得に満月米をお届けします。',
      art: { type: 'single', phases: true },
      year: '令和7年産（2026年12月上旬以降のお届け分は令和8年産）',
      variants: [
        { id: 'm5', label: '毎月 5kg', weight: '5kg', price: 4731 },
        { id: 'b5', label: '隔月 5kg', weight: '5kg', price: 4731 },
        { id: 'm10', label: '毎月 10kg', weight: '10kg（5kg×2袋）', price: 9196 },
      ],
      gift: false,
      ship: '初回はご注文から3〜5営業日で発送します',
      subscription: true,
    },
  ];

  const byId = (id) => PRODUCTS.find((p) => p.id === id);

  /* ---------- helpers ---------- */
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = (n) => n.toLocaleString('ja-JP');
  const priceHTML = (n, { tax = true, from = false, per = '' } = {}) =>
    `<span class="price"><span class="price__yen">¥</span>${yen(n)}${from ? '<span class="price__from">〜</span>' : ''}${tax ? '<span class="price__tax">税込</span>' : ''}${per ? `<span class="price__tax">／${per}</span>` : ''}</span>`;
  const minPrice = (p) => Math.min(...p.variants.map((v) => v.price));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // keep a few words that phrase-breaking tends to split on one line
  const NOBR = /(ななつぼし|おにぎり|召し上がる|2026年12月上旬)/g;
  const jp = (s) => esc(s).replace(NOBR, '<span class="nw">$1</span>');
  const smooth = () => (reduceMotion ? 'auto' : 'smooth');

  const ICON_BAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 8.5h11l-1 11.2a1.5 1.5 0 0 1-1.5 1.3H9a1.5 1.5 0 0 1-1.5-1.3z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9.3 8.5V7a2.7 2.7 0 0 1 5.4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

  /* moon phase glyph for the steps bar: 1 crescent … 4 full */
  const phaseSVG = (n) => {
    const lit = ['', 'M8 1.5A6.5 6.5 0 0 1 8 14.5A4.2 6.5 0 0 0 8 1.5Z', 'M8 1.5A6.5 6.5 0 0 1 8 14.5Z', 'M8 1.5A6.5 6.5 0 0 1 8 14.5A4.2 6.5 0 0 1 8 1.5Z', ''][n];
    return `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" class="${n === 4 ? 'full' : ''}"/>${lit ? `<path class="lit" d="${lit}"/>` : ''}</svg>`;
  };

  /* ---------- rice-bag illustration ---------- */
  let uid = 0;
  function bagSVG(art = {}, { title = '' } = {}) {
    const u = 'm' + ++uid;
    const zig = (() => {
      let d = 'M18 50 L18 17';
      const n = 20, w = (182 - 18) / n;
      for (let i = 0; i < n; i++) d += ` L${(18 + w * i + w / 2).toFixed(1)} 11.5 L${(18 + w * (i + 1)).toFixed(1)} 17`;
      return d + ' L182 50 Z';
    })();
    const body = 'M20 44 C18 120 13 214 9 282 C8.5 292 14 297 24 297 L176 297 C186 297 191.5 292 191 282 C187 214 182 120 180 44 Z';
    const tick = (x, y, dx, dy) => `<path d="M${x} ${y + dy * 7} V${y} H${x + dx * 7}" fill="none" stroke="#d0ad6d" stroke-width=".8"/>`;
    const label = (weight) => `
      <rect x="50" y="78" width="100" height="170" fill="#232b36"/>
      <rect x="55" y="83" width="90" height="160" fill="none" stroke="#d0ad6d" stroke-width=".5" stroke-opacity=".7"/>
      ${tick(59, 87, 1, 1)}${tick(141, 87, -1, 1)}${tick(59, 239, 1, -1)}${tick(141, 239, -1, -1)}
      <circle cx="100" cy="112" r="19" fill="#f1d17d" opacity=".16"/>
      <image href="assets/img/moon-sm.webp" x="84" y="96" width="32" height="32"/>
      <circle cx="74" cy="100" r=".9" fill="#e5c38c"/><circle cx="127" cy="96" r=".8" fill="#e5c38c"/><circle cx="131" cy="128" r=".7" fill="#e5c38c"/>
      <g font-family="Shippori Mincho B1, serif" font-weight="600" fill="#e5c38c" text-anchor="middle" font-size="25">
        <text x="100" y="159">満</text><text x="100" y="188">月</text><text x="100" y="217">米</text>
      </g>
      <g font-family="Zen Maru Gothic, sans-serif" font-size="7" fill="#b8af9e" letter-spacing="1.2">
        <text x="68" y="140" style="writing-mode:vertical-rl">北海道士別市産</text>
        <text x="132" y="140" style="writing-mode:vertical-rl">ななつぼし</text>
      </g>
      <path d="M66 226 H134" stroke="#d0ad6d" stroke-width=".6"/>
      <text x="100" y="239" text-anchor="middle" font-family="Josefin Sans, sans-serif" font-size="10.5" letter-spacing="2" fill="#e5c38c">${weight}</text>`;
    const bag = (weight, extra = '') => `
      <path d="${body}" fill="url(#${u}k)"/>
      <path d="${body}" fill="url(#${u}sd)"/>
      <path d="M40 64 C44 130 40 210 33 284" stroke="#fff" stroke-opacity=".10" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M163 66 C165 140 168 214 172 284" stroke="#4a3216" stroke-opacity=".10" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M28 272 C70 280 130 281 174 272" stroke="#4a3216" stroke-opacity=".12" stroke-width="3" fill="none"/>
      <rect x="19" y="48" width="162" height="10" fill="url(#${u}cs)"/>
      <path d="${zig}" fill="url(#${u}tp)"/>
      <path d="M20 33 H180" stroke="#7d6040" stroke-width="1" stroke-dasharray="3 2.4" opacity=".75"/>
      ${label(weight)}
      ${extra}`;
    const seal = `
      <g transform="translate(160 84)">
        <circle r="27" fill="#f2eadc"/>
        <circle r="27" fill="none" stroke="#b18740" stroke-width="1.2"/>
        <circle r="22.5" fill="none" stroke="#b18740" stroke-width=".6" stroke-dasharray="2 1.6"/>
        <text y="3" text-anchor="middle" font-family="Shippori Mincho B1, serif" font-weight="700" font-size="15" fill="#262b35" letter-spacing="1">新米</text>
        <text y="14" text-anchor="middle" font-family="Zen Maru Gothic, sans-serif" font-size="6.2" fill="#6a5121" letter-spacing=".5">令和8年産</text>
      </g>`;
    /* 定期便: a month of moons (new → full) arcing over the bag */
    const phases = (() => {
      const pts = [[98, 30], [129, 19], [160, 15], [191, 19], [222, 30]];
      const r = 8.5;
      return pts.map(([cx, cy], i) => {
        const top = `${cx} ${cy - r}`, bot = `${cx} ${cy + r}`;
        const lit = [
          '',
          `M${top} A${r} ${r} 0 0 1 ${bot} A${r * 0.55} ${r} 0 0 0 ${top}Z`,
          `M${top} A${r} ${r} 0 0 1 ${bot}Z`,
          `M${top} A${r} ${r} 0 0 1 ${bot} A${r * 0.55} ${r} 0 0 1 ${top}Z`,
          '',
        ][i];
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${i === 4 ? '#f1d17d' : '#1b222b'}" stroke="#d0ad6d" stroke-width="1"/>${lit ? `<path d="${lit}" fill="#e5c38c"/>` : ''}`;
      }).join('') + '<path d="M90 42 Q160 8 230 42" fill="none" stroke="#d0ad6d" stroke-width=".6" stroke-dasharray="2 3" opacity=".7"/>';
    })();
    const defs = `
      <defs>
        <linearGradient id="${u}k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2cda7"/><stop offset=".55" stop-color="#d5bb8f"/><stop offset="1" stop-color="#c7aa7b"/></linearGradient>
        <linearGradient id="${u}sd" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3c2610" stop-opacity=".34"/><stop offset=".14" stop-color="#3c2610" stop-opacity="0"/><stop offset=".86" stop-color="#3c2610" stop-opacity="0"/><stop offset="1" stop-color="#3c2610" stop-opacity=".4"/></linearGradient>
        <linearGradient id="${u}tp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9ad82"/><stop offset="1" stop-color="#ad8f62"/></linearGradient>
        <linearGradient id="${u}cs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3c2610" stop-opacity=".3"/><stop offset="1" stop-color="#3c2610" stop-opacity="0"/></linearGradient>
        <filter id="${u}bl" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="6"/></filter>
      </defs>`;
    const shadow = (cx, rx) => `<ellipse cx="${cx}" cy="324" rx="${rx}" ry="8" fill="#05080c" opacity=".55" filter="url(#${u}bl)"/>`;

    let inner;
    if (art.type === 'double') {
      inner = `${shadow(170, 132)}
        <g transform="translate(116 12) scale(.9)">${bag('5kg')}<path d="${body}" fill="#0d121a" opacity=".22"/></g>
        <g transform="translate(24 26) scale(.95)">${bag('5kg')}</g>`;
    } else if (art.phases) {
      inner = `${shadow(160, 98)}${phases}<g transform="translate(66 40) scale(.94)">${bag('5kg')}</g>`;
    } else {
      inner = `${shadow(160, 104)}<g transform="translate(60 20)">${bag('5kg', art.seal ? seal : '')}</g>`;
    }
    const a11y = title ? `role="img" aria-label="${esc(title)}"` : 'aria-hidden="true"';
    return `<svg viewBox="0 0 320 340" ${a11y} focusable="false">${defs}${inner}</svg>`;
  }

  /* ---------- storage-safe cart ---------- */
  const store = {
    load() {
      let raw;
      try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
      if (!Array.isArray(raw)) return [];
      const out = [];
      for (const l of raw) {
        const p = l && byId(l.pid);
        if (!p || !p.variants.some((v) => v.id === l.vid)) continue;
        const gift = p.gift && GIFT_OPTIONS.some((g) => g.id === l.gift) ? l.gift : 'none';
        const qty = Math.min(MAX_QTY, Math.max(1, Math.floor(Number(l.qty)) || 1));
        const dup = out.find((x) => x.pid === l.pid && x.vid === l.vid && x.gift === gift);
        if (dup) dup.qty = Math.min(MAX_QTY, dup.qty + qty);
        else out.push({ pid: l.pid, vid: l.vid, gift, qty });
      }
      return out;
    },
    save(lines) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lines)); } catch { /* storage unavailable */ } },
  };
  let cart = store.load();
  const lineKey = (l) => `${l.pid}|${l.vid}|${l.gift || 'none'}`;
  const lineInfo = (l) => {
    const p = byId(l.pid);
    const v = p.variants.find((x) => x.id === l.vid) || p.variants[0];
    const g = GIFT_OPTIONS.find((x) => x.id === (l.gift || 'none')) || GIFT_OPTIONS[0];
    const unit = v.price + g.fee;
    return { p, v, g, unit, total: unit * l.qty };
  };
  const totals = () => {
    const sub = cart.reduce((s, l) => s + lineInfo(l).total, 0);
    const count = cart.reduce((s, l) => s + l.qty, 0);
    const ship = sub === 0 || sub >= FREE_SHIP_OVER ? 0 : SHIP_FEE;
    return { sub, count, ship, total: sub + ship };
  };
  const hasPreorder = () => cart.some((l) => byId(l.pid).preorder);
  const mixedPreorder = () => hasPreorder() && cart.some((l) => !byId(l.pid).preorder);
  const variantName = (p, v) => (p.variants.length > 1 ? `${p.name} ${v.label}` : p.name);

  function addToCart(pid, vid, qty = 1, gift = 'none') {
    const key = lineKey({ pid, vid, gift });
    const found = cart.find((l) => lineKey(l) === key);
    const before = found ? found.qty : 0;
    if (found) found.qty = Math.min(MAX_QTY, found.qty + qty);
    else cart.push({ pid, vid, gift, qty: Math.min(MAX_QTY, qty) });
    const after = cart.find((l) => lineKey(l) === key).qty;
    commit();
    const { p, v } = lineInfo({ pid, vid, gift, qty });
    const added = after - before;
    if (added === 0) {
      toast(`1回のご注文で、同じ商品は${MAX_QTY}点までです。`);
      return;
    }
    toast(added < qty
      ? `「${variantName(p, v)}」を${added}点追加しました（同じ商品は${MAX_QTY}点までです）`
      : `「${variantName(p, v)}」をカートに追加しました`, { action: 'カートを見る', onAction: openDrawer });
    const c = $('#cartCount');
    c.classList.remove('is-bump'); void c.offsetWidth; c.classList.add('is-bump');
  }
  function setQty(key, qty) {
    const l = cart.find((x) => lineKey(x) === key);
    if (!l) return;
    l.qty = Math.max(1, Math.min(MAX_QTY, qty));
    commit();
  }
  function removeLine(key) {
    const l = cart.find((x) => lineKey(x) === key);
    cart = cart.filter((x) => lineKey(x) !== key);
    commit();
    if (l) announce(`「${variantName(byId(l.pid), lineInfo(l).v)}」をカートから削除しました`);
  }
  function refreshCartViews() {
    renderCount();
    if (!$('#cartDrawer').hidden) renderDrawer();
    if (currentRoute === 'cart' || currentRoute === 'checkout-confirm') renderRoute();
    else if (currentRoute === 'checkout') { const f = $('#checkoutForm'); if (f) collect(f); renderRoute(); }
  }
  function commit() {
    const a = document.activeElement;
    const inDrawer = !!(a && a.closest && a.closest('#cartDrawer'));
    const sel = a && a.dataset && a.dataset.qty ? `[data-qty="${CSS.escape(a.dataset.qty)}"][data-delta="${a.dataset.delta}"]` : null;
    store.save(cart);
    refreshCartViews();
    // put focus back only if the focused control was re-rendered away
    if (a && a !== document.body && !a.isConnected) {
      const scope = inDrawer ? $('#cartDrawer') : view();
      const next = (sel && $(sel, scope)) || (inDrawer ? $('#cartClose') : $('[data-page-focus]', view()));
      if (next) next.focus();
    }
  }
  function renderCount() {
    const { count } = totals();
    const c = $('#cartCount');
    c.textContent = count;
    c.dataset.empty = String(count === 0);
    $('#cartOpen').setAttribute('aria-label', `カートを見る（${count}点）`);
  }

  /* ---------- live region ---------- */
  function announce(msg) {
    const sr = $('#srStatus');
    sr.textContent = '';
    requestAnimationFrame(() => { sr.textContent = msg; });
  }

  /* ---------- product card ---------- */
  function cardHTML(p) {
    const multi = p.variants.length > 1;
    return `
      <article class="p-card">
        <span class="badge${p.badge.line ? ' badge--line' : ''}">${esc(p.badge.text)}</span>
        <a class="p-card__visual" href="#item-${p.id}" tabindex="-1" aria-hidden="true">${bagSVG(p.art)}</a>
        <div class="p-card__body">
          <p class="p-card__meta">${esc(p.meta)}</p>
          <h3 class="p-card__name"><a href="#item-${p.id}">${esc(p.name)}</a></h3>
          <p class="p-card__desc">${esc(p.card)}</p>
          <p class="p-card__when">${esc(p.when)}</p>
          <div class="p-card__foot">
            ${priceHTML(minPrice(p), { from: multi, per: p.subscription ? '1回' : '' })}
            ${multi
              ? `<a class="add-btn" href="#item-${p.id}" aria-label="${esc(p.name)}の内容を選んで購入">選んで購入</a>`
              : `<button class="add-btn" type="button" data-add="${p.id}" data-variant="${p.variants[0].id}" aria-label="${esc(p.name)}をカートに入れる">${ICON_BAG}カートに入れる</button>`}
          </div>
        </div>
      </article>`;
  }
  function renderProductGrid() {
    const grid = $('#productGrid');
    if (grid) grid.innerHTML = PRODUCTS.map(cardHTML).join('');
  }

  /* ---------- modal helpers ---------- */
  const setInert = (on, els) => els.forEach((el) => { if (el) el.inert = on; });
  const behindMenu = () => [$('.skip-link'), $('main'), $('.site-footer')];
  const behindDrawer = () => [$('.skip-link'), $('main'), $('.site-footer'), $('#siteHeader'), $('#mobileNav')];

  /* ---------- drawer ---------- */
  let lastFocus = null;
  function openDrawer() {
    closeMenu();
    clearTimeout(toastTimer);
    $('#toast').hidden = true;
    lastFocus = document.activeElement;
    renderDrawer();
    $('#cartDrawer').hidden = false;
    $('#drawerBackdrop').hidden = false;
    $('#cartOpen').setAttribute('aria-expanded', 'true');
    document.body.classList.add('is-locked');
    setInert(true, behindDrawer());
    setTimeout(() => $('#cartClose').focus(), 30);
  }
  function closeDrawer() {
    if ($('#cartDrawer').hidden) return;
    $('#cartDrawer').hidden = true;
    $('#drawerBackdrop').hidden = true;
    $('#cartOpen').setAttribute('aria-expanded', 'false');
    document.body.classList.remove('is-locked');
    setInert(false, behindDrawer());
    const back = lastFocus && lastFocus.isConnected && lastFocus.getClientRects().length ? lastFocus : $('#cartOpen');
    back.focus({ preventScroll: true });
  }
  function lineHTML(l) {
    const { p, v, g, total } = lineInfo(l);
    const key = esc(lineKey(l));
    const opts = [
      p.variants.length > 1 ? v.label : '',
      g.id !== 'none' ? `${g.label}（+¥${yen(g.fee)}）` : '',
      p.preorder ? '予約・12月上旬より順次発送' : '',
    ].filter(Boolean).join(' ／ ');
    return `
      <div class="line">
        <a class="line__img" href="#item-${p.id}" tabindex="-1" aria-hidden="true">${bagSVG(p.art)}</a>
        <div class="line__info">
          <p class="line__name"><a href="#item-${p.id}">${esc(p.name)}</a></p>
          ${opts ? `<p class="line__opt">${esc(opts)}</p>` : ''}
          <div class="line__ctrl">
            <div class="qty qty--sm" role="group" aria-label="${esc(p.name)}の数量">
              <button type="button" data-qty="${key}" data-delta="-1" aria-label="1つ減らす" ${l.qty <= 1 ? 'aria-disabled="true"' : ''}>−</button>
              <output>${l.qty}</output>
              <button type="button" data-qty="${key}" data-delta="1" aria-label="1つ増やす" ${l.qty >= MAX_QTY ? 'aria-disabled="true"' : ''}>＋</button>
            </div>
            <button class="line__remove" type="button" data-remove="${key}" aria-label="${esc(p.name)}をカートから削除">削除</button>
          </div>
        </div>
        <div class="line__price">${priceHTML(total, { tax: false })}</div>
      </div>`;
  }
  function freeShipHTML(sub) {
    if (sub >= FREE_SHIP_OVER) return `<p class="free-ship">送料無料でお届けします。<span class="free-ship__bar"><i style="width:100%"></i></span></p>`;
    const rest = FREE_SHIP_OVER - sub;
    return `<p class="free-ship">送料無料まで、あと <b>¥${yen(rest)}</b> です。<span class="free-ship__bar"><i style="width:${Math.round((sub / FREE_SHIP_OVER) * 100)}%"></i></span></p>`;
  }
  function summaryHTML(t, extra = 0) {
    return `
      <dl class="summary">
        <div><dt>商品小計</dt><dd>¥${yen(t.sub)}</dd></div>
        <div><dt>送料</dt><dd>${t.ship === 0 ? '無料' : '¥' + yen(t.ship)}</dd></div>
        ${extra ? `<div><dt>代引き手数料</dt><dd>¥${yen(extra)}</dd></div>` : ''}
        <div class="summary__total"><dt>合計（税込）</dt><dd>${priceHTML(t.total + extra, { tax: false })}</dd></div>
      </dl>`;
  }
  const preorderNotice = () => (mixedPreorder()
    ? '<p class="notice"><b>お届けについて</b>予約商品（令和8年産 新米）とご一緒のご注文は、12月上旬にまとめてお届けします。先にお届けしたい商品は、別々にご注文ください。</p>'
    : '');
  const emptyHTML = (msg = 'カートに商品は入っていません。') => `
    <div class="empty">
      <span class="empty__moon" aria-hidden="true"></span>
      <p>${msg}</p>
      <a class="btn btn--line btn--sm" href="#products">商品一覧を見る</a>
    </div>`;
  function renderDrawer() {
    const t = totals();
    $('#drawerBody').innerHTML = cart.length ? preorderNotice() + cart.map(lineHTML).join('') : emptyHTML();
    $('#drawerFoot').innerHTML = cart.length
      ? `${freeShipHTML(t.sub)}${summaryHTML(t)}
         <a class="btn btn--gold btn--block" href="#checkout">ご購入手続きへ</a>
         <p class="drawer__links"><a href="#cart">カートの詳細を見る</a></p>`
      : '';
  }

  /* ---------- toast ---------- */
  let toastTimer = 0;
  function toast(msg, { action, onAction } = {}) {
    const el = $('#toast');
    el.innerHTML = `<span class="toast__moon" aria-hidden="true"></span><span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
    el.hidden = false;
    announce(msg);
    if (action) $('button', el).addEventListener('click', () => { el.hidden = true; onAction(); });
    armToast();
  }
  const armToast = () => { clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4200); };
  // keep the toast while the pointer or keyboard focus is on it
  $('#toast').addEventListener('mouseenter', () => clearTimeout(toastTimer));
  $('#toast').addEventListener('focusin', () => clearTimeout(toastTimer));
  $('#toast').addEventListener('mouseleave', armToast);
  $('#toast').addEventListener('focusout', armToast);

  /* =========================================================
     Views
     ========================================================= */
  const view = () => $('#view');
  const pageHead = (title, crumbs, extra = '') => `
    <div class="page-head${title ? '' : ' page-head--compact'}">
      <div class="container">
        <nav aria-label="現在地"><ol class="crumbs">${crumbs.map(([t, h]) => `<li>${h ? `<a href="${h}">${esc(t)}</a>` : `<span aria-current="page">${esc(t)}</span>`}</li>`).join('')}</ol></nav>
        ${title ? `<h1 class="page-title" tabindex="-1" data-page-focus>${esc(title)}</h1>` : ''}
        ${extra}
      </div>
    </div>`;

  /* ---------- product ---------- */
  let buyObserver = null;
  function renderProduct(p) {
    const gallery = [
      { kind: 'svg', label: '商品イメージ（米袋のイラスト）' },
      { kind: 'img', src: 'assets/img/bowl.webp', alt: '茶碗に盛った炊きたての満月米', contain: true, label: '炊きたてのごはん' },
      { kind: 'img', src: 'assets/img/rice-hand-sm.webp', alt: '手のひらにすくった満月米の精米', label: '精米のようす' },
    ];
    const media = (g) => (g.kind === 'svg' ? bagSVG(p.art, { title: `${p.name}の米袋のイラスト` }) : `<img src="${g.src}" alt="${esc(g.alt)}"${g.contain ? ' class="is-contain"' : ''}>`);
    const v0 = p.variants[0];
    const weights = p.variants.map((v) => v.weight).filter((x, i, a) => a.indexOf(x) === i).join('／');
    const specRows = BASE_SPEC.map(([k, val]) => [k, val.replace('{year}', p.year).replace('{weight}', weights)]);
    if (p.preorder) specRows.push(['発送時期', p.ship]);
    if (p.subscription) {
      specRows.push(['お届け周期', '毎月／隔月からお選びいただけます']);
      specRows.push(['休止・解約・お約束回数', '（準備中）']);
    }
    const others = PRODUCTS.filter((x) => x.id !== p.id);
    const award = `米-1グランプリ in らんこし 2025 <span class="nw">${p.award ? '金賞受賞' : '金賞受賞農園'}</span>`;

    view().innerHTML = `
      ${pageHead(null, [['トップ', '#top'], ['商品一覧', '#products'], [p.name]])}
      <div class="page-body">
        <div class="container">
          <div class="pd">
            <div class="pd__gallery">
              ${p.award ? '<img class="pd__medal" src="assets/img/medal.webp" alt="" width="400" height="400">' : ''}
              <div class="pd__main" id="pdMain">${media(gallery[0])}</div>
              <div class="pd__thumbs" role="group" aria-label="商品画像を切り替える">
                ${gallery.map((g, i) => `<button class="pd__thumb" type="button" data-thumb="${i}" aria-pressed="${i === 0}" aria-label="${esc(g.label)}を表示">${g.kind === 'svg' ? bagSVG(p.art) : `<img src="${g.src}" alt=""${g.contain ? ' class="is-contain"' : ''}>`}</button>`).join('')}
              </div>
            </div>

            <form class="pd__info" id="buyForm" novalidate>
              <div class="pd__head">
                <p class="pd__award">${award}</p>
                <div class="pd__badges">
                  <span class="badge${p.badge.line ? ' badge--line' : ''}">${esc(p.badge.text)}</span>
                  <span class="p-card__meta">${esc(p.meta)}</span>
                </div>
                <h1 class="pd__name" tabindex="-1" data-page-focus>${esc(p.name)}</h1>
              </div>
              <p class="pd__lead">${jp(p.lead)}</p>
              <div class="pd__price" id="pdPrice">${priceHTML(v0.price, { per: p.subscription ? '1回' : '' })}</div>
              <p class="pd__ship">${p.preorder ? '<b>予約商品</b>　' : ''}${esc(p.ship)}<br>送料${yen(SHIP_FEE)}円（税込${yen(FREE_SHIP_OVER)}円以上のご注文で無料。<span class="nw">沖縄・離島</span>は別途お見積もり）</p>

              ${p.variants.length > 1 ? `
              <fieldset class="opt">
                <legend>${p.subscription ? 'お届け周期・内容量' : '内容量'}</legend>
                <div class="chips">
                  ${p.variants.map((v, i) => `
                    <label class="chip"><input type="radio" name="variant" value="${v.id}" ${i === 0 ? 'checked' : ''}><span>${esc(v.label)}<small>¥${yen(v.price)}${p.subscription ? '／1回' : ''}</small></span></label>`).join('')}
                </div>
              </fieldset>` : `<input type="hidden" name="variant" value="${v0.id}">`}

              ${p.gift ? `
              <div class="field">
                <label class="field__label" for="giftSel">ギフト包装・のし</label>
                <select class="select" id="giftSel" name="gift">
                  ${GIFT_OPTIONS.map((g) => `<option value="${g.id}">${esc(g.label)}${g.fee ? `（+¥${yen(g.fee)}）` : ''}</option>`).join('')}
                </select>
              </div>` : ''}

              <div class="field">
                <span class="field__label" id="qtyLabel">数量</span>
                <div class="pd__buy">
                  <div class="qty" role="group" aria-labelledby="qtyLabel">
                    <button type="button" data-step="-1" aria-label="1つ減らす">−</button>
                    <output id="pdQty">1</output>
                    <button type="button" data-step="1" aria-label="1つ増やす">＋</button>
                  </div>
                  <button class="btn btn--gold" type="submit" id="buyBtn">${ICON_BAG}${p.preorder ? '予約してカートに入れる' : 'カートに入れる'}</button>
                </div>
              </div>
              <p class="pd__sub">
                <a href="#furusato"><span>ふるさと納税で選ぶ</span></a>
                <a href="#guide"><span>送料・お届けについて</span></a>
              </p>
            </form>
          </div>

          <div class="buybar" id="buyBar" hidden>
            <div id="buyBarPrice"></div>
            <button class="btn btn--gold" type="submit" form="buyForm">${ICON_BAG}${p.preorder ? '予約してカートへ' : 'カートに入れる'}</button>
          </div>

          <section class="spec" aria-labelledby="specTitle">
            <div>
              <h2 id="specTitle">商品情報</h2>
              <div class="table-wrap">
                <table class="spec-table"><tbody>
                  ${specRows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
                </tbody></table>
              </div>
            </div>
            <div>
              <h2>ななつぼしの特徴</h2>
              <ul class="spec__points">
                <li><img src="assets/svg/icon-onigiri.svg" alt=""><p><b>冷めてもおいしい</b><span>お弁当やおにぎりでも、おいしさが長続きします。</span></p></li>
                <li><img src="assets/svg/icon-ears.svg" alt=""><p><b>甘みのバランス</b><span>甘さが控えめで、さっぱりとした口当たりです。</span></p></li>
                <li><img src="assets/svg/icon-sparkle.svg" alt=""><p><b>穏やかな香り</b><span>主張が少なく、おかずの香りを邪魔しません。</span></p></li>
                <li><img src="assets/svg/icon-bowl.svg" alt=""><p><b>粒立ちが良い</b><span>コシがあり、しっかりとした食感です。</span></p></li>
              </ul>
            </div>
          </section>

          <section class="related" aria-labelledby="relTitle">
            <h2 id="relTitle">ほかの商品</h2>
            <div class="product-grid">${others.map(cardHTML).join('')}</div>
          </section>
        </div>
      </div>`;

    // gallery
    const thumbs = $$('.pd__thumb', view());
    thumbs.forEach((b) => b.addEventListener('click', () => {
      $('#pdMain').innerHTML = media(gallery[+b.dataset.thumb]);
      thumbs.forEach((t) => t.setAttribute('aria-pressed', String(t === b)));
    }));

    // qty + price
    const form = $('#buyForm');
    let qty = 1;
    const update = () => {
      const vid = new FormData(form).get('variant');
      const v = p.variants.find((x) => x.id === vid) || v0;
      const gid = form.gift ? form.gift.value : 'none';
      const g = GIFT_OPTIONS.find((x) => x.id === gid) || GIFT_OPTIONS[0];
      const unit = v.price + g.fee;
      const per = p.subscription ? '1回' : '';
      const notes = [qty > 1 ? `¥${yen(unit)} × ${qty}` : '', g.fee ? `ギフト包装 ¥${yen(g.fee)} を含む` : ''].filter(Boolean).join('・');
      $('#pdPrice').innerHTML = priceHTML(unit * qty, { per }) + (notes ? `<span class="price__tax">（${notes}）</span>` : '');
      $('#buyBarPrice').innerHTML = priceHTML(unit * qty, { per });
      $('#pdQty').textContent = qty;
      $('[data-step="-1"]', form).setAttribute('aria-disabled', String(qty <= 1));
      $('[data-step="1"]', form).setAttribute('aria-disabled', String(qty >= MAX_QTY));
    };
    $$('[data-step]', form).forEach((b) => b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      qty = Math.max(1, Math.min(MAX_QTY, qty + +b.dataset.step));
      update();
      announce(`数量 ${qty}`);
    }));
    form.addEventListener('change', update);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      addToCart(p.id, fd.get('variant'), qty, fd.get('gift') || 'none');
    });
    update();

    // sticky buy bar while the main button is off-screen
    if ('IntersectionObserver' in window) {
      buyObserver = new IntersectionObserver(([en]) => { $('#buyBar').hidden = en.isIntersecting; });
      buyObserver.observe($('#buyBtn'));
      document.body.classList.add('has-buybar');
    }
  }

  /* ---------- cart page ---------- */
  function renderCart() {
    const t = totals();
    view().innerHTML = `
      ${pageHead('カート', [['トップ', '#top'], ['カート']], stepsBar(0))}
      <div class="page-body">
        <div class="container">
          ${cart.length ? `
          <div class="cart-page">
            <div>${preorderNotice()}${cart.map(lineHTML).join('')}
              <p class="cart-page__more"><a class="link" href="#products">買いものを続ける</a></p>
            </div>
            <aside class="panel" aria-label="ご注文金額">
              <p class="panel__title">ご注文金額</p>
              ${freeShipHTML(t.sub)}
              ${summaryHTML(t)}
              <a class="btn btn--gold btn--block" href="#checkout">ご購入手続きへ</a>
            </aside>
          </div>` : emptyHTML()}
        </div>
      </div>`;
  }

  function stepsBar(active) {
    const steps = ['カート', 'お客様情報', 'ご確認', '完了'];
    return `<ol class="steps-bar" aria-label="ご購入の手順">${steps.map((s, i) => `
      <li class="${i < active ? 'is-done' : ''}" ${i === active ? 'aria-current="step"' : ''}>${phaseSVG(i + 1)}<span>${s}</span></li>`).join('')}</ol>`;
  }

  /* ---------- checkout ---------- */
  const PREFS = '北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県'.split(' ');
  const PAYMENTS = [
    { id: 'card', label: 'クレジットカード', note: '決済画面へ移動してお支払いいただきます', timing: 'ご注文時に決済画面でお支払い' },
    { id: 'atobarai', label: 'コンビニ後払い', note: '商品到着後、コンビニでお支払いいただけます', timing: '商品到着後にコンビニでお支払い' },
    { id: 'cod', label: '代金引換', note: `代引き手数料 ${yen(COD_FEE)}円`, timing: '商品お受け取り時にお支払い' },
    { id: 'bank', label: '銀行振込', note: 'ご入金を確認してから発送します', timing: 'ご注文後にお振込み（ご入金確認後に発送）' },
  ];
  const TIMES = ['指定なし', '午前中', '14〜16時', '16〜18時', '18〜20時', '19〜21時'];
  const WEEK = '日月火水木金土';
  const dateOptions = () => {
    const out = [];
    const d = new Date();
    d.setDate(d.getDate() + 4);
    for (let i = 0; i < 21; i++) {
      out.push(`${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`);
      d.setDate(d.getDate() + 1);
    }
    return out;
  };
  let draft = {};
  const hasGift = () => cart.some((l) => l.gift && l.gift !== 'none');

  // Japanese input normalisation: full-width digits → half-width, hiragana → katakana
  const toHalf = (s) => s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)).replace(/[－ー―‐−]/g, '-').replace(/\s/g, '');
  const toKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  const normalize = (el) => {
    if (/^s?(zip|tel)$/.test(el.id)) el.value = toHalf(el.value);
    else if (/^kana[12]$/.test(el.id)) el.value = toKata(el.value.trim());
  };

  function field({ id, label, type = 'text', req = true, full = false, auto, ph = '', hint = '', pattern, inputmode, max }) {
    const hintId = hint ? `${id}-hint` : '';
    return `
      <div class="field${full ? ' field--full' : ''}">
        <label class="field__label" for="${id}">${label}${req ? '<span class="req">必須</span>' : '<span class="opt-tag">任意</span>'}</label>
        <input class="input" id="${id}" name="${id}" type="${type}" ${req ? 'required' : ''} ${auto ? `autocomplete="${auto}"` : ''} ${pattern ? `pattern="${pattern}"` : ''} ${inputmode ? `inputmode="${inputmode}"` : ''} ${max ? `maxlength="${max}"` : ''} ${hintId ? `aria-describedby="${hintId}"` : ''} placeholder="${esc(ph)}" value="${esc(draft[id] || '')}">
        ${hint ? `<p class="field__hint" id="${hintId}">${hint}</p>` : ''}
        <p class="field__error" id="${id}-err" hidden></p>
      </div>`;
  }
  const prefSelect = (id, auto) => `
    <div class="field">
      <label class="field__label" for="${id}">都道府県<span class="req">必須</span></label>
      <select class="select" id="${id}" name="${id}" required ${auto ? `autocomplete="${auto}"` : ''}>
        <option value="">選択してください</option>
        ${PREFS.map((p) => `<option ${draft[id] === p ? 'selected' : ''}>${p}</option>`).join('')}
      </select>
      <p class="field__error" id="${id}-err" hidden></p>
    </div>`;

  const codFee = () => (draft.pay === 'cod' ? COD_FEE : 0);
  function orderPanel() {
    const t = totals();
    return `
      <aside class="panel" aria-label="ご注文内容">
        <p class="panel__title">ご注文内容</p>
        <div>${cart.map((l) => { const { p, v, g, total } = lineInfo(l); return `
          <div class="mini-line"><span class="line__img" aria-hidden="true">${bagSVG(p.art)}</span>
          <span class="mini-line__name">${esc(p.name)}<small>${[p.variants.length > 1 ? v.label : '', g.id !== 'none' ? g.label : ''].filter(Boolean).map(esc).join('／')} <span class="nw">× ${l.qty}</span></small></span>
          ${priceHTML(total, { tax: false })}</div>`; }).join('')}
        </div>
        ${summaryHTML(t, codFee())}
        <p class="drawer__links"><a href="#cart">カートに戻る</a></p>
      </aside>`;
  }
  const payTotal = () => `<p class="pay-total" id="payTotal"><span>お支払い合計（税込）</span>${priceHTML(totals().total + codFee(), { tax: false })}</p>`;

  function renderCheckout() {
    if (!cart.length) {
      view().innerHTML = `${pageHead('ご購入手続き', [['トップ', '#top'], ['ご購入手続き']])}<div class="page-body"><div class="container">${emptyHTML()}</div></div>`;
      return;
    }
    const dates = dateOptions();
    const pre = hasPreorder();
    view().innerHTML = `
      ${pageHead('お客様情報の入力', [['トップ', '#top'], ['カート', '#cart'], ['お客様情報']], stepsBar(1))}
      <div class="page-body">
        <div class="container">
          <div class="checkout">
            <form id="checkoutForm" novalidate>
              <p class="notice checkout__notice"><b>デモサイトです</b>入力した内容はこの画面の中だけで使われ、どこにも送信されません。実際の注文・決済も行われません。</p>

              <section class="form-sec">
                <h2><span class="num">1</span>ご注文者さま</h2>
                <div class="fields">
                  ${field({ id: 'name1', label: '姓', auto: 'family-name', ph: '例：山田', max: 20 })}
                  ${field({ id: 'name2', label: '名', auto: 'given-name', ph: '例：花子', max: 20 })}
                  ${field({ id: 'kana1', label: 'セイ', ph: '例：ヤマダ', pattern: '[ァ-ヶー　 ]+', max: 30, hint: 'ひらがなで入力しても、カタカナに変換されます' })}
                  ${field({ id: 'kana2', label: 'メイ', ph: '例：ハナコ', pattern: '[ァ-ヶー　 ]+', max: 30 })}
                  ${field({ id: 'zip', label: '郵便番号', auto: 'postal-code', ph: '例：0950000', pattern: '\\d{3}-?\\d{4}', inputmode: 'numeric', max: 8, hint: '全角・半角、ハイフンの有無を問わず入力できます' })}
                  ${prefSelect('pref', 'address-level1')}
                  ${field({ id: 'addr1', label: '市区町村・番地', auto: 'address-line1', ph: '例：士別市上士別町0-0', full: true, max: 80 })}
                  ${field({ id: 'addr2', label: '建物名・部屋番号', auto: 'address-line2', req: false, full: true, max: 80 })}
                  ${field({ id: 'tel', label: '電話番号', type: 'tel', auto: 'tel', ph: '例：09012345678', pattern: '0\\d{1,4}-?\\d{1,4}-?\\d{3,4}', inputmode: 'tel', max: 13 })}
                  ${field({ id: 'email', label: 'メールアドレス', type: 'email', auto: 'email', ph: '例：mail@example.com', max: 120 })}
                </div>
              </section>

              <section class="form-sec">
                <h2><span class="num">2</span>お届け先</h2>
                <label class="chip" style="justify-self:start">
                  <input type="checkbox" id="giftTo" name="giftTo" ${draft.giftTo ? 'checked' : ''}>
                  <span>ご注文者さまと別の住所にお届けする</span>
                </label>
                <div class="fields" id="shipFields" ${draft.giftTo ? '' : 'hidden'}>
                  ${field({ id: 'sname', label: 'お届け先のお名前', auto: 'shipping name', ph: '例：山田 太郎', full: true, max: 40 })}
                  ${field({ id: 'szip', label: '郵便番号', auto: 'shipping postal-code', ph: '例：0950000', pattern: '\\d{3}-?\\d{4}', inputmode: 'numeric', max: 8 })}
                  ${prefSelect('spref', 'shipping address-level1')}
                  ${field({ id: 'saddr1', label: '市区町村・番地', auto: 'shipping address-line1', full: true, max: 80 })}
                  ${field({ id: 'saddr2', label: '建物名・部屋番号', auto: 'shipping address-line2', req: false, full: true, max: 80 })}
                  ${field({ id: 'stel', label: '電話番号', type: 'tel', auto: 'shipping tel', pattern: '0\\d{1,4}-?\\d{1,4}-?\\d{3,4}', inputmode: 'tel', max: 13 })}
                </div>
                ${hasGift() ? field({ id: 'noshiName', label: 'のしのお名前（名入れ）', req: false, ph: '例：山田', max: 20, hint: '空欄の場合は名入れなしでお届けします' }) : ''}
              </section>

              <section class="form-sec">
                <h2><span class="num">3</span>お届け日時</h2>
                <div class="fields">
                  ${pre ? `<p class="field__hint field--full">予約商品（令和8年産 新米）を含むため、新米の発送にあわせて2026年12月上旬より順次お届けします。日付のご指定はできません。</p>` : `
                  <div class="field">
                    <label class="field__label" for="date">お届け希望日<span class="opt-tag">任意</span></label>
                    <select class="select" id="date" name="date">
                      <option value="">最短でお届け</option>
                      ${dates.map((d) => `<option ${draft.date === d ? 'selected' : ''}>${d}</option>`).join('')}
                    </select>
                  </div>`}
                  <div class="field">
                    <label class="field__label" for="time">時間帯<span class="opt-tag">任意</span></label>
                    <select class="select" id="time" name="time">
                      ${TIMES.map((t) => `<option ${draft.time === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                  </div>
                </div>
              </section>

              <section class="form-sec">
                <h2><span class="num">4</span>お支払い方法</h2>
                <fieldset class="opt pay">
                  <legend class="visually-hidden">お支払い方法</legend>
                  ${PAYMENTS.map((pm, i) => `
                    <label class="chip"><input type="radio" name="pay" value="${pm.id}" ${(draft.pay ? draft.pay === pm.id : i === 0) ? 'checked' : ''}><span>${pm.label}<small>${pm.note}</small></span></label>`).join('')}
                </fieldset>
              </section>

              <section class="form-sec">
                <h2><span class="num">5</span>備考</h2>
                <div class="field">
                  <label class="field__label" for="memo">ご要望など<span class="opt-tag">任意</span></label>
                  <textarea class="textarea input" id="memo" name="memo" rows="4" maxlength="400" placeholder="置き配のご希望など">${esc(draft.memo || '')}</textarea>
                </div>
              </section>

              ${payTotal()}
              <button class="btn btn--gold btn--block" type="submit">ご注文内容を確認する</button>
            </form>
            ${orderPanel()}
          </div>
        </div>
      </div>`;

    const form = $('#checkoutForm');
    const giftTo = $('#giftTo');
    const shipFields = $('#shipFields');
    const syncShip = () => {
      shipFields.hidden = !giftTo.checked;
      $$('input, select', shipFields).forEach((el) => { el.disabled = !giftTo.checked; });
    };
    giftTo.addEventListener('change', syncShip);
    syncShip();
    // the form may already be detached (route change) when these fire; ignore those
    form.addEventListener('input', () => { if (form.isConnected) collect(form); });
    form.addEventListener('change', (e) => {
      if (!form.isConnected) return;
      collect(form);
      if (e.target.name === 'pay') {
        $('.checkout .panel').outerHTML = orderPanel();
        $('#payTotal').outerHTML = payTotal();
      }
    });
    form.addEventListener('focusout', (e) => {
      const el = e.target;
      if (!form.isConnected || !el.matches('.input, .select')) return;
      normalize(el);
      collect(form);
      if (el.value || el.getAttribute('aria-invalid') === 'true') validateField(el);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fields = $$('.input, .select', form).filter((el) => !el.disabled);
      fields.forEach(normalize);
      const bad = fields.filter((el) => !validateField(el));
      if (bad.length) { bad[0].focus(); announce(`入力内容を確認してください（${bad.length}か所）`); return; }
      collect(form);
      draft.ok = true;
      location.hash = 'checkout-confirm';
    });
  }
  function validateField(el) {
    const err = document.getElementById(el.id + '-err');
    let msg = '';
    if (el.validity.valueMissing) msg = el.tagName === 'SELECT' ? '選択してください。' : '入力してください。';
    else if (el.validity.typeMismatch && el.type === 'email') msg = 'メールアドレスの形式で入力してください（例：mail@example.com）。';
    else if (el.validity.patternMismatch) {
      msg = { zip: '7桁の数字で入力してください（例：0950000）。', szip: '7桁の数字で入力してください（例：0950000）。', tel: '市外局番から数字で入力してください。', stel: '市外局番から数字で入力してください。', kana1: 'カタカナで入力してください。', kana2: 'カタカナで入力してください。' }[el.id] || '入力内容をご確認ください。';
    }
    el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (err) { err.textContent = msg; err.hidden = !msg; }
    const ids = [document.getElementById(el.id + '-hint') ? el.id + '-hint' : '', msg && err ? err.id : ''].filter(Boolean);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' ')); else el.removeAttribute('aria-describedby');
    return !msg;
  }
  function collect(form) {
    const fd = new FormData(form);
    const next = Object.fromEntries(fd.entries());
    next.giftTo = !!fd.get('giftTo');
    // keep the "checked" flag unless something the shopper entered actually changed
    const same = draft.ok
      && Object.keys(next).every((k) => next[k] === draft[k])
      && Object.keys(draft).every((k) => k === 'ok' || k in next);
    draft = next;
    if (same) draft.ok = true;
  }

  function renderConfirm() {
    if (!cart.length) { location.replace('#cart'); return; }
    if (!draft.ok) { location.replace('#checkout'); return; }
    const pay = PAYMENTS.find((p) => p.id === draft.pay) || PAYMENTS[0];
    const addr = (z, p, a1, a2) => `〒${esc(z)}<br>${esc(p)}${esc(a1)}${a2 ? ' ' + esc(a2) : ''}`;
    const pre = hasPreorder();
    const teiki = cart.filter((l) => byId(l.pid).subscription);
    const rows = [
      ['ご注文者さま', `${esc(draft.name1)} ${esc(draft.name2)}（${esc(draft.kana1)} ${esc(draft.kana2)}）`],
      ['ご住所', addr(draft.zip, draft.pref, draft.addr1, draft.addr2)],
      ['電話番号', esc(draft.tel)],
      ['メールアドレス', esc(draft.email)],
      ['お届け先', draft.giftTo ? `${esc(draft.sname)} さま<br>${addr(draft.szip, draft.spref, draft.saddr1, draft.saddr2)}<br>${esc(draft.stel)}` : 'ご注文者さまと同じ'],
      ...(hasGift() ? [['のしの名入れ', draft.noshiName ? esc(draft.noshiName) : 'なし']] : []),
      ['お届け時期', pre ? '2026年12月上旬より順次発送（新米の発送にあわせてお届け）' : 'ご注文から3〜5営業日で発送'],
      ['お届け日時', `希望日：${pre ? '指定なし' : esc(draft.date || '最短でお届け')}／時間帯：${esc(draft.time || '指定なし')}`],
      ['お支払い方法', esc(pay.label)],
      ['お支払い時期', esc(pay.timing)],
      ['キャンセル・返品', 'ご注文確定後のキャンセル：（準備中）<br>食品のため、お客様のご都合による返品・交換はお受けできません（<a class="link" href="#guide">ご利用ガイド</a>）'],
      ['備考', draft.memo ? esc(draft.memo).replace(/\n/g, '<br>') : 'なし'],
    ];
    const teikiNote = teiki.map((l) => { const { v, total } = lineInfo(l); return `${esc(v.label)}${l.qty > 1 ? ` × ${l.qty}` : ''}・1回あたり¥${yen(total)}（税込）`; }).join('<br>');
    view().innerHTML = `
      ${pageHead('ご注文内容の確認', [['トップ', '#top'], ['カート', '#cart'], ['お客様情報', '#checkout'], ['ご確認']], stepsBar(2))}
      <div class="page-body">
        <div class="container">
          <div class="checkout">
            <div>
              <div class="table-wrap">
                <table class="spec-table confirm-table"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>
              </div>
              <p style="margin:24px 0 32px"><a class="link" href="#checkout">入力内容を修正する</a></p>
              ${teiki.length ? `<p class="notice" style="margin-bottom:16px"><b>定期便のお申し込みです</b>${teikiNote}<br>休止・解約の方法（準備中）</p>` : ''}
              <p class="notice" style="margin-bottom:24px"><b>デモサイトです</b>「注文を確定する」を押しても、実際の注文・決済は行われません。</p>
              ${payTotal()}
              <button class="btn btn--gold btn--block" type="button" id="placeOrder">注文を確定する</button>
            </div>
            ${orderPanel()}
          </div>
        </div>
      </div>`;
    let placing = false;
    $('#placeOrder').addEventListener('click', (e) => {
      if (placing || !cart.length || !draft.ok) return;
      placing = true;
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'ご注文を送信しています…';
      const d = new Date();
      const no = `MG-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(Math.floor(1000 + Math.random() * 9000))}`;
      lastOrder = { no, name: `${draft.name1} ${draft.name2}`, preorder: pre, mixed: mixedPreorder() };
      cart = []; draft = {};
      store.save(cart);
      renderCount();
      location.hash = 'thanks';
    });
  }

  let lastOrder = null;
  function renderThanks() {
    view().innerHTML = `
      ${pageHead('ご注文完了', [['トップ', '#top'], ['ご注文完了']], stepsBar(3))}
      <div class="page-body">
        <div class="container">
          <div class="thanks">
            <img class="thanks__moon" src="assets/img/moon-sm.webp" alt="">
            ${lastOrder ? `
              <h2>ご注文ありがとうございました</h2>
              <p class="thanks__no">ご注文番号<b>${esc(lastOrder.no)}</b></p>
              <p>${esc(lastOrder.name)} さま、ご注文を承りました。${lastOrder.preorder ? (lastOrder.mixed ? 'ご注文の商品は、新米の発送にあわせて<span class="nw">2026年12月上旬</span>にまとめてお届けします。' : '新米は<span class="nw">2026年12月上旬</span>より順次お届けします。') : '準備が整いしだい発送いたします。'}</p>
              <p class="notice">デモサイトのため、確認メールの送信や実際の発送は行われません。</p>`
            : `<h2>ご注文番号を表示できません</h2><p>ご注文の手続きが済むと、この画面にご注文番号が表示されます。ページを開き直した場合は表示されません。</p>`}
            <a class="btn btn--line" href="#top">トップへ戻る</a>
          </div>
        </div>
      </div>`;
  }

  /* ---------- guide ---------- */
  function renderGuide() {
    const pend = '<span class="pending">（準備中）</span>';
    view().innerHTML = `
      ${pageHead('ご利用ガイド', [['トップ', '#top'], ['ご利用ガイド']])}
      <div class="page-body">
        <div class="container">
          <div class="guide">
            <nav class="guide__toc" aria-label="ガイドの目次">
              <a href="#guide" data-jump="g-flow">ご注文の流れ</a>
              <a href="#guide" data-jump="g-pay">お支払い</a>
              <a href="#guide" data-jump="g-ship">送料・お届け</a>
              <a href="#guide" data-jump="g-return">返品・交換</a>
              <a href="#guide-law">特定商取引法に基づく表記</a>
              <a href="#guide-privacy">プライバシーポリシー</a>
            </nav>
            <div class="guide__body">
              <section class="guide__sec" id="g-flow">
                <h2>ご注文の流れ</h2>
                <ol class="guide__flow">
                  <li><i>01</i><b>商品を選ぶ</b><span>内容量やギフト包装を選んで、カートに入れます。</span></li>
                  <li><i>02</i><b>お客様情報</b><span>お届け先とお支払い方法を入力します。</span></li>
                  <li><i>03</i><b>ご確認</b><span>ご注文内容を確かめて、注文を確定します。</span></li>
                  <li><i>04</i><b>お届け</b><span>士別市の満月農園から、常温便でお届けします。</span></li>
                </ol>
              </section>
              <section class="guide__sec" id="g-pay">
                <h2>お支払い</h2>
                <ul class="dots">
                  ${PAYMENTS.map((p) => `<li>${p.label}　<span class="pending">${p.note}</span></li>`).join('')}
                </ul>
              </section>
              <section class="guide__sec" id="g-ship">
                <h2>送料・お届け</h2>
                <div class="table-wrap"><table class="spec-table"><tbody>
                  <tr><th scope="row">送料</th><td>${yen(SHIP_FEE)}円（税込${yen(FREE_SHIP_OVER)}円以上のご注文で無料）<br><span class="pending">沖縄・離島は別途お見積もりとなります</span></td></tr>
                  <tr><th scope="row">配送方法</th><td>常温便</td></tr>
                  <tr><th scope="row">発送時期</th><td>通常商品：ご注文から3〜5営業日で発送<br>令和8年産 新米（予約）：2026年12月上旬より順次発送</td></tr>
                  <tr><th scope="row">日時指定</th><td>ご注文日の4日後以降の日付と、時間帯をお選びいただけます（予約商品を含むご注文は日付指定不可）</td></tr>
                  <tr><th scope="row">ギフト包装・のし</th><td>1点につき${yen(GIFT_FEE)}円（御歳暮・御礼・内祝・無地）</td></tr>
                </tbody></table></div>
              </section>
              <section class="guide__sec" id="g-return">
                <h2>返品・交換</h2>
                <p>食品のため、お客様のご都合による返品・交換はお受けできません。商品の破損や誤配送があった場合は、商品到着後7日以内にご連絡ください。送料当店負担で交換いたします。</p>
              </section>
              <section class="guide__sec" id="g-law">
                <h2>特定商取引法に基づく表記</h2>
                <div class="table-wrap"><table class="spec-table"><tbody>
                  <tr><th scope="row">販売業者</th><td>満月農園 ${pend}</td></tr>
                  <tr><th scope="row">運営責任者</th><td>${pend}</td></tr>
                  <tr><th scope="row">所在地</th><td>北海道士別市上士別町 ${pend}</td></tr>
                  <tr><th scope="row">電話番号</th><td>${pend}</td></tr>
                  <tr><th scope="row">メールアドレス</th><td>${pend}</td></tr>
                  <tr><th scope="row">販売価格</th><td>各商品ページに税込価格で表示しています</td></tr>
                  <tr><th scope="row">商品代金以外の費用</th><td>送料、代引き手数料（代金引換の場合）、ギフト包装料（ご希望の場合）</td></tr>
                  <tr><th scope="row">お支払い方法</th><td>${PAYMENTS.map((p) => p.label).join('、')}</td></tr>
                  <tr><th scope="row">引き渡し時期</th><td>「送料・お届け」をご覧ください</td></tr>
                  <tr><th scope="row">返品・交換</th><td>「返品・交換」をご覧ください</td></tr>
                </tbody></table></div>
              </section>
              <section class="guide__sec" id="g-privacy">
                <h2>プライバシーポリシー</h2>
                <p>お預かりした個人情報は、ご注文商品の発送、お問い合わせへの回答、お支払いの確認のためにのみ利用し、法令に基づく場合を除いて第三者に提供することはありません。</p>
                <p class="pending">正式な文面は準備中です。</p>
              </section>
            </div>
          </div>
        </div>
      </div>`;
    $$('[data-jump]', view()).forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const t = document.getElementById(a.dataset.jump);
      if (t) {
        t.scrollIntoView({ behavior: smooth() });
        const h = t.querySelector('h2');
        if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
      }
    }));
  }

  /* =========================================================
     Router
     ========================================================= */
  const PAGES = {
    cart: { title: 'カート', render: renderCart },
    checkout: { title: 'お客様情報の入力', render: renderCheckout },
    'checkout-confirm': { title: 'ご注文内容の確認', render: renderConfirm },
    thanks: { title: 'ご注文完了', render: renderThanks },
    guide: { title: 'ご利用ガイド', render: renderGuide },
    'guide-law': { title: '特定商取引法に基づく表記', render: renderGuide, anchor: 'g-law' },
    'guide-privacy': { title: 'プライバシーポリシー', render: renderGuide, anchor: 'g-privacy' },
  };
  const SITE = '満月米 オンラインショップ';
  let currentRoute = null;

  const hashId = () => { try { return decodeURIComponent(location.hash.slice(1)); } catch { return ''; } };
  function showHome() {
    $('#home').hidden = false;
    view().hidden = true;
    view().innerHTML = '';
    document.title = SITE;
  }
  function showPage() {
    $('#home').hidden = true;
    view().hidden = false;
  }
  function teardownPage() {
    if (buyObserver) { buyObserver.disconnect(); buyObserver = null; }
    document.body.classList.remove('has-buybar');
  }

  function renderRoute() {
    const id = hashId();
    if (id === 'main' && currentRoute && currentRoute !== 'home') return;
    const wasHome = currentRoute === 'home';
    teardownPage();

    if (id.startsWith('item-') && byId(id.slice(5))) {
      const p = byId(id.slice(5));
      showPage(); renderProduct(p);
      document.title = `${p.name}｜${SITE}`;
      currentRoute = id;
    } else if (PAGES[id]) {
      showPage(); PAGES[id].render();
      document.title = `${PAGES[id].title}｜${SITE}`;
      currentRoute = id;
    } else {
      if (!wasHome) showHome();
      currentRoute = 'home';
      const target = id && id !== 'top' && id !== 'main' ? document.getElementById(id) : null;
      const st = history.state || {};
      const saved = typeof st.y === 'number' ? st.y : null;
      const how = wasHome ? smooth() : 'instant';
      requestAnimationFrame(() => {
        if (saved !== null) {
          window.scrollTo({ top: saved, behavior: 'instant' });
          // coming back from a sub-page: return focus to the link that was used
          if (!wasHome && st.from) {
            const back = $$(`#home a[href="${CSS.escape(st.from)}"]`).find((el) => el.tabIndex !== -1 && el.getClientRects().length);
            if (back) back.focus({ preventScroll: true });
          }
        } else if (target) target.scrollIntoView({ behavior: how });
        else if (!wasHome || id === 'top' || !id) window.scrollTo({ top: 0, behavior: how });
        if (!wasHome && target && saved === null) {
          const h = target.querySelector('h2, h1');
          if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
        }
      });
    }
    updateHeader();
  }

  function onHashChange() {
    const prev = currentRoute;
    clearTimeout(toastTimer);
    $('#toast').hidden = true;
    closeDrawer();
    closeMenu();
    renderRoute();
    if (currentRoute !== 'home' && prev !== currentRoute) {
      const pg = PAGES[currentRoute];
      if (pg && pg.anchor) requestAnimationFrame(() => { const t = document.getElementById(pg.anchor); if (t) t.scrollIntoView({ behavior: 'instant' }); });
      else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      const h = $('[data-page-focus]', view());
      if (h) h.focus({ preventScroll: true });
    }
  }

  /* =========================================================
     Header / menu
     ========================================================= */
  const header = $('#siteHeader');
  function updateHeader() {
    const solid = currentRoute !== 'home' || window.scrollY > 24 || !$('#mobileNav').hidden;
    header.classList.toggle('is-solid', solid);
  }
  function openMenu() {
    $('#mobileNav').hidden = false;
    $('#menuToggle').setAttribute('aria-expanded', 'true');
    $('#menuToggle').setAttribute('aria-label', 'メニューを閉じる');
    document.body.classList.add('is-locked');
    setInert(true, behindMenu());
    updateHeader();
    const first = $('#mobileNav a');
    if (first) first.focus();
  }
  function closeMenu() {
    if ($('#mobileNav').hidden) return;
    const hadFocus = $('#mobileNav').contains(document.activeElement);
    $('#mobileNav').hidden = true;
    $('#menuToggle').setAttribute('aria-expanded', 'false');
    $('#menuToggle').setAttribute('aria-label', 'メニューを開く');
    document.body.classList.remove('is-locked');
    setInert(false, behindMenu());
    updateHeader();
    if (hadFocus) {
      const t = $('#menuToggle');
      (t.getClientRects().length ? t : $('#cartOpen')).focus({ preventScroll: true });
    }
  }
  window.matchMedia('(min-width: 1081px)').addEventListener('change', (e) => { if (e.matches) closeMenu(); });

  /* =========================================================
     Events
     ========================================================= */
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  document.addEventListener('click', (e) => {
    // skip link: move focus to the current view's content without routing
    const skip = e.target.closest('.skip-link');
    if (skip) {
      e.preventDefault();
      const t = currentRoute === 'home' ? $('#main') : ($('[data-page-focus]', view()) || $('#main'));
      if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
      t.focus({ preventScroll: true });
      t.scrollIntoView({ block: 'start', behavior: 'instant' });
      return;
    }

    const add = e.target.closest('[data-add]');
    if (add) { addToCart(add.dataset.add, add.dataset.variant, 1, 'none'); return; }
    const q = e.target.closest('[data-qty]');
    if (q) {
      if (q.getAttribute('aria-disabled') === 'true') return;
      const l = cart.find((x) => lineKey(x) === q.dataset.qty);
      if (l) {
        setQty(q.dataset.qty, l.qty + +q.dataset.delta);
        announce(`数量 ${l.qty}（小計 ¥${yen(lineInfo(l).total)}）`);
      }
      return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) { removeLine(rm.dataset.remove); return; }

    const a = e.target.closest('a[href^="#"]');
    if (!a || a.dataset.jump) return;
    const href = a.getAttribute('href');
    // remember where the shopper was on the home page, for Back
    if (currentRoute === 'home') history.replaceState({ y: window.scrollY, from: href }, '');
    if (a.closest('#cartDrawer')) closeDrawer();
    // links to the page we are already on (no hashchange fires)
    if (href === location.hash || (href === '#top' && currentRoute === 'home' && !location.hash)) {
      e.preventDefault();
      closeMenu(); closeDrawer();
      if (currentRoute === 'home') {
        const t = href !== '#top' && document.getElementById(href.slice(1));
        if (t) t.scrollIntoView({ behavior: smooth() });
        else window.scrollTo({ top: 0, behavior: smooth() });
      } else {
        const pg = PAGES[currentRoute];
        const t = pg && pg.anchor && document.getElementById(pg.anchor);
        if (t) t.scrollIntoView({ behavior: 'instant' });
        else window.scrollTo({ top: 0, behavior: 'instant' });
      }
    }
  });

  $('#cartOpen').addEventListener('click', openDrawer);
  $('#cartClose').addEventListener('click', closeDrawer);
  $('#drawerBackdrop').addEventListener('click', closeDrawer);
  $('#menuToggle').addEventListener('click', () => ($('#mobileNav').hidden ? openMenu() : closeMenu()));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#cartDrawer').hidden) closeDrawer();
      else closeMenu();
    }
    // keep focus inside the open drawer
    const trap = !$('#cartDrawer').hidden ? $('#cartDrawer') : null;
    if (e.key === 'Tab' && trap) {
      const f = $$('a[href], button:not([disabled]), input, select', trap).filter((el) => el.getClientRects().length);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { updateHeader(); ticking = false; });
  }, { passive: true });
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { cart = store.load(); refreshCartViews(); } });

  /* =========================================================
     Occasional twinkles on the background stars
     A star from the tiled star backgrounds flares briefly every few
     seconds. Glints sit exactly on real stars and behind the content.
     ========================================================= */
  // [x, y, kind] per tile: kind 0 = dot, 1 = star / sparkle, 2 = burst
  const STAR_TILES = {"a":[[68,248,0],[70,481,0],[73,510,0],[82,463,0],[91,374,0],[139,101,0],[139,293,0],[141,194,0],[148,464,0],[155,285,0],[175,81,0],[176,328,0],[194,527,0],[196,307,0],[205,142,0],[208,307,0],[220,223,0],[250,525,0],[252,308,0],[268,100,0],[268,366,0],[278,446,0],[286,489,0],[326,509,0],[360,51,0],[370,510,0],[382,213,0],[409,173,0],[414,256,0],[416,48,0],[448,544,0],[460,159,0],[490,176,0],[514,281,0],[539,44,0],[547,26,0]],"b":[[186,604,1],[197,64,2],[229,944,1],[240,153,1],[298,923,1],[399,433,0],[399,969,0],[411,167,0],[412,851,2],[495,928,2],[507,286,1],[535,59,1],[609,178,1],[614,792,2],[670,737,0],[714,28,0],[729,742,1],[731,55,1],[748,569,0],[801,787,1],[847,390,1],[866,481,0]],"c":[[8,651,1],[153,399,1],[230,137,1],[353,265,1],[528,1050,1],[615,65,1],[624,1198,1],[845,145,1],[1013,344,1],[1127,231,1],[1170,788,1]]};
  function initTwinkles() {
    if (reduceMotion) return;
    const makeLayer = (cls) => { const d = document.createElement('div'); d.className = cls; d.setAttribute('aria-hidden', 'true'); return d; };
    const pageLayer = makeLayer('glints');
    document.body.prepend(pageLayer);
    const footer = $('.site-footer');
    const footLayer = makeLayer('glints glints--box');
    footer.prepend(footLayer);
    const hero = $('.hero');

    // where each star background is painted: [tile, size, offsetX, offsetY] (matches style.css)
    const skies = [
      { page: true, layer: pageLayer, tiles: [['c', 1240, 0, 0], ['a', 560, 173, 311]] },
      { el: () => ($('#home').hidden ? null : hero), layer: $('.hero__sky'), tiles: [['b', 980, 0, 48], ['a', 560, 140, 60]] },
      { el: () => footer, layer: footLayer, tiles: [['b', 980, 200, 0]] },
    ];

    function candidates() {
      const vw = window.innerWidth, vh = window.innerHeight, top = 90;
      const covers = [$('#home').hidden ? null : hero, footer].filter(Boolean).map((el) => el.getBoundingClientRect());
      const out = [];
      for (const sky of skies) {
        let ox, oy, w, h;
        if (sky.page) {
          ox = -window.scrollX; oy = -window.scrollY;
          w = document.documentElement.scrollWidth; h = document.documentElement.scrollHeight;
        } else {
          const el = sky.el();
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.bottom < top || r.top > vh) continue;
          ox = r.left + el.clientLeft; oy = r.top + el.clientTop; w = el.clientWidth; h = el.clientHeight;
        }
        const x0 = Math.max(0, -ox), x1 = Math.min(w, vw - ox), y0 = Math.max(0, top - oy), y1 = Math.min(h, vh - oy);
        if (x1 <= x0 || y1 <= y0) continue;
        for (const [key, size, px, py] of sky.tiles) {
          for (let i = Math.floor((x0 - px) / size); i <= Math.floor((x1 - px) / size); i++) {
            for (let j = Math.floor((y0 - py) / size); j <= Math.floor((y1 - py) / size); j++) {
              for (const [sx, sy, kind] of STAR_TILES[key]) {
                const bx = px + i * size + sx, by = py + j * size + sy;
                if (bx < x0 + 8 || bx > x1 - 8 || by < y0 || by > y1 - 8) continue;
                const vx = ox + bx, vy = oy + by;
                if (sky.page && covers.some((c) => vx >= c.left && vx <= c.right && vy >= c.top && vy <= c.bottom)) continue;
                out.push({ layer: sky.layer, x: bx, y: by, vx, vy, kind });
              }
            }
          }
        }
      }
      return out;
    }

    // skip stars hidden behind photos, cards, the ribbon, buttons and panels
    const COVERED = 'img, svg, .p-card, .award-ribbon, .furusato__box, .btn, .add-btn, .panel, .site-header, .badge, .pd__main, .pd__thumb, .line, .mini-line, .select, .input, .chip, .qty, .toast';
    const visible = (c) => { const el = document.elementFromPoint(c.vx, c.vy); return !el || !el.closest(COVERED); };

    function spawn() {
      if (document.hidden || document.body.classList.contains('is-locked')) return;
      const list = candidates();
      if (!list.length) return;
      // stars and sparkles flare more often than plain dots
      const weight = (c) => (c.kind ? 5 : 1);
      const total = list.reduce((n, c) => n + weight(c), 0);
      let pick = null;
      for (let tries = 0; tries < 12 && !pick; tries++) {
        let r = Math.random() * total;
        const c = list.find((x) => (r -= weight(x)) <= 0) || list[0];
        if (visible(c)) pick = c;
      }
      if (!pick) return;
      const g = document.createElement('i');
      g.className = 'glint';
      const size = pick.kind ? 20 + Math.random() * 8 : 12 + Math.random() * 5;
      g.style.cssText = `left:${pick.x}px;top:${pick.y}px;--g:${size.toFixed(1)}px`;
      pick.layer.appendChild(g);
      g.addEventListener('animationend', () => g.remove(), { once: true });
      setTimeout(() => g.remove(), 3000);
    }

    const loop = () => {
      spawn();
      if (Math.random() < 0.15) setTimeout(spawn, 600 + Math.random() * 900);
      setTimeout(loop, 2800 + Math.random() * 3000);
    };
    setTimeout(loop, 1600);
  }

  /* ---------- boot ---------- */
  renderProductGrid();
  renderCount();
  onHashChange();
  initTwinkles();
})();
