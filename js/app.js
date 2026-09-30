/* =========================================================
   満月米 — app.js
   トップページ（index.html）とオンラインショップ（shop.html）の動き。
   商品データは store.js、表示部品は ui.js。
   ショップはハッシュで画面を切り替える：
   一覧 / #category-<id> / #item-<id> / #cart / #checkout / #checkout-confirm / #thanks / #guide
   ========================================================= */
(() => {
  'use strict';

  const S = window.MangetsuStore;
  const { esc, yen, priceHTML, ICON_BAG, phaseSVG, visualHTML, imageHTML, cardHTML, stockNote } = window.MangetsuUI;

  const PAGE = document.body.dataset.page;          // 'home' | 'shop'
  const IS_SHOP = PAGE === 'shop';
  const shopHref = (hash = '') => (IS_SHOP ? `#${hash}` : `shop.html${hash ? '#' + hash : ''}`);
  const itemHref = (id) => shopHref(`item-${id}`);
  const settings = () => S.catalog().settings;
  const alwaysFree = (s = settings()) => s.shipFee === 0 || s.freeShipOver === 0;
  const shipText = (s = settings()) => (alwaysFree(s) ? '全国送料無料' : `送料${yen(s.shipFee)}円。税込${yen(s.freeShipOver)}円以上のご注文で送料無料`);

  const GIFT_OPTIONS = [
    { id: 'none', label: 'なし', paid: false },
    { id: 'wrap', label: 'ギフト包装のみ', paid: true },
    { id: 'oseibo', label: 'ギフト包装＋のし「御歳暮」', paid: true },
    { id: 'orei', label: 'ギフト包装＋のし「御礼」', paid: true },
    { id: 'uchiiwai', label: 'ギフト包装＋のし「内祝」', paid: true },
    { id: 'muji', label: 'ギフト包装＋のし「無地」', paid: true },
  ];
  const giftFee = (g) => (g.paid ? settings().giftFee : 0);
  const giftOf = (id) => GIFT_OPTIONS.find((x) => x.id === (id || 'none')) || GIFT_OPTIONS[0];

  /* ---------- helpers ---------- */
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const smooth = () => (reduceMotion ? 'auto' : 'smooth');
  // keep a few words that phrase-breaking tends to split on one line
  const NOBR = /(ななつぼし|おにぎり|召し上がる|2026年12月上旬)/g;
  const jp = (s) => esc(s).replace(NOBR, '<span class="nw">$1</span>');
  const view = () => $('#view');

  /* ---------- cart ---------- */
  let cart = S.loadCart();
  const lineKey = (l) => `${l.pid}|${l.vid}|${l.gift || 'none'}`;
  const lineInfo = (l) => {
    const p = S.product(l.pid);
    const v = p.variants.find((x) => x.id === l.vid) || p.variants[0];
    const g = giftOf(l.gift);
    const unit = v.price + giftFee(g);
    return { p, v, g, unit, total: unit * l.qty };
  };
  const totals = () => {
    const sub = cart.reduce((s, l) => s + lineInfo(l).total, 0);
    const count = cart.reduce((s, l) => s + l.qty, 0);
    const ship = sub === 0 || alwaysFree() || sub >= settings().freeShipOver ? 0 : settings().shipFee;
    return { sub, count, ship, total: sub + ship };
  };
  const preorderLines = () => cart.filter((l) => S.product(l.pid).options.preorder);
  const hasPreorder = () => preorderLines().length > 0;
  const mixedPreorder = () => hasPreorder() && cart.some((l) => !S.product(l.pid).options.preorder);
  const preorderShip = () => { const l = preorderLines()[0]; return l ? S.product(l.pid).ship : ''; };
  const variantName = (p, v) => (p.variants.length > 1 ? `${p.name} ${v.label}` : p.name);

  function addToCart(pid, vid, qty = 1, gift = 'none') {
    const p = S.product(pid);
    const v = p && p.variants.find((x) => x.id === vid);
    if (!S.isVisible(p) || !v || S.variantSoldOut(p, v)) { toast('申し訳ありません。この商品は売り切れです。'); return; }
    const cap = S.maxFor(p, v);
    const key = lineKey({ pid, vid, gift });
    const found = cart.find((l) => lineKey(l) === key);
    const before = found ? found.qty : 0;
    if (found) found.qty = Math.min(cap, found.qty + qty);
    else cart.push({ pid, vid, gift, qty: Math.min(cap, qty) });
    const added = cart.find((l) => lineKey(l) === key).qty - before;
    commit();
    const capMsg = v.stock !== null && cap < settings().maxQty ? `在庫は残り${v.stock}点です` : `同じ商品は${cap}点までです`;
    if (added === 0) { toast(`1回のご注文で、${capMsg}。`); return; }
    toast(added < qty ? `「${variantName(p, v)}」を${added}点追加しました（${capMsg}）` : `「${variantName(p, v)}」をカートに追加しました`, { action: 'カートを見る', onAction: openDrawer });
    const c = $('#cartCount');
    c.classList.remove('is-bump'); void c.offsetWidth; c.classList.add('is-bump');
  }
  function setQty(key, qty) {
    const l = cart.find((x) => lineKey(x) === key);
    if (!l) return;
    const { p, v } = lineInfo(l);
    l.qty = Math.max(1, Math.min(S.maxFor(p, v), qty));
    commit();
  }
  function removeLine(key) {
    const l = cart.find((x) => lineKey(x) === key);
    cart = cart.filter((x) => lineKey(x) !== key);
    commit();
    if (l) announce(`「${variantName(S.product(l.pid), lineInfo(l).v)}」をカートから削除しました`);
  }
  function refreshCartViews() {
    renderCount();
    if (!$('#cartDrawer').hidden) renderDrawer();
    if (!IS_SHOP) return;
    if (currentRoute === 'cart' || currentRoute === 'checkout-confirm') renderRoute();
    else if (currentRoute === 'checkout') { const f = $('#checkoutForm'); if (f) collect(f); renderRoute(); }
  }
  function commit() {
    const a = document.activeElement;
    const inDrawer = !!(a && a.closest && a.closest('#cartDrawer'));
    const sel = a && a.dataset && a.dataset.qty ? `[data-qty="${CSS.escape(a.dataset.qty)}"][data-delta="${a.dataset.delta}"]` : null;
    S.saveCart(cart);
    refreshCartViews();
    // put focus back only if the focused control was re-rendered away
    if (a && a !== document.body && !a.isConnected) {
      const scope = inDrawer ? $('#cartDrawer') : view();
      const next = (sel && scope && $(sel, scope)) || (inDrawer ? $('#cartClose') : view() && $('[data-page-focus]', view()));
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
    const cap = S.maxFor(p, v);
    const opts = [
      p.variants.length > 1 ? v.label : '',
      g.id !== 'none' ? `${g.label}（+¥${yen(giftFee(g))}）` : '',
      p.options.preorder ? `予約・${p.when || p.ship}` : '',
    ].filter(Boolean).join(' ／ ');
    return `
      <div class="line">
        <a class="line__img" href="${esc(itemHref(p.id))}" tabindex="-1" aria-hidden="true">${visualHTML(p)}</a>
        <div class="line__info">
          <p class="line__name"><a href="${esc(itemHref(p.id))}">${esc(p.name)}</a></p>
          ${opts ? `<p class="line__opt">${esc(opts)}</p>` : ''}
          <div class="line__ctrl">
            <div class="qty qty--sm" role="group" aria-label="${esc(p.name)}の数量">
              <button type="button" data-qty="${key}" data-delta="-1" aria-label="1つ減らす" ${l.qty <= 1 ? 'aria-disabled="true"' : ''}>−</button>
              <output>${l.qty}</output>
              <button type="button" data-qty="${key}" data-delta="1" aria-label="1つ増やす" ${l.qty >= cap ? 'aria-disabled="true"' : ''}>＋</button>
            </div>
            <button class="line__remove" type="button" data-remove="${key}" aria-label="${esc(p.name)}をカートから削除">削除</button>
          </div>
        </div>
        <div class="line__price">${priceHTML(total, { tax: false })}</div>
      </div>`;
  }
  function freeShipHTML(sub) {
    const over = settings().freeShipOver;
    if (alwaysFree() || sub >= over) return `<p class="free-ship">送料無料でお届けします。<span class="free-ship__bar"><i style="width:100%"></i></span></p>`;
    return `<p class="free-ship">送料無料まで、あと <b>¥${yen(over - sub)}</b> です。<span class="free-ship__bar"><i style="width:${Math.round((sub / over) * 100)}%"></i></span></p>`;
  }
  function summaryHTML(t) {
    return `
      <dl class="summary">
        <div><dt>商品小計</dt><dd>¥${yen(t.sub)}</dd></div>
        <div><dt>送料</dt><dd>${t.ship === 0 ? '無料' : '¥' + yen(t.ship)}</dd></div>
        <div class="summary__total"><dt>合計（税込）</dt><dd>${priceHTML(t.total, { tax: false })}</dd></div>
      </dl>`;
  }
  const preorderNotice = () => (mixedPreorder()
    ? `<p class="notice"><b>お届けについて</b>予約商品とご一緒のご注文は、予約商品の発送（${esc(preorderShip())}）にあわせてまとめてお届けします。先にお届けしたい商品は、別々にご注文ください。</p>`
    : '');
  const emptyHTML = (msg = 'カートに商品は入っていません。') => `
    <div class="empty">
      <span class="empty__moon" aria-hidden="true"></span>
      <p>${msg}</p>
      <a class="btn btn--line btn--sm" href="${shopHref('')}">商品一覧を見る</a>
    </div>`;
  function renderDrawer() {
    const t = totals();
    $('#drawerBody').innerHTML = cart.length ? preorderNotice() + cart.map(lineHTML).join('') : emptyHTML();
    $('#drawerFoot').innerHTML = cart.length
      ? `${freeShipHTML(t.sub)}${summaryHTML(t)}
         <a class="btn btn--gold btn--block" href="${shopHref('checkout')}">ご購入手続きへ</a>
         <p class="drawer__links"><a href="${shopHref('cart')}">カートの詳細を見る</a></p>`
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
  $('#toast').addEventListener('mouseenter', () => clearTimeout(toastTimer));
  $('#toast').addEventListener('focusin', () => clearTimeout(toastTimer));
  $('#toast').addEventListener('mouseleave', armToast);
  $('#toast').addEventListener('focusout', armToast);

  const pageHead = (title, crumbs, extra = '', cls = '') => `
    <div class="page-head${title ? '' : ' page-head--compact'}${cls ? ' ' + cls : ''}">
      <div class="container">
        <nav aria-label="現在地"><ol class="crumbs">${crumbs.map(([t, h]) => `<li>${h ? `<a href="${esc(h)}">${esc(t)}</a>` : `<span aria-current="page">${esc(t)}</span>`}</li>`).join('')}</ol></nav>
        ${title ? `<h1 class="page-title" tabindex="-1" data-page-focus>${esc(title)}</h1>` : ''}
        ${extra}
      </div>
    </div>`;

  /* =========================================================
     HOME (index.html)
     ========================================================= */
  function renderHome() {
    const grid = $('#productGrid');
    if (grid) {
      const visible = S.visibleProducts();
      const featured = visible.filter((p) => p.featured);
      const list = (featured.length ? featured : visible).slice(0, 4);
      grid.innerHTML = list.map((p) => cardHTML(p, { href: itemHref })).join('');
      grid.dataset.count = String(list.length);
    }
    const news = $('#heroNews');
    if (news) {
      const n = settings().news;
      const target = n.link && S.product(n.link);
      news.hidden = !n.show || !n.text;
      news.href = S.isVisible(target) ? itemHref(target.id) : shopHref('');
      $('#heroNewsText').textContent = n.text;
    }
    $$('[data-ship-text]').forEach((el) => { el.textContent = shipText(); });
    const eb = $('#eventBanner');
    if (eb) { eb.innerHTML = eventBannerHTML(); eb.hidden = !eb.innerHTML.trim(); }
  }

  /* ---------- 高輪 event (期間限定) ---------- */
  const fmtDate = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${+m[2]}月${+m[3]}日` : ''; };
  function eventBannerHTML() {
    const e = settings().event;
    if (!S.eventActive(e)) return '';
    return `
      <a class="event-banner" href="${esc(shopHref(e.slug))}">
        <span class="event-banner__img" aria-hidden="true"></span>
        <span class="event-banner__text">
          <small>${e.date ? `${esc(fmtDate(e.date))} 開催` : '期間限定'}</small>
          <b>${esc(e.title)}</b>
        </span>
        <span class="event-banner__go">ご案内を見る<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></span>
      </a>`;
  }
  function renderEvent(e) {
    const active = S.eventActive(e);
    const before = e.enabled && e.start && S.today() < e.start;
    if (active && !new URLSearchParams(location.search).has('preview')) S.markEventVisit(e.slug);
    const list = e.products.map((id) => S.product(id)).filter((p) => S.isVisible(p));
    view().innerHTML = `
      <section class="event-hero" aria-labelledby="evTitle">
        <div class="container">
          <nav aria-label="現在地"><ol class="crumbs"><li><a href="index.html">トップ</a></li><li><a href="#">オンラインショップ</a></li><li><span aria-current="page">イベントのご案内</span></li></ol></nav>
          <p class="eyebrow"><span lang="en">Event</span>${e.date ? `<span class="eyebrow__jp">${esc(fmtDate(e.date))} 開催</span>` : ''}</p>
          <h1 class="event-hero__title" id="evTitle" tabindex="-1" data-page-focus>${esc(e.title)}</h1>
          ${active && e.lead ? `<p class="event-hero__lead">${esc(e.lead)}</p>` : ''}
        </div>
        <p class="photo-note">写真はイメージです</p>
      </section>
      <div class="page-body">
        <div class="container">
          ${active ? `
          <ol class="event-steps" aria-label="ご注文の流れ">
            <li><span class="num">1</span><p><b>QRコードを読み込む</b><span>このページが開きます。</span></p></li>
            <li><span class="num">2</span><p><b>お米を選んでご注文</b><span>スマートフォンから、そのままご注文いただけます。</span></p></li>
            <li><span class="num">3</span><p><b>ご自宅にお届け</b><span>${esc(e.shipNote)}</span></p></li>
          </ol>
          ${list.length ? `
          <h2 class="event-sec">イベントでご案内しているお米</h2>
          <div class="product-grid" data-count="${list.length}">${list.map((p) => cardHTML(p.options.preorder ? p : { ...p, when: '' }, { href: itemHref })).join('')}</div>` : ''}
          <p class="notice event-note"><b>お届けについて</b>${esc(e.shipNote)}重たいお米も、ご自宅まで直接お届けします。</p>
          <p class="event-more"><a class="btn btn--line" href="#">ほかの商品も見る</a></p>` : `
          <div class="empty">
            <span class="empty__moon" aria-hidden="true"></span>
            <p>${!e.enabled ? 'このページは現在公開していません。' : before ? `このページは${esc(fmtDate(e.start))}から公開します。` : 'このページの公開は終了しました。'}満月米は、オンラインショップでいつでもご購入いただけます。</p>
            <a class="btn btn--line btn--sm" href="#">オンラインショップへ</a>
          </div>`}
        </div>
      </div>`;
  }

  /* =========================================================
     SHOP (shop.html)
     ========================================================= */
  let listSort = 'recommend';
  function renderList(catId) {
    const all = S.visibleProducts();
    const cats = S.catalog().categories.filter((c) => all.some((p) => p.category === c.id));
    const cat = catId ? cats.find((c) => c.id === catId) : null;
    let items = cat ? all.filter((p) => p.category === cat.id) : all.slice();
    const order = new Map(all.map((p, i) => [p.id, i]));
    items.sort((a, b) => {
      const so = Number(S.productSoldOut(a)) - Number(S.productSoldOut(b));
      if (so) return so;
      if (listSort === 'price-asc') return S.minPrice(a) - S.minPrice(b);
      if (listSort === 'price-desc') return S.minPrice(b) - S.minPrice(a);
      return order.get(a.id) - order.get(b.id);
    });
    const s = settings();
    const crumbs = cat ? [['トップ', 'index.html'], ['オンラインショップ', '#'], [cat.name]] : [['トップ', 'index.html'], ['オンラインショップ']];
    view().innerHTML = `
      ${pageHead(cat ? cat.name : 'オンラインショップ', crumbs, `<p class="page-lead">北海道士別市上士別町の満月農園から、ご自宅へ直接お送りします。</p><p class="photo-note">写真はイメージです</p>`, 'page-head--photo')}
      <div class="page-body">
        <div class="container">
          ${cat ? '' : eventBannerHTML()}
          <div class="shop-bar">
            <nav class="cat-tabs" aria-label="カテゴリ">
              <a href="#" ${!cat ? 'aria-current="page"' : ''}>すべて<span>${all.length}</span></a>
              ${cats.map((c) => `<a href="#category-${esc(c.id)}" ${cat && cat.id === c.id ? 'aria-current="page"' : ''}>${esc(c.name)}<span>${all.filter((p) => p.category === c.id).length}</span></a>`).join('')}
            </nav>
            <label class="sort">
              <span>並び順</span>
              <select class="select select--sm" id="sortSel">
                <option value="recommend" ${listSort === 'recommend' ? 'selected' : ''}>おすすめ順</option>
                <option value="price-asc" ${listSort === 'price-asc' ? 'selected' : ''}>価格の安い順</option>
                <option value="price-desc" ${listSort === 'price-desc' ? 'selected' : ''}>価格の高い順</option>
              </select>
            </label>
          </div>
          ${items.length ? `<div class="product-grid">${items.map((p) => cardHTML(p, { href: itemHref })).join('')}</div>`
            : '<div class="empty"><span class="empty__moon" aria-hidden="true"></span><p>このカテゴリの商品は、ただいま準備中です。</p></div>'}
          <aside class="shop-info" aria-label="お買いものについて">
            <div><h2>送料</h2><p>${shipText(s)}です（<span class="nw">沖縄・離島</span>は別途お見積もり）。</p></div>
            <div><h2>発送</h2><p>ご注文から3〜5営業日で発送します。予約商品は、各商品ページに記載の時期にお届けします。</p></div>
            <div><h2>お支払い</h2><p>クレジットカード（Stripeの決済画面でお支払い）。<a class="link" href="#guide">ご利用ガイド</a></p></div>
          </aside>
        </div>
      </div>`;
    $('#sortSel').addEventListener('change', (e) => { listSort = e.target.value; renderList(catId); $('#sortSel').focus(); });
  }

  /* ---------- product ---------- */
  let buyObserver = null;
  function renderProduct(p) {
    const gallery = [{ kind: 'main', label: '商品イメージ' }, ...p.gallery.map((g, i) => ({ kind: 'img', g, label: g.alt || `商品写真${i + 1}` }))];
    const media = (item) => (item.kind === 'main' ? visualHTML(p, { title: `${p.name}の商品イメージ`, alt: p.name }) : imageHTML(item.g));
    const variants = p.variants;
    const firstAvail = variants.find((v) => !S.variantSoldOut(p, v)) || variants[0];
    const soldOut = S.productSoldOut(p);
    const s = settings();
    const vis = S.visibleProducts().filter((x) => x.id !== p.id);
    const others = [...vis.filter((x) => x.category === p.category), ...vis.filter((x) => x.category !== p.category)].slice(0, 3);
    const award = p.options.award
      ? '米-1グランプリ in らんこし 2025 <span class="nw">金賞受賞</span>'
      : p.options.traits ? '米-1グランプリ in らんこし 2025 <span class="nw">金賞受賞農園</span>' : '';
    const per = p.options.subscription ? '1回' : '';
    const cat = S.category(p.category);
    const note = stockNote(p);
    const evShip = !p.options.preorder && eventOrder();

    view().innerHTML = `
      ${pageHead(null, [['トップ', 'index.html'], ['オンラインショップ', '#'], ...(cat ? [[cat.name, `#category-${cat.id}`]] : []), [p.name]])}
      <div class="page-body">
        <div class="container">
          <div class="pd">
            <div class="pd__gallery">
              ${p.options.award ? `<img class="pd__medal" src="${window.MangetsuUI.asset('assets/img/medal.webp')}" alt="" width="400" height="400">` : ''}
              <div class="pd__main" id="pdMain">${media(gallery[0])}</div>
              ${gallery.length > 1 ? `
              <div class="pd__thumbs" role="group" aria-label="商品画像を切り替える">
                ${gallery.map((g, i) => `<button class="pd__thumb" type="button" data-thumb="${i}" aria-pressed="${i === 0}" aria-label="${esc(g.label)}を表示">${g.kind === 'main' ? visualHTML(p) : imageHTML(g.g, '')}</button>`).join('')}
              </div>` : ''}
              <p class="pd__note">画像はイメージです</p>
            </div>

            <form class="pd__info" id="buyForm" novalidate>
              <div class="pd__head">
                ${award ? `<p class="pd__award">${award}</p>` : ''}
                <div class="pd__badges">
                  ${soldOut ? '<span class="badge badge--soldout">売り切れ</span>' : p.badge.text ? `<span class="badge${p.badge.line ? ' badge--line' : ''}">${esc(p.badge.text)}</span>` : ''}
                  <span class="p-card__meta">${esc(p.meta)}</span>
                </div>
                <h1 class="pd__name" tabindex="-1" data-page-focus>${esc(p.name)}</h1>
              </div>
              <p class="pd__lead">${jp(p.lead)}</p>
              <div class="pd__price" id="pdPrice">${priceHTML(firstAvail.price, { per })}</div>
              <p class="pd__ship">${p.options.preorder ? '<b>予約商品</b>　' : ''}${esc(evShip ? evShip.shipNote : p.ship)}${note ? `　<b>${esc(note)}</b>` : ''}<br>${shipText(s)}（<span class="nw">沖縄・離島</span>は別途お見積もり）</p>

              ${variants.length > 1 ? `
              <fieldset class="opt">
                <legend>${p.options.subscription ? 'お届け周期・内容量' : '種類・内容量'}</legend>
                <div class="chips">
                  ${variants.map((v) => { const out = S.variantSoldOut(p, v); return `
                    <label class="chip${out ? ' is-disabled' : ''}"><input type="radio" name="variant" value="${esc(v.id)}" ${v === firstAvail ? 'checked' : ''} ${out ? 'disabled' : ''}><span>${esc(v.label)}<small>${out ? '売り切れ' : `¥${yen(v.price)}${per ? '／1回' : ''}`}</small></span></label>`; }).join('')}
                </div>
              </fieldset>` : `<input type="hidden" name="variant" value="${esc(firstAvail.id)}">`}

              ${p.options.gift && !soldOut ? `
              <div class="field">
                <label class="field__label" for="giftSel">ギフト包装・のし</label>
                <select class="select" id="giftSel" name="gift">
                  ${GIFT_OPTIONS.map((g) => `<option value="${g.id}">${esc(g.label)}${g.paid ? `（+¥${yen(s.giftFee)}）` : ''}</option>`).join('')}
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
                  <button class="btn btn--gold" type="submit" id="buyBtn" ${soldOut ? 'disabled' : ''}>${soldOut ? '売り切れ' : `${ICON_BAG}${p.options.preorder ? '予約してカートに入れる' : 'カートに入れる'}`}</button>
                </div>
              </div>
              <p class="pd__sub">
                ${p.options.traits && p.category !== 'genmai' ? '<a href="index.html#furusato"><span>ふるさと納税で選ぶ</span></a>' : ''}
                <a href="#guide"><span>送料・お届けについて</span></a>
              </p>
            </form>
          </div>

          ${soldOut ? '' : `
          <div class="buybar" id="buyBar" hidden>
            <div id="buyBarPrice"></div>
            <button class="btn btn--gold" type="submit" form="buyForm">${ICON_BAG}${p.options.preorder ? '予約してカートへ' : 'カートに入れる'}</button>
          </div>`}

          <section class="spec${p.options.traits ? '' : ' spec--single'}" aria-labelledby="specTitle">
            <div>
              <h2 id="specTitle">商品情報</h2>
              ${p.specs.length ? `
              <div class="table-wrap">
                <table class="spec-table"><tbody>
                  ${p.specs.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
                </tbody></table>
              </div>` : '<p class="pending">商品情報は準備中です。</p>'}
            </div>
            ${p.options.traits ? `
            <div>
              <h2>ななつぼしの特徴</h2>
              <ul class="spec__points">
                <li><img src="assets/svg/icon-onigiri.svg" alt=""><p><b>冷めてもおいしい</b><span>お弁当やおにぎりでも、おいしさが長続きします。</span></p></li>
                <li><img src="assets/svg/icon-ears.svg" alt=""><p><b>甘みのバランス</b><span>甘さが控えめで、さっぱりとした口当たりです。</span></p></li>
                <li><img src="assets/svg/icon-sparkle.svg" alt=""><p><b>穏やかな香り</b><span>主張が少なく、おかずの香りを邪魔しません。</span></p></li>
                <li><img src="assets/svg/icon-bowl.svg" alt=""><p><b>粒立ちが良い</b><span>コシがあり、しっかりとした食感です。</span></p></li>
              </ul>
            </div>` : ''}
          </section>

          ${others.length ? `
          <section class="related" aria-labelledby="relTitle">
            <h2 id="relTitle">ほかの商品</h2>
            <div class="product-grid">${others.map((x) => cardHTML(x, { href: itemHref })).join('')}</div>
          </section>` : ''}
        </div>
      </div>`;

    // gallery
    const thumbs = $$('.pd__thumb', view());
    thumbs.forEach((b) => b.addEventListener('click', () => {
      $('#pdMain').innerHTML = media(gallery[+b.dataset.thumb]);
      thumbs.forEach((t) => t.setAttribute('aria-pressed', String(t === b)));
    }));
    if (soldOut) { $$('[data-step]', view()).forEach((b) => b.setAttribute('aria-disabled', 'true')); return; }

    // qty + price
    const form = $('#buyForm');
    let qty = 1;
    const current = () => { const vid = new FormData(form).get('variant'); return variants.find((x) => x.id === vid) || firstAvail; };
    const update = () => {
      const v = current();
      const cap = S.maxFor(p, v);
      qty = Math.max(1, Math.min(qty, cap));
      const g = giftOf(form.gift ? form.gift.value : 'none');
      const unit = v.price + giftFee(g);
      const notes = [qty > 1 ? `¥${yen(unit)} × ${qty}` : '', giftFee(g) ? `ギフト包装 ¥${yen(giftFee(g))} を含む` : ''].filter(Boolean).join('・');
      $('#pdPrice').innerHTML = priceHTML(unit * qty, { per }) + (notes ? `<span class="price__tax">（${notes}）</span>` : '');
      $('#buyBarPrice').innerHTML = priceHTML(unit * qty, { per });
      $('#pdQty').textContent = qty;
      $('[data-step="-1"]', form).setAttribute('aria-disabled', String(qty <= 1));
      $('[data-step="1"]', form).setAttribute('aria-disabled', String(qty >= cap));
    };
    $$('[data-step]', form).forEach((b) => b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      qty = Math.max(1, Math.min(S.maxFor(p, current()), qty + +b.dataset.step));
      update();
      announce(`数量 ${qty}`);
    }));
    form.addEventListener('change', update);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      addToCart(p.id, fd.get('variant'), qty, fd.get('gift') || 'none');
      update();
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
      ${pageHead('カート', [['トップ', 'index.html'], ['オンラインショップ', '#'], ['カート']], stepsBar(0))}
      <div class="page-body">
        <div class="container">
          ${cart.length ? `
          <div class="cart-page">
            <div>${preorderNotice()}${cart.map(lineHTML).join('')}
              <p class="cart-page__more"><a class="link" href="#">買いものを続ける</a></p>
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
    return `<ol class="steps-bar" aria-label="ご購入の手順">${steps.map((st, i) => `
      <li class="${i < active ? 'is-done' : ''}" ${i === active ? 'aria-current="step"' : ''}>${phaseSVG(i + 1)}<span>${st}</span></li>`).join('')}</ol>`;
  }

  /* ---------- checkout ---------- */
  const PREFS = '北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県'.split(' ');
  // card payment through Stripe (the only method agreed for launch)
  const PAYMENTS = [
    { id: 'card', label: 'クレジットカード', note: 'ご注文の確定後、Stripe（ストライプ）の決済画面でお支払いいただきます', timing: 'ご注文の確定時に、Stripeの決済画面でお支払い' },
  ];
  const payNote = (pm) => pm.note;
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

  function orderPanel() {
    const t = totals();
    return `
      <aside class="panel" aria-label="ご注文内容">
        <p class="panel__title">ご注文内容</p>
        <div>${cart.map((l) => { const { p, v, g, total } = lineInfo(l); return `
          <div class="mini-line"><span class="line__img" aria-hidden="true">${visualHTML(p)}</span>
          <span class="mini-line__name">${esc(p.name)}<small>${[p.variants.length > 1 ? v.label : '', g.id !== 'none' ? g.label : ''].filter(Boolean).map(esc).join('／')} <span class="nw">× ${l.qty}</span></small></span>
          ${priceHTML(total, { tax: false })}</div>`; }).join('')}
        </div>
        ${summaryHTML(t)}
        <p class="drawer__links"><a href="#cart">カートに戻る</a></p>
      </aside>`;
  }
  const payTotal = () => `<p class="pay-total" id="payTotal"><span>お支払い合計（税込）</span>${priceHTML(totals().total, { tax: false })}</p>`;
  // orders placed after arriving from the event page (QR code at the venue)
  const eventOrder = () => {
    const src = S.eventSource();
    const e = settings().event;
    return src && e && e.slug === src && S.eventActive(e) ? e : null;
  };

  function renderCheckout() {
    if (!cart.length) {
      view().innerHTML = `${pageHead('ご購入手続き', [['トップ', 'index.html'], ['オンラインショップ', '#'], ['ご購入手続き']])}<div class="page-body"><div class="container">${emptyHTML()}</div></div>`;
      return;
    }
    const dates = dateOptions();
    const pre = hasPreorder();
    const ev = eventOrder();
    view().innerHTML = `
      ${pageHead('お客様情報の入力', [['トップ', 'index.html'], ['カート', '#cart'], ['お客様情報']], stepsBar(1))}
      <div class="page-body">
        <div class="container">
          <div class="checkout">
            <form id="checkoutForm" novalidate>
              <p class="notice checkout__notice"><b>デモサイトです</b>入力した内容は、このブラウザの中にだけ保存されます（管理画面の注文一覧に表示されます）。どこにも送信されず、実際の注文・決済も行われません。</p>

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
                  ${pre ? `<p class="field__hint field--full">予約商品を含むため、予約商品の発送（${esc(preorderShip())}）にあわせてお届けします。日付のご指定はできません。</p>` : ev ? `<p class="field__hint field--full">${esc(ev.shipNote)}日付のご指定はできません。</p>` : `
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
                <input type="hidden" name="pay" value="card">
                <div class="pay-card">
                  <svg viewBox="0 0 32 24" aria-hidden="true"><rect x="1" y="1" width="30" height="22" rx="3" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M1 7h30" stroke="currentColor" stroke-width="3"/><path d="M5 17h8" stroke="currentColor" stroke-width="1.2"/></svg>
                  <p><b>クレジットカード</b><span>ご注文の確定後、Stripe（ストライプ）の決済画面でカード情報を入力してお支払いいただきます。カード情報は当店には保存されません。</span></p>
                </div>
                <p class="field__hint">デモサイトのため、決済画面には移動しません。</p>
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
    const ev = eventOrder();
    const teiki = cart.filter((l) => S.product(l.pid).options.subscription);
    const rows = [
      ['ご注文者さま', `${esc(draft.name1)} ${esc(draft.name2)}（${esc(draft.kana1)} ${esc(draft.kana2)}）`],
      ['ご住所', addr(draft.zip, draft.pref, draft.addr1, draft.addr2)],
      ['電話番号', esc(draft.tel)],
      ['メールアドレス', esc(draft.email)],
      ['お届け先', draft.giftTo ? `${esc(draft.sname)} さま<br>${addr(draft.szip, draft.spref, draft.saddr1, draft.saddr2)}<br>${esc(draft.stel)}` : 'ご注文者さまと同じ'],
      ...(hasGift() ? [['のしの名入れ', draft.noshiName ? esc(draft.noshiName) : 'なし']] : []),
      ['お届け時期', pre ? `${esc(preorderShip())}（予約商品の発送にあわせてお届け）` : ev ? esc(ev.shipNote) : 'ご注文から3〜5営業日で発送'],
      ['お届け日時', `希望日：${pre || ev ? '指定なし' : esc(draft.date || '最短でお届け')}／時間帯：${esc(draft.time || '指定なし')}`],
      ['お支払い方法', esc(pay.label)],
      ['お支払い時期', esc(pay.timing)],
      ['キャンセル・返品', 'ご注文確定後のキャンセル：（準備中）<br>食品のため、お客様のご都合による返品・交換はお受けできません（<a class="link" href="#guide">ご利用ガイド</a>）'],
      ['備考', draft.memo ? esc(draft.memo).replace(/\n/g, '<br>') : 'なし'],
    ];
    const teikiNote = teiki.map((l) => { const { v, total } = lineInfo(l); return `${esc(v.label)}${l.qty > 1 ? ` × ${l.qty}` : ''}・1回あたり¥${yen(total)}（税込）`; }).join('<br>');
    view().innerHTML = `
      ${pageHead('ご注文内容の確認', [['トップ', 'index.html'], ['カート', '#cart'], ['お客様情報', '#checkout'], ['ご確認']], stepsBar(2))}
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
      const t = totals();
      const saved = S.addOrder({
        no, at: d.toISOString(), status: 'new',
        customer: { name: `${draft.name1} ${draft.name2}`, kana: `${draft.kana1} ${draft.kana2}`, tel: draft.tel, email: draft.email, zip: draft.zip, address: `${draft.pref}${draft.addr1}${draft.addr2 ? ' ' + draft.addr2 : ''}` },
        shipTo: draft.giftTo ? { name: draft.sname, zip: draft.szip, address: `${draft.spref}${draft.saddr1}${draft.saddr2 ? ' ' + draft.saddr2 : ''}`, tel: draft.stel } : null,
        items: cart.map((l) => { const { p, v, g, unit, total } = lineInfo(l); return { pid: p.id, name: p.name, variant: p.variants.length > 1 ? v.label : '', gift: g.id !== 'none' ? g.label : '', qty: l.qty, unit, total }; }),
        subtotal: t.sub, ship: t.ship, total: t.total,
        source: ev ? ev.slug : '', sourceName: ev ? ev.title : '',
        pay: pay.label, date: pre || ev ? '' : draft.date || '', time: draft.time || '', noshi: draft.noshiName || '', memo: draft.memo || '',
        preorder: pre,
      });
      if (!saved.ok) {
        placing = false; btn.disabled = false; btn.textContent = '注文を確定する';
        toast('ご注文を保存できませんでした（このブラウザの保存容量がいっぱいです）。もう一度お試しください。');
        return;
      }
      S.consumeStock(cart);
      lastOrder = { no, name: `${draft.name1} ${draft.name2}`, preorder: pre, mixed: mixedPreorder(), ship: preorderShip(), eventNote: ev ? ev.shipNote : '' };
      cart = []; draft = {};
      S.saveCart(cart);
      renderCount();
      location.hash = 'thanks';
    });
  }

  let lastOrder = null;
  function renderThanks() {
    view().innerHTML = `
      ${pageHead('ご注文完了', [['トップ', 'index.html'], ['ご注文完了']], stepsBar(3))}
      <div class="page-body">
        <div class="container">
          <div class="thanks">
            <img class="thanks__moon" src="assets/img/moon-sm.webp" alt="">
            ${lastOrder ? `
              <h2>ご注文ありがとうございました</h2>
              <p class="thanks__no">ご注文番号<b>${esc(lastOrder.no)}</b></p>
              <p>${esc(lastOrder.name)} さま、ご注文を承りました。${lastOrder.preorder ? (lastOrder.mixed ? `ご注文の商品は、予約商品の発送（${esc(lastOrder.ship)}）にあわせてまとめてお届けします。` : `予約商品は、${esc(lastOrder.ship)}。`) : lastOrder.eventNote ? esc(lastOrder.eventNote) : '準備が整いしだい発送いたします。'}</p>
              <p class="notice">デモサイトのため、確認メールの送信や実際の発送は行われません。</p>`
            : `<h2>ご注文番号を表示できません</h2><p>ご注文の手続きが済むと、この画面にご注文番号が表示されます。ページを開き直した場合は表示されません。</p>`}
            <div class="thanks__actions">
              <a class="btn btn--line" href="#">買いものを続ける</a>
              <a class="btn btn--line" href="index.html">トップへ戻る</a>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* ---------- guide ---------- */
  function renderGuide() {
    const pend = '<span class="pending">（準備中）</span>';
    const s = settings();
    view().innerHTML = `
      ${pageHead('ご利用ガイド', [['トップ', 'index.html'], ['オンラインショップ', '#'], ['ご利用ガイド']])}
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
                  <li><i>02</i><b>お客様情報</b><span>お名前・ご住所・お届け先を入力します。</span></li>
                  <li><i>03</i><b>ご確認・お支払い</b><span>ご注文内容を確かめて注文を確定し、Stripeの決済画面からクレジットカードでお支払いいただきます。</span></li>
                  <li><i>04</i><b>お届け</b><span>士別市の満月農園から、常温便でお届けします。</span></li>
                </ol>
              </section>
              <section class="guide__sec" id="g-pay">
                <h2>お支払い</h2>
                <ul class="dots">
                  ${PAYMENTS.map((p) => `<li>${p.label}　<span class="pending">${payNote(p)}</span></li>`).join('')}
                </ul>
              </section>
              <section class="guide__sec" id="g-ship">
                <h2>送料・お届け</h2>
                <div class="table-wrap"><table class="spec-table"><tbody>
                  <tr><th scope="row">送料</th><td>${shipText(s)}<br><span class="pending">沖縄・離島は別途お見積もりとなります</span></td></tr>
                  <tr><th scope="row">配送方法</th><td>常温便</td></tr>
                  <tr><th scope="row">発送時期</th><td>通常商品：ご注文から3〜5営業日で発送<br>予約商品：各商品ページに記載の時期に発送${S.eventActive(s.event) ? `<br>イベントページからのご注文：${esc(s.event.shipNote)}` : ''}</td></tr>
                  <tr><th scope="row">日時指定</th><td>ご注文日の4日後以降の日付と、時間帯をお選びいただけます（予約商品を含むご注文${S.eventActive(s.event) ? '・イベントページからのご注文' : ''}は日付指定不可）</td></tr>
                  <tr><th scope="row">ギフト包装・のし</th><td>1点につき${yen(s.giftFee)}円（御歳暮・御礼・内祝・無地）</td></tr>
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
                  <tr><th scope="row">商品代金以外の費用</th><td>送料、ギフト包装料（ご希望の場合）</td></tr>
                  <tr><th scope="row">お支払い方法</th><td>クレジットカード（Stripeによる決済）</td></tr>
                  <tr><th scope="row">お支払い時期</th><td>ご注文の確定時</td></tr>
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
     Router (shop only)
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

  function teardownPage() {
    if (buyObserver) { buyObserver.disconnect(); buyObserver = null; }
    document.body.classList.remove('has-buybar');
  }
  function renderRoute() {
    const id = hashId();
    if (id === 'main' && currentRoute) return;
    teardownPage();
    const p = id.startsWith('item-') ? S.product(id.slice(5)) : null;
    const ev = settings().event;
    if (ev && ev.slug && id === ev.slug) {
      renderEvent(ev);
      document.title = `${ev.title}｜${SITE}`;
      currentRoute = id;
    } else if (p && S.isVisible(p)) {
      renderProduct(p);
      document.title = `${p.name}｜${SITE}`;
      currentRoute = id;
    } else if (PAGES[id]) {
      PAGES[id].render();
      document.title = `${PAGES[id].title}｜${SITE}`;
      currentRoute = id;
    } else {
      const cat = id.startsWith('category-') ? id.slice(9) : '';
      const c = cat && S.category(cat);
      const shown = !!c && S.visibleProducts().some((x) => x.category === c.id);
      renderList(shown ? cat : '');
      document.title = shown ? `${c.name}｜${SITE}` : SITE;
      currentRoute = shown ? id : 'list';
    }
  }
  function onHashChange() {
    const prev = currentRoute;
    clearTimeout(toastTimer);
    $('#toast').hidden = true;
    closeDrawer();
    closeMenu();
    renderRoute();
    if (prev === currentRoute && prev !== null) return;
    const pg = PAGES[currentRoute];
    const st = history.state || {};
    if (typeof st.y === 'number') requestAnimationFrame(() => window.scrollTo({ top: st.y, behavior: 'instant' }));
    else if (pg && pg.anchor) requestAnimationFrame(() => { const t = document.getElementById(pg.anchor); if (t) t.scrollIntoView({ behavior: 'instant' }); });
    else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (prev !== null) {
      const h = $('[data-page-focus]', view());
      if (h) h.focus({ preventScroll: true });
    }
  }

  /* =========================================================
     Header / menu
     ========================================================= */
  const header = $('#siteHeader');
  function updateHeader() {
    const solid = IS_SHOP || window.scrollY > 24 || !$('#mobileNav').hidden;
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
  if (IS_SHOP && 'scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (IS_SHOP) window.addEventListener('pagehide', () => history.replaceState({ ...(history.state || {}), y: window.scrollY }, ''));

  document.addEventListener('click', (e) => {
    // skip link: move focus to the current content without routing
    const skip = e.target.closest('.skip-link');
    if (skip) {
      e.preventDefault();
      const t = (IS_SHOP && view() && $('[data-page-focus]', view())) || $('#main');
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

    const a = e.target.closest('a[href]');
    if (!a || a.dataset.jump) return;
    const href = a.getAttribute('href');
    if (a.closest('#cartDrawer')) closeDrawer();
    if (a.closest('#mobileNav')) closeMenu();
    if (!href.startsWith('#')) return;
    // remember the scroll position of the page being left, for Back
    history.replaceState({ ...(history.state || {}), y: window.scrollY }, '');
    const same = href === location.hash || (href === '#' && !location.hash);
    if (!same) return;
    e.preventDefault();
    closeMenu(); closeDrawer();
    if (!IS_SHOP) {
      const t = href.length > 1 && document.getElementById(href.slice(1));
      if (t) t.scrollIntoView({ behavior: smooth() }); else window.scrollTo({ top: 0, behavior: smooth() });
    } else {
      const pg = PAGES[currentRoute];
      const t = pg && pg.anchor && document.getElementById(pg.anchor);
      if (t) t.scrollIntoView({ behavior: 'instant' }); else window.scrollTo({ top: 0, behavior: 'instant' });
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

  // catalog / cart / orders changed in another tab (e.g. the admin screen)
  S.onChange((key) => {
    if (key === S.KEYS.orders) return;
    const before = cart;
    cart = S.loadCart();
    if (key !== S.KEYS.cart && before.length) {
      const lost = before.some((l) => !cart.some((x) => lineKey(x) === lineKey(l)));
      const cut = before.some((l) => { const x = cart.find((y) => lineKey(y) === lineKey(l)); return x && x.qty < l.qty; });
      if (lost || cut) { S.saveCart(cart); toast(lost ? '販売を終了した商品・売り切れの商品を、カートから外しました。' : '在庫に合わせて、カートの数量を変更しました。'); }
    }
    renderCount();
    if (!$('#cartDrawer').hidden) renderDrawer();
    if (!IS_SHOP) { renderHome(); return; }
    // another tab's cart edit only matters on the cart / checkout screens
    if (key === S.KEYS.cart && !/^(cart|checkout)/.test(currentRoute || '')) return;
    if (currentRoute === 'checkout') { const f = $('#checkoutForm'); if (f) collect(f); }
    const f = $('#buyForm');
    const keep = f && { v: new FormData(f).get('variant'), g: f.gift ? f.gift.value : '', q: Number(($('#pdQty') || {}).textContent) || 1 };
    const fid = document.activeElement && document.activeElement.id;
    const y = window.scrollY;
    renderRoute();
    window.scrollTo({ top: y, behavior: 'instant' });
    const nf = $('#buyForm');
    if (keep && nf) {
      const r = nf.querySelector(`input[name="variant"][value="${CSS.escape(keep.v || '')}"]:not(:disabled)`);
      if (r) r.checked = true;
      if (nf.gift && keep.g) nf.gift.value = keep.g;
      nf.dispatchEvent(new Event('change'));
      for (let i = 1; i < keep.q; i++) { const up = $('[data-step="1"]', nf); if (!up || up.getAttribute('aria-disabled') === 'true') break; up.click(); }
    }
    const back = fid && document.getElementById(fid);
    if (back) back.focus({ preventScroll: true });
  });

  /* =========================================================
     Occasional twinkles on the background stars
     A star from the tiled star backgrounds flares briefly every few
     seconds. Glints sit exactly on real stars and behind the content.
     ========================================================= */
  // [x, y, kind] per tile: kind 0 = dot, 1 = star / sparkle, 2 = burst
  const STAR_TILES = {"a":[[68,248,0],[70,481,0],[73,510,0],[82,463,0],[91,374,0],[139,101,0],[139,293,0],[141,194,0],[148,464,0],[155,285,0],[175,81,0],[176,328,0],[194,527,0],[196,307,0],[205,142,0],[208,307,0],[220,223,0],[250,525,0],[252,308,0],[268,100,0],[268,366,0],[278,446,0],[286,489,0],[326,509,0],[360,51,0],[370,510,0],[382,213,0],[409,173,0],[414,256,0],[416,48,0],[448,544,0],[460,159,0],[490,176,0],[514,299,0],[532,338,0],[549,454,0]],"b":[[118,843,1],[140,300,1],[190,905,0],[247,539,2],[273,418,1],[296,105,1],[335,601,0],[400,751,1],[441,236,0],[479,686,1],[500,904,2],[513,82,1],[557,454,0],[604,277,2],[619,760,0],[692,564,1],[735,905,1],[769,329,0],[858,678,1],[872,160,2],[908,436,0],[935,839,1]],"c":[[113,563,1],[143,1019,1],[195,256,1],[415,768,1],[440,134,1],[557,1162,1],[716,480,1],[808,853,1],[997,254,1],[1049,1003,1],[1147,616,1]]};
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
      ...(hero ? [{ el: () => hero, layer: $('.hero__sky'), tiles: [['b', 980, 0, 48], ['a', 560, 140, 60]] }] : []),
      { el: () => footer, layer: footLayer, tiles: [['b', 980, 200, 0]] },
    ];

    function candidates() {
      const vw = window.innerWidth, vh = window.innerHeight, top = 90;
      const covers = [hero, footer].filter(Boolean).map((el) => el.getBoundingClientRect());
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
    const COVERED = 'img, svg, .p-card, .award-ribbon, .furusato__box, .btn, .add-btn, .panel, .site-header, .badge, .pd__main, .pd__thumb, .line, .mini-line, .select, .input, .chip, .qty, .toast, .cat-tabs, .shop-info';
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
  renderCount();
  if (IS_SHOP) {
    window.addEventListener('hashchange', onHashChange);
    onHashChange();
  } else {
    // links saved from the single-page version (index.html#item-teiki etc.) move to the shop
    const id = hashId();
    if (/^(item-|category-|cart$|checkout|thanks$|guide)/.test(id)) { location.replace(`shop.html#${id}`); return; }
    renderHome();
    updateHeader();
  }
  initTwinkles();
})();
