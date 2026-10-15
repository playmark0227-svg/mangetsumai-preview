/* =========================================================
   満月米 — app.js
   トップページ（index.html）とオンラインショップ（shop.html）の動き。
   商品データは store.js、表示部品は ui.js。
   ショップはハッシュで画面を切り替える：
   一覧 / #category-<id> / #item-<id> / #cart / #checkout / #checkout-confirm / #thanks / #guide

   デモ（config.js の apiBase が空）：注文はこのブラウザに保存するだけで、決済はしない。
   本番（apiBase あり）：商品は API から読み込み、「注文を確定する」で Stripe の決済画面へ移動する。
     決済後は shop.html?session_id=…#thanks、取り消し時は shop.html?canceled=1#checkout-confirm に戻る。
     支払わずに戻ったとき（取り消し・ブラウザの「戻る」）と、次の決済画面を開く前には、
     前の決済画面を POST /api/checkout/cancel で無効にする（両方で支払われる二重請求を防ぐ）。
     開いた決済画面はブラウザ内の全タブで共有（localStorage の mangetsu.openSessions.v1）し、
     次の決済の前に、ほかのタブで開いたものも含めてすべて無効にする。ショップを開いたときは、
     ほかのタブで開いた決済画面が支払い済みになっていないかを確かめる（無効にはしない）。
     「注文を確定する」の手続き（前の決済画面を無効にする → 注文 → 一覧に載せる）は、ブラウザ内で
     1つのタブずつ行う（Web Locks。ない場合は localStorage の短い貸し出し）。
   ========================================================= */
(() => {
  'use strict';

  const S = window.MangetsuStore;
  const C = window.MangetsuCore;
  const API = window.MangetsuAPI;
  const LIVE = !!S.LIVE;
  const { esc, yen, priceHTML, ICON_BAG, phaseSVG, visualHTML, imageHTML, cardHTML, stockNote } = window.MangetsuUI;

  const PAGE = document.body.dataset.page;          // 'home' | 'shop'
  const IS_SHOP = PAGE === 'shop';
  const shopHref = (hash = '') => (IS_SHOP ? `#${hash}` : `shop.html${hash ? '#' + hash : ''}`);
  const itemHref = (id) => shopHref(`item-${id}`);
  const settings = () => S.catalog().settings;

  // live mode: set when the catalog could not be loaded (ordering is then blocked)
  let loadError = false;
  let booted = false;
  const LOAD_ERROR = '商品情報を読み込めませんでした。時間をおいて、ページを開き直してください。';

  /* ---------- shipping (送料表：お届け先の地域 × 重さ) ---------- */
  const PREFS = C.PREFS;
  const PREF_KEY = 'mangetsu.shipPref.v1';
  // prefecture picked for the cart's shipping estimate, remembered per browser
  let estPref = (() => { try { const v = localStorage.getItem(PREF_KEY); return PREFS.includes(v) ? v : ''; } catch { return ''; } })();
  function setEstPref(v) {
    estPref = PREFS.includes(v) ? v : '';
    try { if (estPref) localStorage.setItem(PREF_KEY, estPref); else localStorage.removeItem(PREF_KEY); } catch { /* ignore */ }
  }
  // cheapest / dearest single parcel in the table (for short "1箱670円〜" notes)
  const rateSpan = (s = settings()) => {
    const all = Object.values(s.ship.rates).flat();
    return { min: Math.min(...all), max: Math.max(...all) };
  };
  const yenRange = ({ min, max }) => (min === max ? `${yen(min)}円` : `${yen(min)}円〜${yen(max)}円`);
  const freeText = (s = settings()) => (s.ship.freeOver > 0 ? `税込${yen(s.ship.freeOver)}円以上のご注文は、送料無料でお届けします。` : '');
  // home FAQ ([data-ship-text])
  const shipText = (s = settings()) => `送料は、お届け先の地域とお米の重さで決まります（1箱${yenRange(rateSpan(s))}・税込）。${freeText(s)}`;
  // shipping for one unit of a variant, across all regions (free when that one unit already reaches freeOver)
  const unitShipText = (v) => {
    const ship = settings().ship;
    if (ship.freeOver > 0 && v.price >= ship.freeOver) return '送料無料';
    return yenRange(C.shippingRange([{ weight: v.weight, qty: 1 }], ship));
  };
  // 「送料（沖縄・2箱）」: shoppers see 箱 (the admin screen says 個口)
  const shipLabel = (q) => (q.region ? `送料（${[q.region.name, q.parcels.length > 1 ? `${q.parcels.length}箱` : ''].filter(Boolean).join('・')}）` : '送料');
  const parcelDetail = (q) => q.parcels.map((p) => `${p.kg}kg ${yen(p.fee)}円`).join('＋');

  // ギフト包装・のしは取り扱わない（2026-10 先方の指示）。項目を足せば復活できる
  const GIFT_OPTIONS = [
    { id: 'none', label: 'なし', paid: false },
  ];
  const giftFee = (g) => (g.paid ? settings().giftFee : 0);
  const giftOf = (id) => GIFT_OPTIONS.find((x) => x.id === (id || 'none')) || GIFT_OPTIONS[0];

  /* ---------- helpers ---------- */
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const smooth = () => (reduceMotion ? 'auto' : 'smooth');
  // keep a few words that phrase-breaking tends to split on one line
  const NOBR = /(ななつぼし|おにぎり|召し上がる|2026年12月上旬|ほたてエレガンス|たこ燻製)/g;
  const jp = (s) => esc(s).replace(NOBR, '<span class="nw">$1</span>');
  const view = () => $('#view');

  /* ---------- cart ---------- */
  // loaded at boot, once the catalog is ready (live mode fetches it first)
  let cart = [];
  const lineKey = (l) => `${l.pid}|${l.vid}|${l.gift || 'none'}`;
  // the goods in a cart as one text (pid|vid|qty of each line, sorted): the same goods give the same text
  const cartSig = (lines) => lines.map((l) => `${l.pid}|${l.vid}|${l.qty}`).sort().join(',');
  // Every tab keeps its own copy of the cart and saves it to this browser's storage (shared by all tabs).
  // cartStored: false while that save fails (storage full or blocked), so the stored copy says nothing.
  // seenPaidAt: paidAt() when this tab last read the cart (a later one: another tab saw an order paid since).
  let cartStored = true;
  let seenPaidAt = 0;
  const saveCart = (lines = cart) => { cartStored = !!S.saveCart(lines).ok; };
  function loadCart() {
    cart = S.loadCart();
    seenPaidAt = paidAt();
  }
  // the cart in storage is not the one this tab shows: another tab changed it (or saw an order paid),
  // and this tab missed it (a phone can suspend a background tab, which then misses storage events)
  const staleCart = () => cartStored && (cartSig(S.loadCart()) !== cartSig(cart) || paidAt() > seenPaidAt);
  const lineInfo = (l) => {
    const p = S.product(l.pid);
    const v = p.variants.find((x) => x.id === l.vid) || p.variants[0];
    const g = giftOf(l.gift);
    const unit = v.price + giftFee(g);
    return { p, v, g, unit, total: unit * l.qty };
  };
  // pref: destination prefecture. ship / total are null while it is unknown
  // (an order of 送料込みの商品 only has no shipping to pay: its ship is 0 even before the prefecture is known).
  // incl: names of the 送料込みの商品 in the cart. charged: 商品小計 of the goods that do pay shipping
  // (the free-shipping line counts only these)
  const totals = (pref = estPref) => {
    const sub = cart.reduce((s, l) => s + lineInfo(l).total, 0);
    const count = cart.reduce((s, l) => s + l.qty, 0);
    const quote = S.shippingFor(cart, pref);
    const ship = quote.fee;
    const inclLines = cart.filter((l) => S.product(l.pid).options.shipIncluded);
    const incl = [...new Set(inclLines.map((l) => S.product(l.pid).name))];
    const charged = sub - inclLines.reduce((s, l) => s + lineInfo(l).total, 0);
    return { sub, count, quote, ship, total: ship === null ? null : sub + ship, incl, charged };
  };
  // every item in the order is 送料込み: no shipping at all
  const allIncluded = (q) => q.included && !q.parcels.length;
  const preorderLines = () => cart.filter((l) => S.product(l.pid).options.preorder);
  const hasPreorder = () => preorderLines().length > 0;
  const mixedPreorder = () => hasPreorder() && cart.some((l) => !S.product(l.pid).options.preorder);
  const preorderShip = () => { const l = preorderLines()[0]; return l ? S.product(l.pid).ship : ''; };
  // goods a shopper can buy now: the shop's own list, and event-only goods while their event is on
  const onSale = () => S.visibleProducts().filter((p) => C.isListed(p) || S.eventSellable(p));
  // the guide mentions 予約商品 only while one is on sale
  const sellsPreorder = () => onSale().some((p) => p.options.preorder);
  const variantName = (p, v) => (p.variants.length > 1 ? `${p.name} ${v.label}` : p.name);

  /* ---------- event-only goods (イベント限定) ---------- */
  // 「高輪のイベント」 from the event title (「高輪のイベントにご来場の皆さまへ」); 「イベント」 when it has no such words
  const evName = (e = settings().event) => ((/^(.*?イベント)/.exec(e.title || '') || [])[1] || 'イベント');
  const thisGoods = (p) => (p.category === 'set' ? 'このセット' : 'この商品');
  // why an event-only product cannot be bought now (null when it can).
  // 「終了しました」 only once the event's last day has passed. Before it starts, while the event page is
  // turned off, or while the product is not on it yet: neutral wording (the start date only when it is
  // on sale from then: the event is on and lists it). soon: it will be sold on the event's terms
  function closedInfo(p) {
    if (S.eventSellable(p)) return null;
    const e = settings().event;
    const today = S.today();
    if (e.end && today > e.end) {
      return { head: '販売期間は終了しました。', text: `${thisGoods(p)}は、${evName(e)}期間中だけの販売でした。満月米は、オンラインショップでいつでもご購入いただけます。` };
    }
    const soon = !!(e.enabled && e.start && today < e.start && e.products.includes(p.id));
    return {
      head: `${thisGoods(p)}は、${evName(e)}期間中だけご購入いただけます。`,
      text: soon ? `${fmtDate(e.start)}から販売します。` : 'ただいまは、ご購入いただけません。満月米は、オンラインショップでいつでもご購入いただけます。',
      soon,
    };
  }
  const closedText = (names) => `${names.map((n) => `「${n}」`).join('')}は、イベント期間外のためご購入いただけません。カートから外しました。`;
  // event-only goods that can no longer be bought (the event ended while the page was open) leave the cart.
  // → the note for the shopper ('' when nothing changed)
  function dropClosed() {
    const gone = cart.filter((l) => !S.eventSellable(S.product(l.pid)));
    if (!gone.length) return '';
    cart = cart.filter((l) => !gone.includes(l));
    saveCart();
    if (!cart.length) keepOnlySession();
    renderCount();
    return closedText([...new Set(gone.map((l) => S.product(l.pid).name))]);
  }
  // an event-only product that can no longer be bought (S.loadCart leaves it out of the cart)
  const closedGoods = (p) => S.isVisible(p) && p.options.eventOnly && !S.eventSellable(p);
  // The cart was read again (at load, when the page is shown again, after another tab's change):
  // event-only goods whose event ended meanwhile were left out by S.loadCart. The stored cart is updated
  // (so they do not come back), and → the note for the shopper ('' when none).
  // shown: the lines this page showed before reading it (they count even when storage no longer has them)
  function closedInStore(shown = []) {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(S.KEYS.cart) || '[]'); } catch { raw = []; }
    if (!Array.isArray(raw)) raw = [];
    const of = (l) => l && S.product(l.pid);
    const gone = [...raw, ...shown].map(of).filter((p) => closedGoods(p) && !cart.some((x) => x.pid === p.id));
    if (!gone.length) return '';
    if (raw.some((l) => closedGoods(of(l)))) saveCart();
    return closedText([...new Set(gone.map((p) => p.name))]);
  }
  // tells the shopper about such goods, like closedToCart: the checkout screens go back to the cart page,
  // which lists them; the cart page (and the thanks page, which is about a finished order) keeps them for
  // the cart page; elsewhere a toast (the open drawer shows them itself: renderDrawer(note)).
  // → true when the page moves to the cart page
  function tellClosed(notes) {
    notes = [].concat(notes).filter(Boolean);
    if (!notes.length) return false;
    const route = IS_SHOP ? currentRoute || '' : '';
    if (/^checkout/.test(route)) {
      if (route === 'checkout') { const f = $('#checkoutForm'); if (f) collect(f); }
      closedNotes.push(...notes);
      location.replace('#cart');
      return true;
    }
    if (route === 'cart' || route === 'thanks') closedNotes.push(...notes);
    else if ($('#cartDrawer').hidden) toast(notes.join(''));
    return false;
  }

  function addToCart(pid, vid, qty = 1, gift = 'none') {
    if (loadError) { toast('商品情報を読み込めなかったため、ただいまご注文いただけません。ページを開き直してください。'); return; }
    const p = S.product(pid);
    const v = p && p.variants.find((x) => x.id === vid);
    if (!S.isVisible(p) || !v || S.variantSoldOut(p, v)) { toast('申し訳ありません。この商品は売り切れです。'); return; }
    const closed = closedInfo(p);
    if (closed) { toast(`${closed.head}${closed.text.split('。')[0]}。`); return; }
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
    saveCart();
    // the shopper emptied the cart: a checkout left on the Stripe page must not bring it back
    // (its session id is kept, so that Stripe page is still closed before the next checkout)
    if (!cart.length) keepOnlySession();
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
      p.options.shipIncluded ? '送料込み' : '',
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
  // progress towards free shipping; only when the shop offers it (settings.ship.freeOver > 0).
  // sub: 商品小計 of the goods that pay shipping (送料込みの商品 do not count).
  // incl: names of the 送料込みの商品 in the cart: the line says they are left out, since the 商品小計
  // shown below it includes them (the note under the totals names them)
  function freeShipHTML(sub, incl = []) {
    const over = settings().ship.freeOver;
    if (!(over > 0)) return '';
    if (sub >= over) return `<p class="free-ship">送料無料でお届けします。<span class="free-ship__bar"><i style="width:100%"></i></span></p>`;
    const note = incl.length ? '<small class="free-ship__note">送料込みの商品は、送料無料の金額に含みません。</small>' : '';
    return `<p class="free-ship">送料無料まで、あと <b>¥${yen(over - sub)}</b> です。${note}<span class="free-ship__bar"><i style="width:${Math.round((sub / over) * 100)}%"></i></span></p>`;
  }
  // unknown: what to show for 送料 while the prefecture is not chosen yet.
  // Without a prefecture there is no total, so the big number is labelled 商品小計（送料別）.
  // 送料込みの商品 together with goods that pay shipping: the fee is only for the others
  const inclNoteHTML = (t) => (t.quote.included && t.quote.parcels.length
    ? `<p class="summary-note">${esc(t.incl.join('・'))}は送料込みです。送料は、ほかの商品の分だけかかります。</p>` : '');
  function summaryHTML(t, { detail = false, unknown = 'お届け先により異なります' } = {}) {
    const q = t.quote;
    if (t.ship === null) {
      return `
      <dl class="summary">
        <div><dt>送料</dt><dd class="summary__tbd">${esc(unknown)}</dd></div>
        <div class="summary__total"><dt>商品小計<small>（税込・送料別）</small></dt><dd>${priceHTML(t.sub, { tax: false })}</dd></div>
      </dl>${inclNoteHTML(t)}`;
    }
    const parts = detail && !q.free && q.parcels.length > 1 ? `<small>${esc(parcelDetail(q))}</small>` : '';
    // every item is 送料込み: no fee at all, whatever the prefecture
    const fee = allIncluded(q) ? '¥0<small class="summary__incl">（送料込み）</small>' : t.ship === 0 ? '無料' : '¥' + yen(t.ship);
    // summary__sub: the row a short cart drawer leaves out (the 送料 row always stays)
    return `
      <dl class="summary">
        <div class="summary__sub"><dt>商品小計</dt><dd>¥${yen(t.sub)}</dd></div>
        <div><dt>${esc(allIncluded(q) ? '送料' : shipLabel(q))}${parts}</dt><dd>${fee}</dd></div>
        <div class="summary__total"><dt>合計（税込）</dt><dd>${priceHTML(t.total, { tax: false })}</dd></div>
      </dl>${inclNoteHTML(t)}`;
  }
  // the fee in words (for screen readers)
  const feeWords = (t) => (allIncluded(t.quote) ? '送料込みのため0円' : t.ship === 0 ? '無料' : `${yen(t.ship)}円`);
  // cart drawer / cart page: prefecture for the shipping estimate (not shown when everything is 送料込み)
  const shipEstHTML = (id) => `
    <div class="ship-est">
      <label class="ship-est__label" for="${id}">送料の目安<small>お届け先の都道府県</small></label>
      <select class="select select--sm" id="${id}" data-ship-pref>
        <option value="">選択してください</option>
        ${PREFS.map((p) => `<option ${p === estPref ? 'selected' : ''}>${p}</option>`).join('')}
      </select>
    </div>`;
  // the free-shipping line counts only the goods that pay shipping (none: no line)
  const sumHTML = (t) => `${t.quote.parcels.length ? freeShipHTML(t.charged, t.incl) : ''}${summaryHTML(t)}`;
  const estAnnounce = (t) => (t.ship === null ? '送料は、お届け先により異なります'
    : `${estPref && !allIncluded(t.quote) ? `${estPref}へお届けする場合、` : ''}送料は${feeWords(t)}、合計は${yen(t.total)}円です`);
  // a new estimate prefecture: refresh every open estimate (drawer, cart page, the guide's 送料表) in place
  function onEstPref(sel) {
    setEstPref(sel.value);
    const t = totals();
    $$('[data-ship-pref]').forEach((el) => { if (el !== sel) el.value = estPref; });
    $$('[data-sum]').forEach((el) => { el.innerHTML = sumHTML(t); });
    markMineRows();
    announce(estAnnounce(t));
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
  // note: event-only goods the cart lost when it was read again (closedInStore), shown with those dropped here
  function renderDrawer(note = '') {
    if (!booted) {
      $('#drawerBody').innerHTML = '<div class="empty"><span class="empty__moon" aria-hidden="true"></span><p>読み込んでいます…</p></div>';
      $('#drawerFoot').innerHTML = '';
      return;
    }
    const closed = [typeof note === 'string' ? note : '', dropClosed()].filter(Boolean).join('');
    const t = totals();
    $('#drawerBody').innerHTML = (closed ? `<p class="notice notice--warn" role="alert">${esc(closed)}</p>` : '')
      + (cart.length ? preorderNotice() + cart.map(lineHTML).join('') : emptyHTML());
    $('#drawerFoot').innerHTML = cart.length
      ? `${allIncluded(t.quote) ? '' : shipEstHTML('shipPrefDrawer')}
         <div class="sum-block" data-sum>${sumHTML(t)}</div>
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
      // event-only goods are shown on the event page (and in the event banner above), not here
      const listed = S.listedProducts();
      const featured = listed.filter((p) => p.featured);
      const list = (featured.length ? featured : listed).slice(0, 4);
      grid.innerHTML = list.map((p) => cardHTML(p, { href: itemHref })).join('');
      grid.dataset.count = String(list.length);
    }
    const news = $('#heroNews');
    if (news) {
      const n = settings().news;
      const target = n.link && S.product(n.link);
      news.hidden = !n.show || !n.text;
      // an event-only product is linked only while it is on sale
      news.href = S.isVisible(target) && (C.isListed(target) || S.eventSellable(target)) ? itemHref(target.id) : shopHref('');
      $('#heroNewsText').textContent = n.text;
    }
    $$('[data-ship-text]').forEach((el) => { el.textContent = shipText(); });
    const eb = $('#eventBanner');
    if (eb) { eb.innerHTML = eventBannerHTML(); eb.hidden = !eb.innerHTML.trim(); }
  }

  // live mode: the catalog could not be fetched. Shown above the products; ordering is blocked.
  const loadErrorHTML = () => `
    <div class="notice notice--warn load-error" role="alert">
      <b>${esc(LOAD_ERROR)}</b>
      <span>表示している商品・価格は最新ではない可能性があるため、ただいまご注文いただけません。</span>
      <button class="btn btn--line btn--sm" type="button" data-reload>ページを開き直す</button>
    </div>`;
  function showLoadError() {
    if (IS_SHOP) { noticeWrap().insertAdjacentHTML('afterbegin', loadErrorHTML()); return; }
    const grid = $('#productGrid');
    if (!grid) return;
    const box = document.createElement('div');
    box.className = 'load-error-wrap';
    box.innerHTML = loadErrorHTML();
    grid.before(box);
  }

  /* ---------- 高輪 event (期間限定) ---------- */
  const fmtDate = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${+m[2]}月${+m[3]}日` : ''; };
  // the event's own offers: event-only goods on its page that can be bought now (e.g. 北海道満喫セット)
  const eventDeals = (e) => e.products.map((id) => S.product(id))
    .filter((p) => S.isVisible(p) && p.options.eventOnly && S.eventSellable(p) && !S.productSoldOut(p));
  // the built-in flyer also comes as a 768px copy (…-sm.webp)
  const DEFAULT_FLYER = (C.DEFAULT_EVENT.banner && C.DEFAULT_EVENT.banner.src) || '';
  const flyerSm = (src) => (src && src === DEFAULT_FLYER ? src.replace(/\.webp$/, '-sm.webp') : src);
  const asset = window.MangetsuUI.asset;
  function eventBannerHTML() {
    const e = settings().event;
    if (!S.eventActive(e)) return '';
    // the set (or another event-only offer) is featured with a thumbnail of the flyer
    const deal = eventDeals(e)[0];
    const thumb = deal && (e.banner ? e.banner.src : deal.visual.kind === 'image' ? deal.visual.src : '');
    const price = deal && `¥${yen(S.minPrice(deal))}${deal.variants.length > 1 ? '〜' : ''}`;
    return `
      <a class="event-banner${deal ? ' event-banner--deal' : ''}" href="${esc(shopHref(e.slug))}">
        ${thumb ? `<span class="event-banner__img event-banner__img--flyer" aria-hidden="true"><img src="${esc(asset(flyerSm(thumb)))}" alt="" loading="lazy" decoding="async"></span>`
          : '<span class="event-banner__img" aria-hidden="true"></span>'}
        <span class="event-banner__text">
          <small>${e.date ? `${esc(fmtDate(e.date))} 開催` : '期間限定'}</small>
          <b>${esc(e.title)}</b>
          ${deal ? `<span class="event-banner__deal"><span class="event-banner__name">${esc(deal.name)}</span><span class="event-banner__price"><span class="nw">${price}</span><small>（税込${deal.options.shipIncluded ? '・送料込み' : ''}）</small></span><span class="event-banner__tag">イベント限定</span></span>` : ''}
        </span>
        <span class="event-banner__go">ご案内を見る<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></span>
      </a>`;
  }
  // the event's flyer (settings.event.banner), shown big at the top of the event page.
  // cls / sizes: the flyer inside the feature block (beside its purchase panel on wide screens)
  function flyerHTML(e, { cls = 'event-flyer', sizes = '(max-width: 1040px) 92vw, 960px' } = {}) {
    const b = e.banner;
    if (!b || !b.src) return '';
    const sm = flyerSm(b.src);
    const img = sm !== b.src
      ? `<img src="${esc(asset(sm))}" srcset="${esc(asset(sm))} 768w, ${esc(asset(b.src))} 1536w" sizes="${sizes}" width="1536" height="1024" alt="${esc(b.alt)}" decoding="async">`
      : `<img src="${esc(asset(b.src))}" alt="${esc(b.alt)}" decoding="async">`;
    return `<figure class="${cls}">${img}<figcaption class="photo-note">画像はイメージです</figcaption></figure>`;
  }
  // The event's own offer (北海道満喫セット) where the flyer is: one block of the flyer and a purchase panel,
  // instead of the flyer and then the same flyer again on the set's card. Only with a flyer and an event-only
  // product that can be bought now (eventDeals); otherwise the page keeps the flyer + cards layout.
  // A product with several variants is chosen on its own page (like 「選んで購入」 on the cards)
  function featureHTML(e, p) {
    const multi = p.variants.length > 1;
    const v = p.variants.find((x) => !S.variantSoldOut(p, x)) || p.variants[0];
    const note = stockNote(p);
    const badges = [
      p.badge.text ? `<span class="badge${p.badge.line ? ' badge--line' : ''}">${esc(p.badge.text)}</span>` : '',
      p.badge.text.includes('イベント限定') ? '' : '<span class="badge">イベント限定</span>',
    ].join('');
    const per = p.options.subscription ? '1回' : '';
    const buy = multi
      ? `<a class="btn btn--gold btn--block" href="${esc(itemHref(p.id))}" aria-label="${esc(p.name)}の内容を選んで購入">内容を選んで購入</a>`
      : `
          <div class="ev-feature__buy">
            <div class="qty" role="group" aria-label="${esc(p.name)}の数量">
              <button type="button" data-step="-1" aria-label="1つ減らす">−</button>
              <output id="evQty">1</output>
              <button type="button" data-step="1" aria-label="1つ増やす">＋</button>
            </div>
            <button class="btn btn--gold" type="submit" id="evBuyBtn" data-variant="${esc(v.id)}" aria-label="${esc(p.name)}をカートに入れる">${ICON_BAG}カートに入れる</button>
          </div>`;
    return `
      <section class="ev-feature" aria-labelledby="evDealName">
        ${flyerHTML(e, { cls: 'ev-feature__flyer', sizes: '(min-width: 1001px) 700px, 92vw' })}
        <form class="ev-feature__panel" id="evBuy" data-pid="${esc(p.id)}" novalidate>
          <div class="ev-feature__badges">${badges}${p.meta ? `<span class="p-card__meta">${esc(p.meta)}</span>` : ''}</div>
          <h2 class="ev-feature__name" id="evDealName">${esc(p.name)}</h2>
          ${p.card ? `<p class="ev-feature__desc">${jp(p.card)}</p>` : ''}
          <div class="ev-feature__price">${priceHTML(S.minPrice(p), { from: multi, per, incl: p.options.shipIncluded })}</div>
          <p class="ev-feature__ship">${esc(e.shipNote)}${note ? `　<b>${esc(note)}</b>` : ''}</p>
          ${buy}
          <p class="ev-feature__more"><a class="link" href="${esc(itemHref(p.id))}">${p.category === 'set' ? 'セット' : '商品'}の詳しい内容を見る</a></p>
        </form>
      </section>`;
  }
  // the feature block's quantity stepper and 「カートに入れる」 (the same addToCart as the product page)
  function wireFeature(p) {
    const form = $('#evBuy', view());
    const btn = form && $('#evBuyBtn', form);
    if (!btn) return;
    const v = p.variants.find((x) => x.id === btn.dataset.variant) || p.variants[0];
    let qty = 1;
    const update = () => {
      const cap = S.maxFor(p, v);
      qty = Math.max(1, Math.min(qty, cap));
      $('#evQty', form).textContent = qty;
      $('[data-step="-1"]', form).setAttribute('aria-disabled', String(qty <= 1));
      $('[data-step="1"]', form).setAttribute('aria-disabled', String(qty >= cap));
    };
    $$('[data-step]', form).forEach((b) => b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      qty = Math.max(1, Math.min(S.maxFor(p, v), qty + +b.dataset.step));
      update();
      announce(`数量 ${qty}`);
    }));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      addToCart(p.id, v.id, qty, 'none');
      update();
    });
    update();
  }
  function renderEvent(e) {
    const active = S.eventActive(e);
    const before = e.enabled && e.start && S.today() < e.start;
    if (active && !new URLSearchParams(location.search).has('preview')) S.markEventVisit(e.slug);
    // the featured offer (with the flyer) is not listed again in the cards below
    const deal = active && e.banner && e.banner.src ? eventDeals(e)[0] : null;
    const list = e.products.map((id) => S.product(id)).filter((p) => S.isVisible(p) && !(deal && p.id === deal.id));
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
          ${deal ? featureHTML(e, deal) : flyerHTML(e)}
          ${list.length ? `
          <h2 class="event-sec">${deal ? 'あわせてご案内している商品' : 'イベントでご案内している商品'}</h2>
          <div class="product-grid" data-count="${list.length}">${list.map((p) => cardHTML(p.options.preorder ? p : { ...p, when: '' }, { href: itemHref })).join('')}</div>` : ''}
          <ol class="event-steps" aria-label="ご注文の流れ">
            <li><span class="num">1</span><p><b>QRコードを読み込む</b><span>このページが開きます。</span></p></li>
            <li><span class="num">2</span><p><b>商品を選んでご注文</b><span>スマートフォンから、そのままご注文いただけます。</span></p></li>
            <li><span class="num">3</span><p><b>ご自宅にお届け</b><span>${esc(e.shipNote)}</span></p></li>
          </ol>
          <p class="notice event-note"><b>お届けについて</b>${esc(e.shipNote)}重たいお米も、ご自宅まで直接お届けします。</p>
          <p class="event-more"><a class="btn btn--line" href="#">ほかの商品も見る</a></p>` : `
          <div class="empty">
            <span class="empty__moon" aria-hidden="true"></span>
            <p>${!e.enabled ? 'このページは現在公開していません。' : before ? `このページは${esc(fmtDate(e.start))}から公開します。` : 'このページの公開は終了しました。'}満月米は、オンラインショップでいつでもご購入いただけます。</p>
            <a class="btn btn--line btn--sm" href="#">オンラインショップへ</a>
          </div>`}
        </div>
      </div>`;
    if (deal) wireFeature(deal);
  }

  /* =========================================================
     SHOP (shop.html)
     ========================================================= */
  let listSort = 'recommend';
  function renderList(catId) {
    // event-only goods (the set) are sold on the event page only: not in the list, the tabs or their counts
    const all = S.listedProducts();
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
      ${pageHead(cat ? cat.name : 'オンラインショップ', crumbs, `<p class="page-lead">北海道士別市上士別町の満月農園で育てたお米を、ご自宅へお届けします。</p><p class="photo-note">写真はイメージです</p>`, 'page-head--photo')}
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
            <div><h2>送料</h2><p>お届け先の地域と、お米の重さで決まります（<span class="nw">1箱${yenRange(rateSpan(s))}</span>・税込）。${freeText(s)}<a class="link" href="#guide-ship">地域別の送料表</a></p></div>
            <div><h2>発送</h2><p>ご購入いただいた順に、順次発送します。${sellsPreorder() ? '予約商品は、各商品ページに記載の時期にお届けします。' : ''}</p></div>
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
    // event-only goods outside their event: the reason instead of the buy box
    const closed = !soldOut && closedInfo(p);
    const blocked = soldOut || !!closed;
    const s = settings();
    const vis = S.listedProducts().filter((x) => x.id !== p.id);
    const others = [...vis.filter((x) => x.category === p.category), ...vis.filter((x) => x.category !== p.category)].slice(0, 3);
    const award = p.options.award
      ? '米-1グランプリ in らんこし 2025 <span class="nw">金賞受賞</span>'
      : p.options.traits ? '米-1グランプリ in らんこし 2025 <span class="nw">金賞受賞農園</span>' : '';
    const per = p.options.subscription ? '1回' : '';
    const incl = p.options.shipIncluded;
    const ev = s.event;
    const evOnly = p.options.eventOnly;
    const cat = S.category(p.category);
    const note = stockNote(p);
    // event-only goods: the event's delivery terms only while they can be bought, or before the event
    // that will sell them (soon). Outside that, no delivery promise at all (closed says why)
    const evShip = !p.options.preorder && (evOnly ? (!closed || closed.soon ? ev : null) : eventOrder());
    const shipShown = !evOnly || !closed || closed.soon;
    // event-only goods belong to the event page, not to a category of the shop
    const crumb = evOnly ? [['イベントのご案内', `#${ev.slug}`]] : cat ? [[cat.name, `#category-${cat.id}`]] : [];
    const badges = [
      soldOut ? '<span class="badge badge--soldout">売り切れ</span>' : p.badge.text ? `<span class="badge${p.badge.line ? ' badge--line' : ''}">${esc(p.badge.text)}</span>` : '',
      evOnly && !soldOut && !p.badge.text.includes('イベント限定') ? '<span class="badge">イベント限定</span>' : '',
    ].join('');
    const shipLine = incl
      ? 'この商品には送料がかかりません。' // 「送料込み」 is already in the price line
      : `送料は、お届け先の地域と重さで決まります<span class="nw">（この商品1点：<span id="pdShipRange">${unitShipText(firstAvail)}</span>）</span>。${freeText(s)}<a class="link" href="#guide-ship">送料表を見る</a>`;

    view().innerHTML = `
      ${pageHead(null, [['トップ', 'index.html'], ['オンラインショップ', '#'], ...crumb, [p.name]])}
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
                  ${badges}
                  <span class="p-card__meta">${esc(p.meta)}</span>
                </div>
                <h1 class="pd__name" tabindex="-1" data-page-focus>${esc(p.name)}</h1>
              </div>
              <p class="pd__lead">${jp(p.lead)}</p>
              <div class="pd__price" id="pdPrice">${priceHTML(firstAvail.price, { per, incl })}</div>
              ${shipShown ? `<p class="pd__ship">${p.options.preorder ? '<b>予約商品</b>　' : ''}${esc(evShip ? evShip.shipNote : p.ship)}${note ? `　<b>${esc(note)}</b>` : ''}<br>${shipLine}</p>` : ''}

              ${closed ? `
              <div class="notice pd__closed" role="note">
                <b>${esc(closed.head)}</b>
                <span>${esc(closed.text)}</span>
                <a class="btn btn--line btn--sm" href="#">オンラインショップへ</a>
              </div>` : variants.length > 1 ? `
              <fieldset class="opt">
                <legend>${p.options.subscription ? 'お届け周期・内容量' : '種類・内容量'}</legend>
                <div class="chips">
                  ${variants.map((v) => { const out = S.variantSoldOut(p, v); return `
                    <label class="chip${out ? ' is-disabled' : ''}"><input type="radio" name="variant" value="${esc(v.id)}" ${v === firstAvail ? 'checked' : ''} ${out ? 'disabled' : ''}><span>${esc(v.label)}<small>${out ? '売り切れ' : `¥${yen(v.price)}${per ? '／1回' : ''}`}</small></span></label>`; }).join('')}
                </div>
              </fieldset>` : `<input type="hidden" name="variant" value="${esc(firstAvail.id)}">`}

              ${p.options.gift && !blocked ? `
              <div class="field">
                <label class="field__label" for="giftSel">ギフト包装・のし</label>
                <select class="select" id="giftSel" name="gift">
                  ${GIFT_OPTIONS.map((g) => `<option value="${g.id}">${esc(g.label)}${g.paid ? `（+¥${yen(s.giftFee)}）` : ''}</option>`).join('')}
                </select>
              </div>` : ''}

              ${closed ? '' : `
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
              </div>`}
              <p class="pd__sub">
                <a href="#guide-ship"><span>送料・お届けについて</span></a>
              </p>
            </form>
          </div>

          ${blocked ? '' : `
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
                  ${p.specs.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${jp(v)}</td></tr>`).join('')}
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
    const form = $('#buyForm');
    if (blocked) {
      $$('[data-step]', view()).forEach((b) => b.setAttribute('aria-disabled', 'true'));
      // nothing to submit (Enter in the form, or a stale buy bar)
      form.addEventListener('submit', (e) => e.preventDefault());
      return;
    }

    // qty + price
    let qty = 1;
    const current = () => { const vid = new FormData(form).get('variant'); return variants.find((x) => x.id === vid) || firstAvail; };
    const update = () => {
      const v = current();
      const cap = S.maxFor(p, v);
      qty = Math.max(1, Math.min(qty, cap));
      const g = giftOf(form.gift ? form.gift.value : 'none');
      const unit = v.price + giftFee(g);
      const notes = [qty > 1 ? `¥${yen(unit)} × ${qty}` : '', giftFee(g) ? `ギフト包装 ¥${yen(giftFee(g))} を含む` : ''].filter(Boolean).join('・');
      $('#pdPrice').innerHTML = priceHTML(unit * qty, { per, incl }) + (notes ? `<span class="price__tax">（${notes}）</span>` : '');
      $('#buyBarPrice').innerHTML = priceHTML(unit * qty, { per, incl });
      if ($('#pdShipRange')) $('#pdShipRange').textContent = unitShipText(v);
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
  // live mode: what changed when the server refused the cart (cart_changed). Shown once on #cart.
  let cartNotice = null;
  // event-only goods taken out of the cart because their event is over: told once, on #cart
  let closedNotes = [];
  function renderCart() {
    const closed = dropClosed();
    if (closed) closedNotes.push(closed);
    // kept with the other changes while the shopper stays on #cart
    if (closedNotes.length) { cartNotice = [...new Set([...(cartNotice || []), ...closedNotes])]; closedNotes = []; }
    const notes = cartNotice || [];
    const t = totals();
    const changed = notes.length ? `
          <div class="notice notice--warn cart-changed" role="alert">
            <b>在庫や販売状況が変わったため、カートの内容を変更しました</b>
            <ul>${notes.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
            ${cart.length ? '<span>内容をご確認のうえ、もう一度ご購入手続きへお進みください。</span>' : ''}
          </div>` : '';
    view().innerHTML = `
      ${pageHead('カート', [['トップ', 'index.html'], ['オンラインショップ', '#'], ['カート']], stepsBar(0))}
      <div class="page-body">
        <div class="container">
          ${changed}
          ${cart.length ? `
          <div class="cart-page">
            <div>${preorderNotice()}${cart.map(lineHTML).join('')}
              <p class="cart-page__more"><a class="link" href="#">買いものを続ける</a></p>
            </div>
            <aside class="panel" aria-label="ご注文金額">
              <p class="panel__title">ご注文金額</p>
              ${allIncluded(t.quote) ? '' : shipEstHTML('shipPrefCart')}
              <div class="sum-block" data-sum>${sumHTML(t)}</div>
              <a class="btn btn--gold btn--block" href="#checkout">ご購入手続きへ</a>
              <p class="panel__note"><a class="link" href="#guide-ship">地域別の送料表</a></p>
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
  // the prefecture the parcel goes to: お届け先 when 「別の住所」 is checked, otherwise the orderer's
  const destPref = () => (draft.giftTo ? draft.spref : draft.pref) || '';

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

  const CHECKOUT_UNKNOWN = '都道府県の選択後に表示します';
  function orderPanel(t) {
    return `
      <aside class="panel" aria-label="ご注文内容">
        <p class="panel__title">ご注文内容</p>
        <div>${cart.map((l) => { const { p, v, g, total } = lineInfo(l); return `
          <div class="mini-line"><span class="line__img" aria-hidden="true">${visualHTML(p)}</span>
          <span class="mini-line__name">${esc(p.name)}<small>${[p.variants.length > 1 ? v.label : '', g.id !== 'none' ? g.label : '', p.options.shipIncluded ? '送料込み' : ''].filter(Boolean).map(esc).join('／')} <span class="nw">× ${l.qty}</span></small></span>
          ${priceHTML(total, { tax: false })}</div>`; }).join('')}
        </div>
        <div class="sum-block" id="orderSum">${summaryHTML(t, { detail: true, unknown: CHECKOUT_UNKNOWN })}</div>
        <p class="drawer__links"><a href="#cart">カートに戻る</a></p>
      </aside>`;
  }
  // the TBD text breaks only between its two chunks on phones
  const payTotal = (t) => `<p class="pay-total" id="payTotal"><span class="pay-total__label">お支払い合計（税込）</span>${t.ship === null
    ? '<span class="pay-total__tbd"><span class="nw">都道府県を選ぶと</span><span class="nw">表示します</span></span>' : priceHTML(t.total, { tax: false })}</p>`;
  // checkout form: the delivery prefecture changed → update the fee and totals in place
  let lastDest = null;
  function updateCheckoutTotals() {
    const pref = destPref();
    if (pref === lastDest) return;
    lastDest = pref;
    const t = totals(pref);
    const sum = $('#orderSum');
    if (sum) sum.innerHTML = summaryHTML(t, { detail: true, unknown: CHECKOUT_UNKNOWN });
    const pt = $('#payTotal');
    if (pt) pt.outerHTML = payTotal(t);
    announce(t.ship === null ? '送料は、お届け先の都道府県を選ぶと表示されます'
      : `${pref && !allIncluded(t.quote) ? `${pref}へお届けする場合、` : ''}送料は${feeWords(t)}、お支払い合計は${yen(t.total)}円です`);
  }
  // event orders: placed after arriving from the event page (QR code at the venue), or holding an
  // event-only product (北海道満喫セット). They ship as the event says (shipNote), with no delivery date.
  const eventOrder = () => {
    const e = settings().event;
    if (!e || !S.eventActive(e)) return null;
    if (cart.some((l) => { const p = S.product(l.pid); return p && p.options.eventOnly; })) return e;
    const src = S.eventSource();
    return src && e.slug === src ? e : null;
  };

  // live mode: ordering is blocked while the catalog could not be loaded
  const blockedHTML = (title) => `${pageHead(title, [['トップ', 'index.html'], ['カート', '#cart'], [title]])}
    <div class="page-body"><div class="container">
      <div class="empty"><span class="empty__moon" aria-hidden="true"></span>
        <p>${esc(LOAD_ERROR)}</p>
        <button class="btn btn--line btn--sm" type="button" data-reload>ページを開き直す</button>
      </div>
    </div></div>`;

  // event-only goods whose event is over leave the cart: the cart page says so (→ true)
  function closedToCart() {
    const closed = dropClosed();
    if (!closed) return false;
    closedNotes.push(closed);
    location.replace('#cart');
    return true;
  }
  function renderCheckout() {
    if (closedToCart()) return;
    if (!cart.length) {
      view().innerHTML = `${pageHead('ご購入手続き', [['トップ', 'index.html'], ['オンラインショップ', '#'], ['ご購入手続き']])}<div class="page-body"><div class="container">${emptyHTML()}</div></div>`;
      return;
    }
    if (loadError) { view().innerHTML = blockedHTML('お客様情報の入力'); return; }
    // start from the prefecture picked for the cart's 送料の目安 (never over one already entered)
    if (!draft.pref && !draft.giftTo && estPref) draft.pref = estPref;
    const dates = dateOptions();
    const pre = hasPreorder();
    const ev = eventOrder();
    const t = totals(destPref());
    lastDest = destPref();
    view().innerHTML = `
      ${pageHead('お客様情報の入力', [['トップ', 'index.html'], ['カート', '#cart'], ['お客様情報']], stepsBar(1))}
      <div class="page-body">
        <div class="container">
          <div class="checkout">
            <form id="checkoutForm" novalidate>
              ${LIVE ? '' : '<p class="notice checkout__notice"><b>デモサイトです</b>入力した内容は、このブラウザの中にだけ保存されます（管理画面の注文一覧に表示されます）。どこにも送信されず、実際の注文・決済も行われません。</p>'}

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
                    <p class="field__error" id="date-err" hidden></p>
                  </div>`}
                  <div class="field">
                    <label class="field__label" for="time">時間帯<span class="opt-tag">任意</span></label>
                    <select class="select" id="time" name="time">
                      ${TIMES.map((x) => `<option ${draft.time === x ? 'selected' : ''}>${x}</option>`).join('')}
                    </select>
                    <p class="field__error" id="time-err" hidden></p>
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
                <p class="field__hint">${LIVE ? '次の確認画面で「注文を確定する」を押すと、Stripeの決済画面に移動します。' : 'デモサイトのため、決済画面には移動しません。'}</p>
              </section>

              <section class="form-sec">
                <h2><span class="num">5</span>備考</h2>
                <div class="field">
                  <label class="field__label" for="memo">ご要望など<span class="opt-tag">任意</span></label>
                  <textarea class="textarea input" id="memo" name="memo" rows="4" maxlength="400" placeholder="置き配のご希望など">${esc(draft.memo || '')}</textarea>
                  <p class="field__error" id="memo-err" hidden></p>
                </div>
              </section>

              ${payTotal(t)}
              <button class="btn btn--gold btn--block" type="submit">ご注文内容を確認する</button>
            </form>
            ${orderPanel(t)}
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
      if (['pref', 'spref', 'giftTo'].includes(e.target.id)) updateCheckoutTotals();
    });
    if (fieldErrors) { applyFieldErrors(form, fieldErrors); fieldErrors = null; }
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
    let msg = '';
    if (el.validity.valueMissing) msg = el.tagName === 'SELECT' ? '選択してください。' : '入力してください。';
    else if (el.validity.typeMismatch && el.type === 'email') msg = 'メールアドレスの形式で入力してください（例：mail@example.com）。';
    else if (el.validity.patternMismatch) {
      msg = { zip: '7桁の数字で入力してください（例：0950000）。', szip: '7桁の数字で入力してください（例：0950000）。', tel: '市外局番から数字で入力してください。', stel: '市外局番から数字で入力してください。', kana1: 'カタカナで入力してください。', kana2: 'カタカナで入力してください。' }[el.id] || '入力内容をご確認ください。';
    }
    showFieldError(el, msg);
    return !msg;
  }
  function showFieldError(el, msg) {
    const err = document.getElementById(el.id + '-err');
    el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (err) { err.textContent = msg; err.hidden = !msg; }
    const ids = [document.getElementById(el.id + '-hint') ? el.id + '-hint' : '', msg && err ? err.id : ''].filter(Boolean);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' ')); else el.removeAttribute('aria-describedby');
  }

  // live mode: field errors returned by the server (400 invalid) → shown under the matching input.
  // 'customer.zip' → #zip, 'shipTo.pref' → #spref, 'date' → #date …
  let fieldErrors = null;
  const fieldIdOf = (f) => {
    const m = /^(customer|shipTo)\.(\w+)$/.exec(String(f || ''));
    return m ? (m[1] === 'shipTo' ? 's' : '') + m[2] : String(f || '');
  };
  function applyFieldErrors(form, errors) {
    const rest = [];
    let first = null;
    for (const e of errors) {
      const msg = String((e && e.message) || '入力内容をご確認ください。');
      const id = fieldIdOf(e && e.field);
      const el = /^[a-z0-9]+$/i.test(id) ? form.querySelector(`#${id}`) : null;
      if (el && !el.disabled && el.matches('.input, .select')) { showFieldError(el, msg); first = first || el; } else rest.push(msg);
    }
    if (first) pendingFocus = first;
    if (rest.length) toast(rest.join(' '));
    else if (first) announce(`入力内容を確認してください（${errors.length}か所）`);
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

  // set while the order is being sent (demo: saved, live: waiting for the Stripe page)
  let placing = false;
  const PLACING_TEXT = LIVE ? '決済画面に移動しています…' : 'ご注文を送信しています…';
  // 〒8100001 → 〒810-0001 (display only; the form keeps what was entered)
  const zipText = (z) => { const d = String(z || '').replace(/-/g, ''); return /^\d{7}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3)}` : String(z || ''); };
  function renderConfirm() {
    if (closedToCart()) return;
    if (!cart.length) { location.replace('#cart'); return; }
    if (!draft.ok) { location.replace('#checkout'); return; }
    if (loadError) { view().innerHTML = blockedHTML('ご注文内容の確認'); return; }
    const t = totals(destPref());
    // the form requires a prefecture, so this only guards hand-edited state
    if (t.ship === null) { draft.ok = false; location.replace('#checkout'); return; }
    const pay = PAYMENTS.find((p) => p.id === draft.pay) || PAYMENTS[0];
    const addr = (z, p, a1, a2) => `〒${esc(zipText(z))}<br>${esc(p)}${esc(a1)}${a2 ? ' ' + esc(a2) : ''}`;
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
      ['お届け時期', pre ? `${esc(preorderShip())}（予約商品の発送にあわせてお届け）` : ev ? esc(ev.shipNote) : 'ご購入いただいた順に、順次発送'],
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
              ${LIVE
                ? '<p class="notice" style="margin-bottom:24px"><b>お支払いについて</b>「注文を確定する」を押すと、Stripe（ストライプ）の決済画面に移動します。カード情報を入力してお支払いいただくと、ご注文の手続きが完了します。</p>'
                : '<p class="notice" style="margin-bottom:24px"><b>デモサイトです</b>「注文を確定する」を押しても、実際の注文・決済は行われません。</p>'}
              ${payTotal(t)}
              <button class="btn btn--gold btn--block" type="button" id="placeOrder" ${placing ? 'disabled' : ''}>${placing ? PLACING_TEXT : '注文を確定する'}</button>
              <p class="field__error place-error" id="placeError" hidden></p>
            </div>
            ${orderPanel(t)}
          </div>
        </div>
      </div>`;
    $('#placeOrder').addEventListener('click', () => startPlace());
  }
  // 注文を確定する (and もう一度注文する after a duplicate_paid question: confirmDuplicate)
  function startPlace(opts = {}) {
    if (placing || !cart.length || !draft.ok) return;
    // the event ended while the confirm page was open
    if (closedToCart()) return;
    placing = true;
    removeDupAsk();
    const btn = $('#placeOrder');
    if (btn) { btn.hidden = false; btn.disabled = true; btn.textContent = PLACING_TEXT; }
    const pe = $('#placeError');
    if (pe) pe.hidden = true;
    if (LIVE) placeLive(opts); else placeDemo();
  }
  // the order could not be sent: enable the button again and say why next to it
  function resetPlace(msg = '') {
    placing = false;
    redirecting = false;
    clearTimeout(redirectTimer);
    removeDupAsk();
    const btn = $('#placeOrder');
    if (btn) { btn.hidden = false; btn.disabled = false; btn.textContent = '注文を確定する'; }
    const pe = $('#placeError');
    if (pe) { pe.textContent = msg; pe.hidden = !msg; }
  }

  /* demo: the order is kept in this browser (shown in the admin screen) */
  function placeDemo() {
    const pay = PAYMENTS.find((p) => p.id === draft.pay) || PAYMENTS[0];
    const pre = hasPreorder();
    const ev = eventOrder();
    const d = new Date();
    const no = `MG-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(Math.floor(1000 + Math.random() * 9000))}`;
    const t = totals(destPref());
    const q = t.quote;
    const saved = S.addOrder({
      no, at: d.toISOString(), status: 'new',
      customer: { name: `${draft.name1} ${draft.name2}`, kana: `${draft.kana1} ${draft.kana2}`, tel: draft.tel, email: draft.email, zip: draft.zip, address: `${draft.pref}${draft.addr1}${draft.addr2 ? ' ' + draft.addr2 : ''}` },
      shipTo: draft.giftTo ? { name: draft.sname, zip: draft.szip, address: `${draft.spref}${draft.saddr1}${draft.saddr2 ? ' ' + draft.saddr2 : ''}`, tel: draft.stel } : null,
      items: cart.map((l) => { const { p, v, g, unit, total } = lineInfo(l); return { pid: p.id, vid: v.id, name: p.name, variant: p.variants.length > 1 ? v.label : '', gift: g.id !== 'none' ? g.label : '', qty: l.qty, unit, total }; }),
      subtotal: t.sub, ship: t.ship,
      // the same as the server's order (server/src/orders.js): included only when the order has 送料込みの商品
      shipDetail: {
        region: q.region ? q.region.name : '', parcels: q.parcels.map((x) => ({ kg: x.kg, fee: x.fee })), free: q.free,
        ...(q.included ? { included: true } : {}),
      },
      total: t.total,
      source: ev ? ev.slug : '', sourceName: ev ? ev.title : '',
      pay: pay.label, date: pre || ev ? '' : draft.date || '', time: draft.time || '', noshi: draft.noshiName || '', memo: draft.memo || '',
      preorder: pre,
    });
    if (!saved.ok) {
      const msg = 'ご注文を保存できませんでした（このブラウザの保存容量がいっぱいです）。もう一度お試しください。';
      resetPlace(msg);
      toast(msg);
      return;
    }
    S.consumeStock(cart);
    lastOrder = { no, name: `${draft.name1} ${draft.name2}`, preorder: pre, mixed: mixedPreorder(), ship: preorderShip(), eventNote: ev ? ev.shipNote : '' };
    cart = []; draft = {};
    placing = false;
    saveCart();
    renderCount();
    location.hash = 'thanks';
  }

  /* ---------- live: order + payment through the server and Stripe Checkout ---------- */
  // { draft, cart, orderNo, sessionId } while the shopper is on the Stripe page. sessionId stays until that
  // Stripe page is known to be paid or closed (the form and cart may be dropped earlier)
  const CHECKOUT_KEY = 'mangetsu.checkout.v1';
  const LAST_ORDER_KEY = 'mangetsu.lastOrder.v1'; // the thanks screen survives a reload
  const sess = {
    get: (k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
    del: (k) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const SESSION_RE = /^cs_[A-Za-z0-9_]{1,250}$/;
  // the Stripe Checkout Session this tab opened and has not seen paid or closed ('' if none)
  const openSession = () => {
    const s = sess.get(CHECKOUT_KEY);
    return s && typeof s === 'object' && typeof s.sessionId === 'string' && SESSION_RE.test(s.sessionId) ? s.sessionId : '';
  };

  // Every Stripe page opened in this browser (any tab) and not yet seen paid or closed:
  // [{ id, orderNo, at, cart }] in localStorage, so that a checkout in one tab can close the Stripe page another
  // tab left open (two tabs share one cart; paying both would charge twice). A Checkout Session can be
  // paid for 60 minutes after it was made, so entries older than 90 minutes are dropped.
  // cart: cartSig of the cart it was opened for. Found paid later, it empties the cart only when the cart
  // is still those goods (the shopper may have filled a different cart since).
  const OPEN_KEY = 'mangetsu.openSessions.v1';
  const OPEN_MAX_AGE = 90 * 60 * 1000;
  const OPEN_MAX = 20;
  function parseOpen(raw) {
    let list;
    try { list = JSON.parse(raw || '[]'); } catch { return []; }
    if (!Array.isArray(list)) return [];
    const now = Date.now();
    const seen = new Set();
    const out = [];
    for (const s of list) {
      if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !SESSION_RE.test(s.id) || seen.has(s.id)) continue;
      if (!Number.isFinite(s.at) || Math.abs(now - s.at) > OPEN_MAX_AGE) continue;
      seen.add(s.id);
      out.push({ id: s.id, orderNo: typeof s.orderNo === 'string' ? s.orderNo.slice(0, 40) : '', at: s.at, cart: typeof s.cart === 'string' ? s.cart.slice(0, 2000) : null });
    }
    return out.slice(-OPEN_MAX);
  }
  const readOpen = () => { try { return parseOpen(localStorage.getItem(OPEN_KEY)); } catch { return []; } };
  function writeOpen(list) {
    try {
      if (list.length) localStorage.setItem(OPEN_KEY, JSON.stringify(list.slice(-OPEN_MAX)));
      else localStorage.removeItem(OPEN_KEY);
    } catch { /* ignore: this tab's own record (sessionStorage) still closes it */ }
  }
  const isListed = (id) => readOpen().some((s) => s.id === id);
  // on the way to its Stripe page (sig: cartSig of the cart it is for)
  function listOpen(id, orderNo, sig) {
    writeOpen([...readOpen().filter((s) => s.id !== id), { id, orderNo: String(orderNo || ''), at: Date.now(), cart: sig }]);
  }
  function unlistOpen(id) {
    const list = readOpen();
    const rest = list.filter((s) => s.id !== id);
    if (rest.length !== list.length) writeOpen(rest);
  }
  // when this browser (any tab) last saw an order paid: a cart a tab saved before that is not brought back
  // when the shopper returns from an unpaid Stripe page (that order would be placed twice)
  const PAID_AT_KEY = 'mangetsu.paidAt.v1';
  const paidAt = () => { try { return Number(localStorage.getItem(PAID_AT_KEY)) || 0; } catch { return 0; } };
  // (this tab knows of it: not a sign of a missed change)
  const notePaid = () => { try { localStorage.setItem(PAID_AT_KEY, String(Date.now())); } catch { /* ignore */ } seenPaidAt = paidAt(); };
  // the cart a Stripe page was opened for (cartSig), or null when not known
  function sessionCart(id) {
    const e = readOpen().find((s) => s.id === id);
    if (e && typeof e.cart === 'string') return e.cart;
    const s = sess.get(CHECKOUT_KEY);
    return s && typeof s === 'object' && s.sessionId === id && typeof s.sig === 'string' ? s.sig : null;
  }
  // a paid order is for the cart this tab holds (an empty cart, or nothing known, counts as the same)
  const sameCart = (sig) => sig === null || !cart.length || sig === cartSig(cart);

  // that session is paid or closed: forget it in every tab (this tab's saved form and cart stay)
  function forgetSession(id) {
    unlistOpen(id);
    const s = sess.get(CHECKOUT_KEY);
    if (!s || typeof s !== 'object' || s.sessionId !== id) return;
    if (s.draft || 'cart' in s) sess.set(CHECKOUT_KEY, { draft: s.draft, cart: s.cart });
    else sess.del(CHECKOUT_KEY);
  }
  // the cart was emptied: drop the saved form and cart, keep the open session (if any)
  function keepOnlySession() {
    const s = sess.get(CHECKOUT_KEY);
    if (!s) return;
    const id = openSession();
    if (id) sess.set(CHECKOUT_KEY, { orderNo: s.orderNo, sessionId: id, sig: s.sig });
    else sess.del(CHECKOUT_KEY);
  }

  // Close a Stripe page (POST /api/checkout/cancel) before anything else can be paid: a Checkout
  // Session stays payable for up to 60 minutes, and paying it and a newer one would charge twice.
  // → 'closed' | 'paid' (it was paid after all, for the cart this tab holds: its thanks page is shown) |
  //   'paidOther' (it was paid after all, for other goods than this tab's cart now — e.g. some of them,
  //   before more were added: a notice above the page, the cart stays) |
  //   'failed' (not known to be closed: it stays saved, and no new checkout may start).
  const closing = new Map(); // session id → its request while on the way (one request per session)
  function closeSession(id) {
    if (closing.has(id)) return closing.get(id);
    const sig = sessionCart(id); // read before the entry is dropped
    const done = API.cancelCheckout(id).then((r) => {
      if (r && r.payment === 'paid') {
        forgetSession(id);
        if (sameCart(sig)) { paidBefore(r); return 'paid'; }
        paidElsewhere(r, sig);
        return 'paidOther';
      }
      if (r && r.payment === 'expired') { forgetSession(id); return 'closed'; }
      return 'failed'; // still pending: Stripe could not be asked
    }, (err) => {
      // the server does not know it (nothing there can be paid)
      if (err && err.status === 404) { forgetSession(id); return 'closed'; }
      return 'failed';
    }).then((state) => {
      closing.delete(id);
      // a payment check still running for it has nothing left to find
      if ((state === 'closed' || state === 'paidOther') && payCheck && payCheck.id === id) { clearTimeout(payTimer); payCheck = null; }
      return state;
    });
    closing.set(id, done);
    return done;
  }
  // before a new checkout: every Stripe page this browser still has open (this tab's and the other tabs')
  // is closed, all of them before going on
  // → { state, paidNos }. state: 'none' (nothing open) | 'closed' | 'paid' (one was paid for this cart:
  //   its thanks page is shown) | 'paidOther' (one was paid for other goods: paidNos are those order
  //   numbers, as listed when its Stripe page was opened) | 'failed'
  async function closeAllSessions() {
    const nos = new Map(readOpen().map((s) => [s.id, s.orderNo]));
    const own = openSession();
    if (own && !nos.has(own)) nos.set(own, String((sess.get(CHECKOUT_KEY) || {}).orderNo || ''));
    if (!nos.size) return { state: 'none', paidNos: [] };
    const ids = [...nos.keys()];
    const states = await Promise.all(ids.map(closeSession));
    const paidNos = ids.filter((id, i) => states[i] === 'paidOther').map((id) => nos.get(id)).filter(Boolean);
    if (states.includes('paid')) return { state: 'paid', paidNos };
    if (states.includes('paidOther')) return { state: 'paidOther', paidNos };
    return { state: states.includes('failed') ? 'failed' : 'closed', paidNos };
  }
  // back on the shop from the Stripe page without paying (cancel link, browser Back, back/forward cache).
  // A session that came back through success_url (?session_id=…) is being checked, never closed here.
  // Only this tab's own Stripe page is closed: another tab may still be on its Stripe page.
  function closeOnReturn() {
    if (!LIVE || !IS_SHOP) return;
    const id = openSession();
    if (!id || (payCheck && payCheck.id === id)) return;
    closeSession(id); // 'failed' is retried before the next checkout
  }
  // the earlier Stripe page was paid after all (e.g. in another tab): no new checkout, its thanks page instead
  const PAID_BEFORE = '前回の決済画面で、お支払いが完了していました。';
  function paidBefore(r) {
    placing = false;
    paymentDone(r); // empties the cart and the form, keeps the order for #thanks
    if (currentRoute === 'thanks') { toast(PAID_BEFORE); return; }
    // the route change hides toasts: show it after
    window.addEventListener('hashchange', () => toast(PAID_BEFORE), { once: true });
    location.hash = 'thanks';
  }

  // A Stripe page opened in another tab (or before this page was opened) may have been paid without the
  // shopper ever coming back to the shop (tab closed, connection lost). The shop asks about each listed
  // session once per page (GET /api/checkout/status, which may ask Stripe and counts toward the server's
  // per-address limit) and never closes one here: that tab may still be on its Stripe page.
  // Paid: a notice above the page links to the order, and the cart is emptied if it still holds those goods.
  const asked = new Set();
  function checkListed() {
    if (!LIVE || !IS_SHOP || !booted || payCheck) return;
    const own = openSession(); // closed by closeOnReturn instead
    for (const { id, cart: sig } of readOpen()) {
      if (id === own || asked.has(id) || closing.has(id)) continue;
      asked.add(id);
      API.checkoutStatus(id).then((r) => {
        if (r && r.payment === 'paid') { unlistOpen(id); paidElsewhere(r, sig); }
        else if (r && r.payment === 'expired') unlistOpen(id);
      }, (err) => {
        if (err && err.status === 404) unlistOpen(id);
      });
    }
  }
  const orderOf = (r) => ({
    no: String(r.orderNo || ''), name: String(r.name || ''), preorder: !!r.preorder, mixed: !!r.mixed,
    ship: String(r.preorderShip || ''), eventNote: String(r.eventNote || ''),
  });
  const paidShown = new Set(); // order numbers already shown as paid on this page
  // sig: cartSig of the cart that order was for (null: not known). The cart is emptied only when it still
  // holds those goods; a different cart filled since stays, and only the notice is shown.
  function paidElsewhere(r, sig = null) {
    const order = orderOf(r);
    if (order.no && paidShown.has(order.no)) return;
    paidShown.add(order.no);
    const mine = sameCart(sig);
    const emptied = mine && cart.length > 0;
    if (mine) {
      lastOrder = order;
      sess.set(LAST_ORDER_KEY, order);
    }
    notePaid();
    if (emptied) {
      cart = [];
      saveCart();
      renderCount();
      if (!$('#cartDrawer').hidden) renderDrawer();
      if (/^(cart|checkout)/.test(currentRoute || '')) renderRoute();
    }
    showPaidNote(order, emptied);
  }
  // shop: notices above #view (catalog not loaded, an earlier order found paid)
  function noticeWrap() {
    const prev = view().previousElementSibling;
    if (prev && prev.classList.contains('load-error-wrap')) return prev;
    const box = document.createElement('div');
    box.className = 'container load-error-wrap';
    view().before(box);
    return box;
  }
  function showPaidNote(order, emptied) {
    removePaidNote();
    const msg = `前回のご注文${order.no ? `（ご注文番号 ${order.no}）` : ''}は、お支払いが完了しています。`;
    const box = document.createElement('div');
    box.className = 'notice paid-note';
    box.id = 'paidNote';
    // the order number stays on one line
    box.innerHTML = `<b>前回のご注文${order.no ? `（ご注文番号 <span class="nw">${esc(order.no)}</span>）` : ''}は、お支払いが完了しています。</b>
      ${emptied ? '<span>カートに残っていた商品は、ご注文済みのためカートから外しました。</span>' : ''}
      <a class="btn btn--line btn--sm" href="#thanks">ご注文内容を見る</a>`;
    $('a', box).addEventListener('click', () => {
      lastOrder = order;
      sess.set(LAST_ORDER_KEY, order);
      // already on #thanks: no route change, show it in place
      if (currentRoute === 'thanks' && !payCheck) { removePaidNote(); refreshThanks(); }
    });
    noticeWrap().append(box);
    announce(msg);
  }
  function removePaidNote() {
    const box = $('#paidNote');
    if (!box) return;
    const wrap = box.parentElement;
    box.remove();
    if (wrap && !wrap.children.length) wrap.remove();
  }

  // The browser can stop on the way to the Stripe page (Esc, connection lost) and stay on the confirm
  // page: the button is usable again after a while. Safe, because the next attempt closes that Stripe page first.
  const REDIRECT_WAIT = 10000;
  const REDIRECT_STUCK = '決済画面が開かない場合は、もう一度「注文を確定する」を押してください。';
  let redirectTimer = 0;
  let redirecting = false;
  function waitForRedirect() {
    redirecting = true;
    clearTimeout(redirectTimer);
    redirectTimer = setTimeout(() => { if (redirecting) stopRedirectWait(REDIRECT_STUCK); }, REDIRECT_WAIT);
  }
  function stopRedirectWait(msg = '') {
    clearTimeout(redirectTimer);
    if (!redirecting) return;
    redirecting = false;
    if (currentRoute === 'checkout-confirm' && $('#placeOrder')) resetPlace(msg);
    else placing = false;
  }

  // another tab opened or closed a Stripe page, or saw an order paid
  window.addEventListener('storage', (e) => {
    if (!LIVE || !booted) return;
    // heard of (the cart that order emptied arrives with its own event)
    if (e.key === PAID_AT_KEY) { seenPaidAt = paidAt(); return; }
    if (!IS_SHOP || (e.key !== OPEN_KEY && e.key !== null)) return;
    // this tab's own Stripe page was closed there (or found paid) while this page still waits for the
    // browser to open it: the button is usable again (the next attempt asks the server what became of it)
    const own = openSession();
    if (redirecting && own && !isListed(own)) stopRedirectWait(REDIRECT_STUCK);
    // pages opened there are asked about (once) when this tab is shown again
  });
  // shown again: the cart is read again (like a page back from the back/forward cache), and the
  // Stripe pages other tabs opened meanwhile are asked about
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    resyncCart();
    checkListed();
  });
  const CLOSE_FAILED = '前回のお支払い画面を閉じられませんでした。時間をおいて、もう一度お試しください。';
  // the cart was emptied by an order paid since (in another tab, or on this tab's thanks page)
  const PAID_SINCE = 'ご注文のお支払いは、すでに完了しています。カートは空になっています。';
  // A page kept in the background (another tab in front, the back/forward cache, a phone that suspended
  // it) can miss what other tabs did meanwhile (an order paid, the cart changed): the cart is read again.
  // → true when it changed
  function resyncCart() {
    if (!booted || !cartStored) return false; // storage that could not keep the cart has nothing newer
    const shown = cart;
    const before = JSON.stringify(cart);
    const seen = seenPaidAt;
    loadCart();
    // event-only goods whose event ended while the page was hidden: left out by S.loadCart, and told
    const closed = closedInStore(shown);
    if (JSON.stringify(cart) === before && !closed) return false;
    renderCount();
    if (!$('#cartDrawer').hidden) renderDrawer(closed);
    // the checkout screens go back to the cart page, which lists them
    if (tellClosed(closed)) return true;
    if (!IS_SHOP) return true;
    // emptied by an order paid meanwhile: the cart page (no extra route change, which would hide the note)
    const paidSince = LIVE && !cart.length && paidAt() > seen;
    if (/^(cart|checkout)/.test(currentRoute || '')) {
      if (currentRoute === 'checkout') { const f = $('#checkoutForm'); if (f) collect(f); }
      if (paidSince && /^checkout/.test(currentRoute)) history.replaceState(history.state, '', `${location.pathname}${location.search}#cart`);
      renderRoute();
    }
    if (paidSince) toast(PAID_SINCE);
    return true;
  }
  // the cart in storage is not the one this page showed when 注文を確定する was pressed: no order.
  // The page shows the cart as it is now; an empty one goes to the cart page.
  const CART_SYNCED = 'ほかの画面でカートの内容が変わったため、最新の内容を表示しています。ご注文内容をご確認のうえ、もう一度「注文を確定する」を押してください。';
  function onStaleCart() {
    const paidSince = paidAt() > seenPaidAt;
    const shown = cart;
    loadCart();
    const closed = closedInStore(shown);
    placing = false;
    renderCount();
    if (!$('#cartDrawer').hidden) renderDrawer();
    // event-only goods whose event ended: the cart page lists them
    if (closed) { closedNotes.push(closed); location.replace('#cart'); return; }
    if (!cart.length) {
      // the route change hides toasts: show it after
      if (paidSince) window.addEventListener('hashchange', () => toast(PAID_SINCE), { once: true });
      location.replace('#cart');
      return;
    }
    renderRoute();
    resetPlace(CART_SYNCED);
    toast(CART_SYNCED);
  }

  // One checkout at a time in this browser. Two tabs pressing 注文を確定する almost together would each
  // close the Stripe pages listed so far, and then both make one (both could be paid). With the lock, the
  // later one starts only after the earlier one has listed its Stripe page, and closes it.
  // Web Locks where the browser has them; otherwise a short lease in localStorage (renewed while held,
  // so a closed tab frees it within LEASE_TTL). Waiting is limited: never stuck.
  const LOCK_NAME = 'mangetsu.checkout';
  const LEASE_KEY = 'mangetsu.checkoutLease.v1';
  const LEASE_TTL = 20000;
  const LOCK_WAIT = 20000;
  const LOCK_BUSY = 'ほかの画面（ブラウザのタブ）で、ご注文の手続きが進んでいます。そちらをご確認いただくか、しばらくしてから、もう一度お試しください。';
  const BUSY = Symbol('busy');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // → fn's result, or BUSY when the lock was not free within LOCK_WAIT
  async function withCheckoutLock(fn) {
    const locks = navigator.locks;
    if (locks && typeof locks.request === 'function') {
      let got = false;
      const stop = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = stop ? setTimeout(() => stop.abort(), LOCK_WAIT) : 0;
      try {
        return await locks.request(LOCK_NAME, stop ? { signal: stop.signal } : {}, () => { got = true; clearTimeout(timer); return fn(); });
      } catch (e) {
        if (got) throw e;
        if (e && e.name === 'AbortError') return BUSY; // not free in time
        // the browser refused the lock itself: the lease instead
      } finally {
        clearTimeout(timer);
      }
    }
    return withLease(fn);
  }
  const readLease = () => { try { const v = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
  const leaseFree = (v, now = Date.now()) => !v || typeof v.owner !== 'string' || !Number.isFinite(v.at) || now - v.at > LEASE_TTL || v.at - now > LEASE_TTL;
  async function withLease(fn) {
    const owner = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const write = () => { try { localStorage.setItem(LEASE_KEY, JSON.stringify({ owner, at: Date.now() })); return true; } catch { return false; } };
    const end = Date.now() + LOCK_WAIT;
    let held = false;
    while (!held) {
      if (leaseFree(readLease())) {
        if (!write()) return fn(); // storage unusable: nothing to share the lease through
        await sleep(60); // another tab may have written at the same moment: the last write wins
        const v = readLease();
        held = !!v && v.owner === owner;
      }
      if (!held) {
        if (Date.now() > end) return BUSY;
        await sleep(150 + Math.random() * 100);
      }
    }
    const renew = setInterval(() => { const v = readLease(); if (v && v.owner === owner) write(); }, LEASE_TTL / 4);
    try {
      return await fn();
    } finally {
      clearInterval(renew);
      const v = readLease();
      if (v && v.owner === owner) { try { localStorage.removeItem(LEASE_KEY); } catch { /* ignore */ } }
    }
  }
  function dropParams(...names) {
    try {
      const u = new URL(location.href);
      names.forEach((n) => u.searchParams.delete(n));
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch { /* ignore */ }
  }

  // body of POST /api/checkout. The server prices everything again. expectedTotal is only the
  // お支払い合計 this page showed, so the server can refuse (409 price_changed) when its own total differs.
  // confirmDuplicate: the shopper chose to order again what was paid a short while ago (409 duplicate_paid)
  function checkoutPayload({ confirmDuplicate = false } = {}) {
    const ev = eventOrder();
    const v = (k) => String(draft[k] || '').trim();
    return {
      ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
      expectedTotal: totals(destPref()).total,
      items: cart.map((l) => ({ pid: l.pid, vid: l.vid, qty: l.qty })),
      customer: { name1: v('name1'), name2: v('name2'), kana1: v('kana1'), kana2: v('kana2'), zip: v('zip'), pref: v('pref'), addr1: v('addr1'), addr2: v('addr2'), tel: v('tel'), email: v('email') },
      shipTo: draft.giftTo ? { name: v('sname'), zip: v('szip'), pref: v('spref'), addr1: v('saddr1'), addr2: v('saddr2'), tel: v('stel') } : null,
      date: hasPreorder() || ev ? '' : v('date'),
      time: v('time'),
      memo: String(draft.memo || ''),
      source: ev ? ev.slug : '',
    };
  }
  // the Stripe page: https only (plain http is allowed for a local test server)
  const payUrlOk = (u) => {
    try {
      const x = new URL(String(u));
      return x.protocol === 'https:' || (x.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname));
    } catch { return false; }
  };
  // opts.confirmDuplicate: see checkoutPayload
  async function placeLive(opts = {}) {
    const clicked = cartSig(cart);
    let r;
    try {
      r = await withCheckoutLock(() => placeLocked(clicked, opts));
    } catch (err) {
      // unexpected: the button is usable again
      console.error(err);
      r = null;
      if (placing) { const m = 'エラーが発生しました。時間をおいて、もう一度お試しください。'; resetPlace(m); toast(m); }
    }
    if (r === BUSY) {
      resetPlace(LOCK_BUSY);
      if (currentRoute === 'checkout-confirm') toast(LOCK_BUSY);
    }
  }
  // closing earlier Stripe pages → POST /api/checkout → listing the new Stripe page, one tab at a time
  async function placeLocked(clicked, opts) {
    // the shopper left the confirm page while this waited
    if (currentRoute !== 'checkout-confirm' || !cart.length || !draft.ok) { placing = false; return; }
    // the cart is not the one this page showed (changed or ordered in another tab, maybe unnoticed here)
    if (staleCart() || cartSig(cart) !== clicked) { onStaleCart(); return; }
    // every Stripe page opened earlier in this browser (this tab or another) is closed first,
    // so that only one can ever be paid
    const prev = await closeAllSessions();
    if (prev.state === 'paid') return; // its thanks page is shown instead
    // one was paid for other goods (e.g. some of these, before more were added): no new Stripe page
    // yet, or those goods could be bought twice. The shopper looks at the cart, and the next press goes on.
    if (prev.state === 'paidOther') { onPaidOther(prev.paidNos); return; }
    if (prev.state === 'failed') { resetPlace(CLOSE_FAILED); toast(CLOSE_FAILED); return; }
    // the shopper left the confirm page meanwhile
    if (currentRoute !== 'checkout-confirm' || !cart.length || !draft.ok) { placing = false; return; }
    if (cartSig(cart) !== clicked) { onStaleCart(); return; }
    const shown = totals(destPref()).total;
    const sig = cartSig(cart);
    let res;
    try {
      res = await API.createCheckout(checkoutPayload(opts));
      if (!res || !payUrlOk(res.url)) {
        throw new API.APIError('決済画面を開けませんでした。時間をおいて、もう一度お試しください。', { code: 'bad_response' });
      }
    } catch (err) {
      await onCheckoutError(err);
      return;
    }
    const sessionId = typeof res.sessionId === 'string' && SESSION_RE.test(res.sessionId) ? res.sessionId : '';
    // the server priced the order differently from this page (price or 送料表 changed since it was opened):
    // never send the shopper to Stripe for an amount they were not shown. That Stripe page is closed.
    if (typeof res.total === 'number' && res.total !== shown) {
      if (sessionId) {
        sess.set(CHECKOUT_KEY, { ...(sess.get(CHECKOUT_KEY) || {}), orderNo: String(res.orderNo || ''), sessionId, sig });
        listOpen(sessionId, res.orderNo, sig);
        closeSession(sessionId); // 'failed' is retried before the next checkout
      }
      await onPriceChanged();
      return;
    }
    // kept for this tab only: restores the form when the shopper comes back without paying, and
    // sessionId closes that Stripe page then (or before the next checkout)
    sess.set(CHECKOUT_KEY, { draft: { ...draft }, cart, orderNo: String(res.orderNo || ''), sessionId, at: Date.now(), sig });
    // listed for all tabs: a checkout started in another tab closes it first
    if (sessionId) listOpen(sessionId, res.orderNo, sig);
    waitForRedirect();
    location.assign(res.url);
  }
  // load the latest catalog and show the confirm page again with the new お支払い合計
  const PRICE_CHANGED = '価格または送料が変更されました。新しいお支払い合計をご確認のうえ、もう一度「注文を確定する」を押してください。';
  async function onPriceChanged() {
    let fresh = false;
    try {
      const d = await API.getCatalog();
      if (d && d.catalog) { S.setCatalog(d.catalog, d.rev); fresh = true; }
    } catch { /* keep the data we have */ }
    loadCart(); // also applies the fresh catalog (sold out, stock, max qty)
    saveCart();
    renderCount();
    placing = false;
    if (currentRoute === 'checkout-confirm') renderRoute();
    const m = fresh ? PRICE_CHANGED : '最新の価格を読み込めませんでした。時間をおいて、ページを開き直してください。';
    resetPlace(m);
    toast(m);
    const b = $('#placeOrder');
    if (b) b.focus({ preventScroll: true });
  }
  // an earlier Stripe page was found paid for other goods than this cart (closeAllSessions 'paidOther'):
  // the confirm page again, with that order named next to the button and focused (read out, in view)
  const paidOtherText = (nos, wrap = (n) => n) => `前回のご注文${nos.length ? `（ご注文番号 ${nos.map(wrap).join('、')}）` : ''}は、お支払いが完了しています。カートの内容をご確認のうえ、もう一度「注文を確定する」を押してください。`;
  function onPaidOther(nos) {
    placing = false;
    if (currentRoute !== 'checkout-confirm') return; // the notice above the page says it
    renderRoute();
    resetPlace(paidOtherText(nos));
    const pe = $('#placeError');
    if (!pe) return;
    // the order numbers stay on one line
    pe.innerHTML = paidOtherText(nos.map(esc), (n) => `<span class="nw">${n}</span>`);
    pe.tabIndex = -1;
    pe.focus({ preventScroll: true });
    const r = pe.getBoundingClientRect();
    if (r.top < 80 || r.bottom > window.innerHeight) pe.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  async function onCheckoutError(err) {
    const code = err && err.code;
    // the server refused because its total differs from the one this page showed (expectedTotal)
    if (code === 'price_changed') {
      await onPriceChanged();
      return;
    }
    // the same goods to the same address were paid a short while ago: nothing was made, the shopper decides
    if (code === 'duplicate_paid') {
      askDuplicate(err.details);
      return;
    }
    // the same order was started on another screen (another browser or phone) at about the same time, and
    // that newer one is the one to pay: nothing was made here. The server's message (pay on that screen)
    // goes next to the button; the cart and the form stay, and the button can be pressed again.
    if (code === 'duplicate_pending') {
      const msg = err.message;
      resetPlace(msg);
      toast(msg);
      return;
    }
    if (code === 'cart_changed') {
      const list = (Array.isArray(err.details) ? err.details : []).filter((it) => it && typeof it === 'object');
      // only goods other shoppers are paying for right now: what can be bought now stays in the cart
      // (a line with max ≥ 1 is set to that quantity), the rest is tried again later
      if (list.length && list.every((it) => it.code === 'held')) {
        const { notes, changed, waiting } = applyHeld(list);
        if (changed) {
          // the quantity changed, so does the お支払い合計: the confirm page again, to be checked
          saveCart();
          renderCount();
          if (!$('#cartDrawer').hidden) renderDrawer();
          placing = false;
          if (currentRoute === 'checkout-confirm') renderRoute();
        }
        const msg = notes.join('') + (changed && !waiting ? 'お支払い合計をご確認のうえ、もう一度「注文を確定する」を押してください。' : '');
        resetPlace(msg);
        toast(msg);
        const b = changed && $('#placeOrder');
        if (b) b.focus({ preventScroll: true });
        return;
      }
      await reconcileCart(err.details);
      placing = false;
      location.hash = 'cart';
      return;
    }
    if (code === 'invalid') {
      const list = (Array.isArray(err.details) ? err.details : []).filter((e) => e && typeof e === 'object');
      placing = false;
      if (list.length && list.every((e) => e.field === 'items')) {
        cartNotice = list.map((e) => String(e.message || 'カートの内容をご確認ください。'));
        location.hash = 'cart';
        return;
      }
      fieldErrors = list.length ? list : [{ field: '', message: err.message }];
      draft.ok = false;
      location.hash = 'checkout';
      return;
    }
    // payments_unavailable, subscription_not_supported, network, …
    const msg = (err && err.message) || 'エラーが発生しました。時間をおいて、もう一度お試しください。';
    resetPlace(msg);
    toast(msg);
  }
  // 409 duplicate_paid, details { orderNo, paidAt }: the same goods for the same address and email
  // were paid a short while ago (two browsers, a lost redirect…). Nothing was made. A question takes the
  // place of the order button: 注文内容を確認する shows that order (the cart and form are cleared, as for
  // any paid order); もう一度注文する sends the order again with confirmDuplicate.
  function askDuplicate(details) {
    const d = details && typeof details === 'object' ? details : {};
    const no = typeof d.orderNo === 'string' ? d.orderNo.slice(0, 40) : '';
    const at = typeof d.paidAt === 'number' ? d.paidAt : Date.parse(String(d.paidAt || ''));
    const min = Number.isFinite(at) ? Math.floor(Math.max(0, Date.now() - at) / 60000) : -1;
    const when = min < 0 ? 'すでに' : min < 1 ? 'つい先ほど' : `${min}分前に`;
    const head = (n) => `同じ内容のご注文${no ? `（ご注文番号 ${n}）` : ''}のお支払いが、${when}完了しています。`;
    const ask = 'もう一度同じ内容でご注文しますか？';
    resetPlace();
    const btn = $('#placeOrder');
    if (currentRoute !== 'checkout-confirm' || !btn) { toast(head(no)); return; }
    const box = document.createElement('div');
    box.className = 'notice notice--warn dup-ask';
    box.id = 'dupAsk';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-labelledby', 'dupAskHead');
    box.setAttribute('aria-describedby', 'dupAskText');
    // the order number stays on one line
    box.innerHTML = `<b id="dupAskHead">${head(`<span class="nw">${esc(no)}</span>`)}</b>
      <span id="dupAskText">${ask}</span>
      <span class="dup-ask__actions">
        <button class="btn btn--gold btn--sm" type="button" data-dup="view">注文内容を確認する</button>
        <button class="btn btn--line btn--sm" type="button" data-dup="again">もう一度注文する</button>
      </span>`;
    btn.hidden = true;
    btn.before(box);
    $('[data-dup="view"]', box).addEventListener('click', () => showPaidOrder(no));
    $('[data-dup="again"]', box).addEventListener('click', () => { startPlace({ confirmDuplicate: true }); announce(PLACING_TEXT); });
    $('[data-dup="view"]', box).focus({ preventScroll: true });
    if (box.getBoundingClientRect().top < 80 || box.getBoundingClientRect().bottom > window.innerHeight) box.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  // the question about a duplicate order goes; the order button is back
  function removeDupAsk() {
    const box = $('#dupAsk');
    if (box) box.remove();
    const btn = $('#placeOrder');
    if (btn) btn.hidden = false;
  }
  // that earlier order (409 duplicate_paid): its thanks page, as when an earlier Stripe page is found paid.
  // It was for these goods and this address, so the details come from this page.
  function showPaidOrder(no) {
    const ev = eventOrder();
    paymentDone({
      orderNo: no, name: `${draft.name1 || ''} ${draft.name2 || ''}`.trim(),
      preorder: hasPreorder(), mixed: mixedPreorder(), preorderShip: preorderShip(), eventNote: ev ? ev.shipNote : '',
    });
    location.hash = 'thanks';
  }
  const itemName = (it) => String(it.name || (S.product(it.pid) || {}).name || 'ご注文の商品');
  // 409 cart_changed, code 'held': stock is left, but other shoppers are paying for it right now
  // (the server keeps it for them until their Stripe page is paid or closed)
  const heldText = (list) => `${[...new Set(list.map(itemName))].map((n) => `「${n}」`).join('')}は、ほかのお客さまがお支払い手続き中のため、ただいまご購入いただけません。しばらくしてから、もう一度お試しください。`;
  // max: how many of it can be bought now (other shoppers' checkouts hold the rest of the stock, or —
  // when the server caps what one address may hold — phones behind the same address, e.g. the venue's
  // Wi-Fi, hold the rest of that). ≥ 1: the line is set to that quantity. 0: none now, and the line stays
  // as it is to try again later.
  // → { notes (for the shopper), changed (a quantity was lowered), waiting (goods with max 0) }
  function applyHeld(list) {
    const notes = [];
    const none = [];
    let changed = false;
    for (const it of list) {
      const max = Math.floor(Number(it.max));
      if (!(max >= 1)) { none.push(it); continue; }
      const cut = cart.filter((l) => l.pid === it.pid && l.vid === it.vid && l.qty > max);
      cut.forEach((l) => { l.qty = max; });
      if (cut.length) changed = true;
      notes.push(`「${itemName(it)}」は、ほかのお客さまがお支払い手続き中のため、いまは${max}点までご購入いただけます。${cut.length ? `数量を${max}点にしました。` : ''}`);
    }
    if (none.length) notes.push(heldText(none));
    return { notes, changed, waiting: none.length > 0 };
  }
  // 409 cart_changed: load the latest catalog, then fix the cart and list what changed on #cart
  async function reconcileCart(details) {
    try {
      const d = await API.getCatalog();
      if (d && d.catalog) S.setCatalog(d.catalog, d.rev);
    } catch { /* keep the data we have */ }
    const notes = [];
    const list = (Array.isArray(details) ? details : []).filter((it) => it && typeof it === 'object');
    for (const it of list) {
      if (it.code === 'held') continue;
      const hit = cart.filter((l) => l.pid === it.pid && l.vid === it.vid);
      const name = itemName(it);
      const max = Math.floor(Number(it.max));
      if ((it.code === 'stock' || it.code === 'qty') && max >= 1) {
        hit.forEach((l) => { l.qty = Math.min(l.qty, max); });
        notes.push(`「${name}」は、${it.code === 'stock' ? '在庫' : '1回のご注文でお求めいただける数'}に合わせて、数量を${max}点にしました。`);
      } else if (it.code === 'event_only') {
        // an event-only product outside its event (the server goes by Japan time)
        cart = cart.filter((l) => !hit.includes(l));
        notes.push(closedText([name]));
      } else {
        cart = cart.filter((l) => !hit.includes(l));
        notes.push(`「${name}」は、${it.code === 'sold_out' ? '売り切れの' : '販売を終了した'}ため、カートから外しました。`);
      }
    }
    const held = list.filter((it) => it.code === 'held');
    if (held.length) notes.push(...applyHeld(held).notes); // these stay in the cart (max ≥ 1: that many)
    saveCart();
    loadCart(); // also applies the fresh catalog (sold out, stock, max qty)
    renderCount();
    cartNotice = notes.length ? notes : ['在庫や販売状況が変わった商品があります。'];
  }
  // back from Stripe without paying (canceled=1) or with an expired session.
  // → true when the saved cart was left out because an order was paid since (another tab, or its thanks page)
  function restoreCheckout(ok) {
    const saved = sess.get(CHECKOUT_KEY);
    if (!saved || typeof saved !== 'object') return false;
    if (saved.draft && typeof saved.draft === 'object') {
      draft = {};
      for (const [k, v] of Object.entries(saved.draft)) if (k !== 'ok' && (typeof v === 'string' || typeof v === 'boolean')) draft[k] = v;
      if (ok) draft.ok = true;
    }
    let paidSince = false;
    if (!cart.length && Array.isArray(saved.cart) && saved.cart.length) {
      // emptied by an order paid after this tab left for Stripe (another tab, or its thanks page): not brought back
      if (paidAt() > (Number(saved.at) || 0)) paidSince = true;
      else {
        saveCart(saved.cart);
        loadCart();
        // event-only goods whose event ended while the shopper was on the Stripe page stay out (also in
        // storage): the cart page lists them
        const closed = closedInStore();
        if (closed) closedNotes.push(closed);
      }
    }
    // the saved cart is used once: a cart the shopper empties afterwards stays empty.
    // The form (draft) is kept, so a reload of the confirm page still shows it, and so is the session id.
    if ('cart' in saved) sess.set(CHECKOUT_KEY, { draft: saved.draft, orderNo: saved.orderNo, sessionId: saved.sessionId, sig: saved.sig });
    return paidSince;
  }

  // GET /api/checkout/status after Stripe sent the shopper back (success_url)
  // payCheck.state: 'pending' (checking) | 'slow' (still pending after a few tries) | 'error' | 'expired' | 'missing'
  let payCheck = null;
  let payTimer = 0;
  const PAY_TRIES = 5;
  function checkPayment() {
    if (!payCheck) return;
    clearTimeout(payTimer);
    const id = payCheck.id;
    API.checkoutStatus(id).then((r) => {
      if (!payCheck || payCheck.id !== id) return;
      const mine = payCheck.mine;
      if (r && r.payment === 'paid') { if (mine) forgetSession(id); paymentDone(r, { mine }); return; }
      // that Stripe page can no longer be paid: nothing to close
      if (r && r.payment === 'expired') { if (mine) { restoreCheckout(false); forgetSession(id); } endPayCheck('expired'); return; }
      payCheck.tries++;
      if (payCheck.tries < PAY_TRIES) { setPayState('pending'); payTimer = setTimeout(checkPayment, 2000); }
      else setPayState('slow');
    }, (err) => {
      if (!payCheck || payCheck.id !== id) return;
      if (err && (err.status === 404 || err.code === 'not_found')) { if (payCheck.mine) forgetSession(id); endPayCheck('missing'); }
      else setPayState('error', (err && err.message) || '');
    });
  }
  function setPayState(state, message = '') {
    const changed = payCheck.state !== state || payCheck.message !== message;
    payCheck.state = state;
    payCheck.message = message;
    if (changed) refreshThanks();
  }
  // a final answer: keep it on screen and drop ?session_id from the address
  function endPayCheck(state) {
    setPayState(state);
    dropParams('session_id');
  }
  // mine: false for a session_id this browser never opened (a pasted or shared link): its status is shown,
  // and the cart, the form and the saved order of this browser stay as they are
  function paymentDone(r, { mine = true } = {}) {
    lastOrder = orderOf(r);
    paidShown.add(lastOrder.no);
    if (mine) {
      sess.set(LAST_ORDER_KEY, lastOrder);
      notePaid();
      // the paid session is never closed; another one still open in this tab (unusual) stays saved
      keepOnlySession();
      cart = []; draft = {};
      // goods taken out at load because their event ended were in this paid order: nothing to tell
      closedNotes = [];
      saveCart();
      renderCount();
      if (!$('#cartDrawer').hidden) renderDrawer();
    }
    payCheck = null;
    dropParams('session_id');
    refreshThanks();
  }
  function recheckPayment() {
    if (!payCheck) return;
    payCheck.tries = 0;
    setPayState('pending');
    checkPayment();
  }
  // re-render #thanks after a status change; focus moves to the heading if it was on a removed button
  function refreshThanks() {
    if (currentRoute !== 'thanks') return;
    const a = document.activeElement;
    const inView = !!(a && view().contains(a));
    renderRoute();
    if (inView || !a || a === document.body) { const h = $('[data-page-focus]', view()); if (h) h.focus({ preventScroll: true }); }
    const h2 = $('.thanks h2', view());
    if (h2) announce(h2.textContent);
  }

  let lastOrder = null;
  const thanksTitle = () => {
    const st = payCheck ? payCheck.state : '';
    if (!st) return 'ご注文完了';
    return st === 'missing' ? 'ご注文の確認' : 'お支払いの確認';
  };
  function renderThanks() {
    const st = payCheck ? payCheck.state : '';
    const title = thanksTitle();
    const toCart = '<a class="btn btn--gold" href="#cart">カートを見る</a><a class="btn btn--line" href="#">買いものを続ける</a>';
    let body = '';
    let actions = '<a class="btn btn--line" href="#">買いものを続ける</a><a class="btn btn--line" href="index.html">トップへ戻る</a>';
    if (st === 'pending') {
      body = '<h2>お支払いを確認しています</h2><p>Stripeの決済画面でのお支払いを確認しています。このまま少しお待ちください。</p>';
      actions = '';
    } else if (st === 'slow' || st === 'error') {
      body = `<h2>${st === 'slow' ? 'お支払いの確認に時間がかかっています' : 'お支払いを確認できませんでした'}</h2>
        ${st === 'error' && payCheck.message ? `<p>${esc(payCheck.message)}</p>` : ''}
        <p>決済画面でお支払いが済んでいる場合は、確認ができしだいご注文を承ります。少し時間をおいて、もう一度確認してください。二重のお支払いを避けるため、もう一度ご注文いただく前に、この画面でご確認ください。</p>`;
      actions = '<button class="btn btn--gold" type="button" id="payRecheck">もう一度確認する</button>';
    } else if (st === 'expired') {
      body = '<h2>お支払いが完了していません</h2><p>お支払いの手続きが完了しなかったため、ご注文は確定していません。カートの商品はそのまま残っています。</p>';
      actions = toCart;
    } else if (st === 'missing') {
      body = '<h2>ご注文の情報が見つかりませんでした</h2><p>お手数ですが、カートの内容を確かめて、もう一度ご購入手続きをお願いします。</p>';
      actions = toCart;
    } else if (lastOrder) {
      body = `
              <h2>ご注文ありがとうございました</h2>
              <p class="thanks__no">ご注文番号<b>${esc(lastOrder.no)}</b></p>
              <p>${esc(lastOrder.name)} さま、ご注文を承りました。${lastOrder.preorder ? (lastOrder.mixed ? `ご注文の商品は、予約商品の発送（${esc(lastOrder.ship)}）にあわせてまとめてお届けします。` : `予約商品は、${esc(lastOrder.ship)}。`) : lastOrder.eventNote ? esc(lastOrder.eventNote) : '準備が整いしだい発送いたします。'}</p>
              ${LIVE ? '<p class="notice">お問い合わせの際は、ご注文番号をお伝えください。</p>' : '<p class="notice">デモサイトのため、確認メールの送信や実際の発送は行われません。</p>'}`;
    } else {
      body = `<h2>ご注文番号を表示できません</h2><p>ご注文の手続きが済むと、この画面にご注文番号が表示されます。${LIVE ? '' : 'ページを開き直した場合は表示されません。'}</p>`;
    }
    view().innerHTML = `
      ${pageHead(title, [['トップ', 'index.html'], [title]], stepsBar(st ? 2 : 3))}
      <div class="page-body">
        <div class="container">
          <div class="thanks${st === 'pending' ? ' is-busy' : ''}">
            <img class="thanks__moon" src="assets/img/moon-sm.webp" alt="">
            ${body}
            ${actions ? `<div class="thanks__actions">${actions}</div>` : ''}
          </div>
        </div>
      </div>`;
    const re = $('#payRecheck');
    if (re) re.addEventListener('click', recheckPayment);
  }

  /* ---------- guide ---------- */
  // 送料表: 13 regions × weight classes, from settings.ship.rates.
  // Scrolls sideways inside its own box on narrow screens (first column stays put).
  const MINE_NOTE = '<span class="visually-hidden" data-mine-note>（送料の目安で選んだ地域）</span>';
  const isMine = (r) => !!estPref && r.prefs.includes(estPref);
  function rateTableHTML(s) {
    const short = (p) => (p === '北海道' ? p : p.replace(/[都府県]$/, ''));
    return `
      <div class="rate-wrap" role="region" aria-labelledby="rateCap" tabindex="0">
        <table class="rate-table">
          <caption id="rateCap">地域別の送料（1箱あたり・税込・単位：円）</caption>
          <thead><tr><th scope="col">お届け先</th>${C.SHIP_CLASSES.map((c) => `<th scope="col">${c}kg<small>まで</small></th>`).join('')}</tr></thead>
          <tbody>
            ${C.SHIP_REGIONS.map((r) => {
              const prefs = r.prefs.map(short);
              // each prefecture name stays on one line (breaks only at ・)
              const sub = prefs.join('・') !== r.name ? `<small>${prefs.map((p) => `<span class="nw">${esc(p)}</span>`).join('・')}</small>` : '';
              const mine = isMine(r);
              return `
            <tr data-region="${esc(r.id)}"${mine ? ' class="is-mine"' : ''}>
              <th scope="row"><b>${esc(r.name)}</b>${sub}${mine ? MINE_NOTE : ''}</th>
              ${s.ship.rates[r.id].map((fee) => `<td>${yen(fee)}</td>`).join('')}
            </tr>`; }).join('')}
          </tbody>
        </table>
      </div>`;
  }
  // the 送料の目安 prefecture changed while the 送料表 is on screen: move the highlight in place
  function markMineRows() {
    $$('.rate-table tr[data-region]').forEach((tr) => {
      const r = C.SHIP_REGIONS.find((x) => x.id === tr.dataset.region);
      const mine = !!r && isMine(r);
      tr.classList.toggle('is-mine', mine);
      const note = $('[data-mine-note]', tr);
      if (mine && !note) $('th', tr).insertAdjacentHTML('beforeend', MINE_NOTE);
      else if (!mine && note) note.remove();
    });
  }
  function renderGuide() {
    const pend = '<span class="pending">（準備中）</span>';
    const s = settings();
    // 送料込みの商品 on sale now (e.g. 北海道満喫セット during the event)
    const inclNames = onSale().filter((p) => p.options.shipIncluded).map((p) => p.name);
    // event orders: from the event page, or with an event-only product
    const evOn = S.eventActive(s.event);
    // event-only goods on sale now (北海道満喫セット): the carrier is settled (ヤマト運輸 or 佐川急便, 2026-10-15)
    // but not the temperature of the seafood, so the guide only promises 常温便 for the rice while they are sold
    const evGoods = [...new Set(onSale().filter((p) => p.options.eventOnly).map((p) => p.name))];
    const evKinds = ['イベントページからのご注文', evGoods.length ? 'イベント限定の商品を含むご注文' : ''].filter(Boolean);
    // 「Aと、B」「A、Bと、C」
    const andList = (xs) => { xs = xs.filter(Boolean); return xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join('、')}と、${xs[xs.length - 1]}`; };
    const evWhat = andList(evKinds);
    // the event's shipNote without its own 「イベントでのご注文は、」 (the label already says which orders),
    // and without the closing 「。」 like the other lines of the cell
    const evWhen = (() => {
      const n = String(s.event.shipNote || '').trim();
      const body = n.replace(/^[^、。]*ご注文(?:分)?は、/, '').replace(/。$/, '');
      return body || n.replace(/。$/, '');
    })();
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
                  <li><i>01</i><b>商品を選ぶ</b><span>内容量を選んで、カートに入れます。</span></li>
                  <li><i>02</i><b>お客様情報</b><span>お名前・ご住所・お届け先を入力します。</span></li>
                  <li><i>03</i><b>ご確認・お支払い</b><span>ご注文内容を確かめて注文を確定し、Stripeの決済画面からクレジットカードでお支払いいただきます。</span></li>
                  <li><i>04</i><b>お届け</b><span>K NEXT株式会社から、<span class="nw">ヤマト運輸</span>または<span class="nw">佐川急便</span>でお届けします。</span></li>
                </ol>
              </section>
              <section class="guide__sec" id="g-pay">
                <h2>お支払い</h2>
                <ul class="dots">
                  ${PAYMENTS.map((p) => `<li>${p.label}　<span${LIVE ? '' : ' class="pending"'}>${payNote(p)}</span></li>`).join('')}
                </ul>
              </section>
              <section class="guide__sec" id="g-ship">
                <h2>送料・お届け</h2>
                <p>送料は、お届け先の地域と荷物の重さで決まります（税込）。1箱30kgまでお届けし、30kgを超える場合は複数の箱に分けてお届けします。その場合の送料は、箱ごとの送料の合計です。</p>
                <p class="guide__example">例：5kgの袋を2つなら、1箱（10kgまで）の送料です。30kgの袋と5kgの袋なら、2箱（30kgまで＋5kgまで）の送料の合計です。</p>
                ${freeText(s) ? `<p class="guide__free">${esc(freeText(s))}</p>` : ''}
                ${inclNames.length ? `<p class="guide__incl">${esc(inclNames.join('・'))}は送料込みの価格です。ほかの商品と一緒にご注文いただいた場合、送料はほかの商品の分だけかかります${s.ship.freeOver > 0 ? '（送料無料の金額にも、送料込みの商品は含みません）' : ''}。</p>` : ''}
                ${rateTableHTML(s)}
                <div class="table-wrap"><table class="spec-table"><tbody>
                  <tr><th scope="row">配送方法</th><td>${evGoods.length ? `ヤマト運輸または佐川急便<br>お米：常温便／${esc(evGoods.join('・'))}の温度帯：${pend}` : 'ヤマト運輸または佐川急便（常温便）'}</td></tr>
                  <tr><th scope="row">発送時期</th><td>${sellsPreorder() ? '通常商品：ご購入いただいた順に、順次発送<br>予約商品：各商品ページに記載の時期に発送' : 'ご購入いただいた順に、順次発送'}${evOn && evWhen ? `<br>${evWhat}：${esc(evWhen)}` : ''}</td></tr>
                  <tr><th scope="row">日時指定</th><td>ご注文日の4日後以降の日付と、時間帯をお選びいただけます${sellsPreorder() || evOn ? `（${andList([sellsPreorder() ? '予約商品を含むご注文' : '', ...(evOn ? evKinds : [])])}は日付指定不可）` : ''}</td></tr>
                </tbody></table></div>
              </section>
              <section class="guide__sec" id="g-return">
                <h2>返品・交換</h2>
                <p>食品のため、お客様のご都合による返品・交換はお受けできません。商品の破損や誤配送があった場合は、商品到着後7日以内にご連絡ください。送料当店負担で交換いたします。</p>
              </section>
              <section class="guide__sec" id="g-law">
                <h2>特定商取引法に基づく表記</h2>
                <div class="table-wrap"><table class="spec-table"><tbody>
                  <tr><th scope="row">販売業者</th><td>K NEXT株式会社</td></tr>
                  <tr><th scope="row">運営責任者</th><td>代表取締役社長　桑田 貴裕</td></tr>
                  <tr><th scope="row">所在地</th><td>${pend}</td></tr>
                  <tr><th scope="row">電話番号</th><td>${pend}</td></tr>
                  <tr><th scope="row">メールアドレス</th><td>${pend}</td></tr>
                  <tr><th scope="row">販売価格</th><td>各商品ページに税込価格で表示しています</td></tr>
                  <tr><th scope="row">商品代金以外の費用</th><td>送料（お届け先の地域と重さにより異なります。${inclNames.length ? '送料込みの商品は、価格に送料を含みます。' : ''}「送料・お届け」をご覧ください）</td></tr>
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
    thanks: { title: thanksTitle, render: renderThanks },
    guide: { title: 'ご利用ガイド', render: renderGuide },
    'guide-ship': { title: '送料・お届け', render: renderGuide, anchor: 'g-ship' },
    'guide-law': { title: '特定商取引法に基づく表記', render: renderGuide, anchor: 'g-law' },
    'guide-privacy': { title: 'プライバシーポリシー', render: renderGuide, anchor: 'g-privacy' },
  };
  const SITE = '満月米 オンラインショップ';
  let currentRoute = null;
  // an element to focus after the route change instead of the page heading (e.g. a field the server rejected)
  let pendingFocus = null;
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
      currentRoute = id;
      PAGES[id].render();
      const t = PAGES[id].title;
      document.title = `${typeof t === 'function' ? t() : t}｜${SITE}`;
    } else {
      const cat = id.startsWith('category-') ? id.slice(9) : '';
      const c = cat && S.category(cat);
      const shown = !!c && S.listedProducts().some((x) => x.category === c.id);
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
    // the "cart changed" list is shown once, on the cart page it was made for
    if (currentRoute !== 'cart') cartNotice = null;
    // the order an "already paid" notice pointed at is on screen now
    if (currentRoute === 'thanks') removePaidNote();
    if (prev === currentRoute && prev !== null) { focusPending(); return; }
    const pg = PAGES[currentRoute];
    const st = history.state || {};
    if (typeof st.y === 'number') requestAnimationFrame(() => window.scrollTo({ top: st.y, behavior: 'instant' }));
    else if (pg && pg.anchor) requestAnimationFrame(() => { const t = document.getElementById(pg.anchor); if (t) t.scrollIntoView({ behavior: 'instant' }); });
    else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (prev !== null) {
      const h = pageFocusTarget();
      if (h) h.focus({ preventScroll: true });
    }
    focusPending();
  }
  // where focus goes on a new page: the heading of the section a route points at (#guide-ship → 送料・お届け),
  // otherwise the page heading
  function pageFocusTarget() {
    const pg = PAGES[currentRoute];
    const h = (pg && pg.anchor && $(`#${pg.anchor} h2`, view())) || $('[data-page-focus]', view());
    if (h && !h.hasAttribute('tabindex')) h.tabIndex = -1;
    return h;
  }
  function focusPending() {
    const f = pendingFocus;
    pendingFocus = null;
    if (f && f.isConnected) f.focus();
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
      const t = (IS_SHOP && view() && pageFocusTarget()) || $('#main');
      if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
      t.focus({ preventScroll: true });
      t.scrollIntoView({ block: 'start', behavior: 'instant' });
      return;
    }
    if (e.target.closest('[data-reload]')) { location.reload(); return; }
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
      if (t) {
        t.scrollIntoView({ behavior: 'instant' });
        const h = pageFocusTarget();
        if (h) h.focus({ preventScroll: true });
      } else window.scrollTo({ top: 0, behavior: 'instant' });
    }
  });

  // 送料の目安 (cart drawer / cart page)
  document.addEventListener('change', (e) => {
    const sel = e.target.closest && e.target.closest('[data-ship-pref]');
    if (sel) onEstPref(sel);
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
    if (!booted || key === S.KEYS.orders) return;
    const before = cart;
    loadCart();
    // event-only goods whose event the shop closed (or that left its page): told by name, like closedToCart
    const closed = closedInStore(before);
    const notes = [closed];
    if (key !== S.KEYS.cart && before.length) {
      const lost = before.some((l) => !cart.some((x) => lineKey(x) === lineKey(l)) && !closedGoods(S.product(l.pid)));
      const cut = before.some((l) => { const x = cart.find((y) => lineKey(y) === lineKey(l)); return x && x.qty < l.qty; });
      if (lost || cut) { saveCart(); notes.push(lost ? '販売を終了した商品・売り切れの商品を、カートから外しました。' : '在庫に合わせて、カートの数量を変更しました。'); }
    }
    renderCount();
    if (!$('#cartDrawer').hidden) renderDrawer(closed ? notes.filter(Boolean).join('') : '');
    if (closed) { if (tellClosed(notes)) return; } else if (notes[1]) toast(notes[1]);
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
  // live mode: Stripe sends the shopper back with ?session_id=… (paid?) or ?canceled=1.
  // Returns a message to show once the page is up.
  function returnFromStripe() {
    if (!LIVE || !IS_SHOP) return '';
    const q = new URLSearchParams(location.search);
    const sid = q.get('session_id');
    // (paid or not, it is only checked here: a session that came back through success_url is never closed)
    if (sid !== null) {
      if (SESSION_RE.test(sid)) {
        // only a Stripe page opened in this browser empties the cart and the saved form once it is paid;
        // a link with someone else's session_id just shows that payment's status
        const mine = sid === openSession() || isListed(sid);
        payCheck = { id: sid, state: 'pending', tries: 0, message: '', mine };
        if (hashId() !== 'thanks') history.replaceState(history.state, '', `${location.pathname}${location.search}#thanks`);
        checkPayment();
      } else dropParams('session_id');
      return '';
    }
    let note = '';
    if (q.has('canceled')) {
      note = restoreCheckout(true) ? PAID_SINCE : 'お支払いは完了していません。内容を確認して、もう一度お進みください。';
      dropParams('canceled');
    } else if (hashId() === 'checkout-confirm' && sess.get(CHECKOUT_KEY) && restoreCheckout(true)) {
      // back from the Stripe page with the browser's Back button (page not kept in the back/forward cache):
      // it reopens on the confirm page the shopper left from. Other pages leave the saved form alone.
      note = PAID_SINCE;
    }
    // the cart is empty: its page instead of the confirm page (no extra route change, which would hide the note)
    if (note === PAID_SINCE) history.replaceState(history.state, '', `${location.pathname}${location.search}#cart`);
    // a Stripe page this tab left unpaid is closed on any shop page (the shopper is no longer on it)
    closeOnReturn();
    // #thanks opened again (reload): show the order this tab just completed
    const last = sess.get(LAST_ORDER_KEY);
    if (last && typeof last === 'object' && typeof last.no === 'string') {
      lastOrder = { no: last.no, name: String(last.name || ''), preorder: !!last.preorder, mixed: !!last.mixed, ship: String(last.ship || ''), eventNote: String(last.eventNote || '') };
    }
    return note;
  }

  if (!IS_SHOP) {
    // links saved from the single-page version (index.html#item-teiki etc.) move to the shop
    const id = hashId();
    if (/^(item-|category-|cart$|checkout|thanks$|guide)/.test(id)) { location.replace(`shop.html#${id}`); return; }
  }
  if (LIVE) {
    // hides the demo-only notes in the HTML ([data-demo-only])
    document.documentElement.dataset.mode = 'live';
    // until the catalog arrives: no stale news link on the top page, a short note in the shop
    if (IS_SHOP) view().innerHTML = '<div class="page-body"><div class="container"><div class="empty" role="status"><span class="empty__moon" aria-hidden="true"></span><p>商品情報を読み込んでいます…</p></div></div></div>';
    else if ($('#heroNews')) $('#heroNews').hidden = true;
  }
  if (!IS_SHOP) updateHeader();
  // coming back through the back/forward cache from the Stripe page: that Stripe page is closed,
  // and the order button is usable again
  window.addEventListener('pageshow', (e) => {
    clearTimeout(redirectTimer);
    redirecting = false;
    if (!e.persisted) return;
    const wasPlacing = placing;
    placing = false;
    if (!booted) return;
    // a kept page misses what other pages did meanwhile (an order paid, the cart changed): read the cart again
    const changed = resyncCart();
    closeOnReturn();
    checkListed();
    // the order button is usable again (a changed cart has re-rendered the page already)
    if (IS_SHOP && !changed && wasPlacing && currentRoute === 'checkout-confirm') renderRoute();
  });

  // demo: resolves at once (before the first paint). live: after the catalog was fetched.
  S.ready().then((r) => {
    loadError = !!(r && r.error);
    loadCart();
    booted = true;
    const note = returnFromStripe();
    // event-only goods left in the saved cart after their event ended (S.loadCart leaves them out): the
    // stored cart is updated, and the shopper is told once. Read after returnFromStripe, which may put back
    // the cart of a canceled payment (restoreCheckout notes those itself). On the return from a payment
    // (#thanks) nothing is shown: its thanks page must not say the set was taken out, and a paid order
    // empties the cart and forgets the note (paymentDone)
    const c = closedInStore();
    if (c) closedNotes.push(c);
    const closed = [...new Set(closedNotes)].join('');
    // on the checkout screens: the cart page lists them instead, as when the event ends during checkout
    // (no extra route change, which would hide the note)
    if (IS_SHOP && closed && /^checkout/.test(hashId())) history.replaceState(history.state, '', `${location.pathname}${location.search}#cart`);
    renderCount();
    if (!$('#cartDrawer').hidden) renderDrawer();
    if (IS_SHOP) {
      window.addEventListener('hashchange', onHashChange);
      onHashChange(); // the cart page lists closedNotes
    } else {
      renderHome();
    }
    if (loadError) showLoadError();
    // elsewhere than the cart page: a toast instead (the thanks page keeps them for the cart page)
    const onCart = IS_SHOP && currentRoute === 'cart';
    const onThanks = IS_SHOP && currentRoute === 'thanks';
    if (IS_SHOP && !onCart && !onThanks) closedNotes = [];
    const msg = [note, onCart || onThanks ? '' : closed].filter(Boolean).join('');
    if (msg) toast(msg);
    // Stripe pages other tabs opened: paid there without coming back? (not while this tab checks its own)
    checkListed();
  });
  initTwinkles();
})();
