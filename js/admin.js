/* =========================================================
   満月米 管理画面 — admin.js
   画面：#dashboard / #products / #product-new / #product-<id>
        #categories / #orders / #event / #settings / #data
   デモ（js/config.js の apiBase が空）：
     データは store.js（このブラウザの localStorage）に保存。
     ショップを別タブで開いていれば、保存と同時に反映される。
   本番（apiBase あり）：
     管理用パスワードでログインし、商品・設定は API（server/）に保存する。
     注文は API から読み、写真は API にアップロードする。
   ========================================================= */
(() => {
  'use strict';

  const S = window.MangetsuStore;
  const U = window.MangetsuUI;
  const C = window.MangetsuCore;
  const API = window.MangetsuAPI || { enabled: false };
  const LIVE = !!S.LIVE;
  const { esc, yen } = U;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const main = $('#admMain');
  const clone = S.clone;

  const STATUS = { published: '公開中', draft: '非公開', soldout: '売り切れ' };
  const ORDER_STATUS = { new: '新規', preparing: '発送準備中', shipped: '発送済み', canceled: 'キャンセル' };
  const PAY_STATE = { paid: '決済済み', pending: '決済待ち', expired: '期限切れ' };
  const PAY_FILTER = { paid: '決済済みの注文', pending: '決済待ちの注文', all: 'すべて（決済待ち・期限切れを含む）' };
  const BAG_STYLES = { single: '1袋', double: '2袋セット', seal: '新米シール付き', phases: '定期便（月の満ち欠け）', plain: '無地の紙袋（玄米など）' };
  // event-only goods are left out of the top page's product grid (C.isListed), so they cannot be
  // starred: the top page shows them in the event banner instead (while they are on sale)
  const EVENT_FEATURE_NOTE = 'イベント限定の商品は、イベントの期間中、トップページのイベントのバナーで紹介されます';
  // thumb: a smaller copy for the picker buttons (the image itself is used when chosen)
  const BUILTIN_IMAGES = [
    // 実物の写真（2026-10 先方提供。背景を切り抜き）とチラシ
    { src: 'assets/img/products/shinmai-5kg.webp', alt: '満月米 ななつぼし 5kgの袋（実物の写真）', fit: 'contain' },
    { src: 'assets/img/products/shinmai-10kg.webp', alt: '5kgの袋を2つ（10kg）', fit: 'contain' },
    { src: 'assets/img/event/hokkaido-set.webp', thumb: 'assets/img/event/hokkaido-set-sm.webp', alt: '北海道満喫セットのチラシ', fit: 'contain' },
    { src: 'assets/img/bowl.webp', alt: '茶碗に盛った炊きたてのごはん', fit: 'contain' },
    { src: 'assets/img/rice-hand-sm.webp', alt: '手のひらにすくった精米', fit: 'cover' },
    { src: 'assets/img/moon-sm.webp', alt: '満月', fit: 'contain' },
    { src: 'assets/img/medal.webp', alt: '米-1グランプリ in らんこし 2025 金賞受賞メダル', fit: 'contain' },
    { src: 'assets/img/photo/grains.webp', thumb: 'assets/img/photo/grains-sm.webp', alt: '枡からこぼれる精米（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/onigiri.webp', thumb: 'assets/img/photo/onigiri-sm.webp', alt: 'おにぎり（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/teishoku.webp', thumb: 'assets/img/photo/teishoku-sm.webp', alt: '和食の食卓（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/gohan.webp', thumb: 'assets/img/photo/gohan-sm.webp', alt: '土鍋で炊いたごはん（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/ears-moon.webp', thumb: 'assets/img/photo/ears-moon-sm.webp', alt: '月あかりに実る稲穂（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/moon-paddy.webp', thumb: 'assets/img/photo/moon-paddy-sm.webp', alt: '満月と実りの田んぼ（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/summer.webp', thumb: 'assets/img/photo/summer-sm.webp', alt: '夏の夕暮れの田んぼ（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/winter.webp', thumb: 'assets/img/photo/winter-sm.webp', alt: '冬の夜の雪原（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/spring.webp', thumb: 'assets/img/photo/spring-sm.webp', alt: '山の湧き水（イメージ）', fit: 'cover' },
  ];
  // a picker button's image (the built-in's own src stays what is saved). Drawn by ui.js like the
  // shop's images, so a cut-out photo gets the same look (see imageHTML)
  const builtinImg = (b) => U.imageHTML({ src: b.thumb || b.src, fit: b.fit }, '');
  const ICON = {
    up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 10 8 5.5l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6 8 10.5 12.5 6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    del: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.4"/></svg>',
    star: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.2l2.3 5 5.4.5-4.1 3.6 1.2 5.3L10 13.9l-4.8 2.7 1.2-5.3-4.1-3.6 5.4-.5z" fill="currentColor"/></svg>',
    ext: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3h8v8M13 3 4 12" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  };

  /* ---------- small UI helpers ---------- */
  let toastTimer = 0;
  function toast(msg, { error = false, link } = {}) {
    const el = $('#admToast');
    el.className = `adm-toast${error ? ' is-error' : ''}`;
    el.innerHTML = `<span>${esc(msg)}</span>${link ? `<a href="${esc(link.href)}" target="_blank" rel="noopener">${esc(link.text)}</a>` : ''}`;
    el.hidden = false;
    el.onclick = (e) => { if (!e.target.closest('a')) el.hidden = true; };
    announce(msg);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, error ? 7000 : 3600);
  }
  function announce(msg) {
    const sr = $('#admStatus');
    sr.textContent = '';
    requestAnimationFrame(() => { sr.textContent = msg; });
  }

  // in-page confirmation dialog (window.confirm is avoided on purpose)
  function confirmDialog({ title, body, ok = 'OK', danger = false, cancel = 'キャンセル' }) {
    return new Promise((resolve) => {
      const modal = $('#admModal');
      const back = document.activeElement;
      modal.innerHTML = `
        <div class="adm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mdTitle" aria-describedby="mdBody">
          <h2 id="mdTitle">${esc(title)}</h2>
          <p id="mdBody">${body}</p>
          <div class="adm-dialog__actions">
            <button class="adm-btn" type="button" data-md="cancel">${esc(cancel)}</button>
            <button class="btn ${danger ? 'btn--danger' : 'btn--gold'} btn--sm" type="button" data-md="ok">${esc(ok)}</button>
          </div>
        </div>`;
      modal.hidden = false;
      const done = (v) => {
        modal.hidden = true; modal.innerHTML = '';
        document.removeEventListener('keydown', onKey, true);
        if (back && back.isConnected) back.focus({ preventScroll: true });
        resolve(v);
      };
      const onKey = (e) => {
        if ($('#admLogin:not([hidden])')) return; // the login dialog is on top and handles the keys
        if (e.key === 'Escape') { e.preventDefault(); done(false); }
        if (e.key === 'Tab') {
          const f = $$('button', modal);
          const i = f.indexOf(document.activeElement);
          e.preventDefault();
          f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        }
      };
      document.addEventListener('keydown', onKey, true);
      modal.onclick = (e) => {
        const b = e.target.closest('[data-md]');
        if (b) done(b.dataset.md === 'ok');
        else if (e.target === modal) done(false);
      };
      $('[data-md="cancel"]', modal).focus();
    });
  }

  /* ---------- saving the catalog ---------- */
  const SHOP_LINK = { href: '../shop.html', text: 'ショップで確認' };
  let saving = false;  // live: a save is on its way to the server
  let locked = LIVE;   // live: the login screen is showing
  // message for a failed API call. failed: what could not be done (「保存できませんでした」)
  const errText = (err, failed = '保存できませんでした') => (err && err.status === 401
    ? `ログインしていないため、${failed}。もう一度お試しください。`
    : (err && err.message) || 'エラーが発生しました。時間をおいて、もう一度お試しください。');
  const strip = (p) => JSON.stringify({ ...p, variants: p.variants.map(({ stock, ...v }) => v) }); // product without stock
  // used inside a change: the thing it works on was deleted on another screen meanwhile
  const gone = (what) => { toast(`${what}は、ほかの画面で削除されていました。最新の内容を表示します。`, { error: true }); return false; };

  // live: the catalog as read from the server (when, and the read in progress). See loadCatalog()
  const CATALOG_TTL = 30000;
  const catalogLoad = { at: 0, loading: null, error: null };

  // live: show that a save is running and keep buttons from being pressed twice
  // (aria-disabled instead of disabled, so the focus stays where it is).
  // The fields of the form being saved are locked (inert) meanwhile: the screen is drawn again
  // from the saved data afterwards, so anything typed during the save would be lost.
  // The save buttons are outside the locked parts.
  const LOCK_SEL = '#edForm > .adm-form, #setForm > .adm-sec, #evForm > .adm-sec, #catAdd > .adm-fields';
  let lockFocus = null; // the field that had the focus when its form was locked
  function busy(on) {
    saving = on;
    document.body.classList.toggle('is-saving', on);
    if (on) main.setAttribute('aria-busy', 'true'); else main.removeAttribute('aria-busy');
    $$('button[type="submit"]', main).forEach((b) => {
      if (on) { b.dataset.label = b.innerHTML; b.textContent = '保存しています…'; b.setAttribute('aria-disabled', 'true'); }
      else if (b.dataset.label !== undefined) { b.innerHTML = b.dataset.label; delete b.dataset.label; b.removeAttribute('aria-disabled'); }
    });
    const parts = $$(LOCK_SEL, main);
    if (on) {
      // saved from a field (Enter, Ctrl+S): the focus waits on the save button
      const a = document.activeElement;
      const part = parts.find((x) => x.contains(a));
      const sb = part && $('button[type="submit"]', part.closest('form'));
      if (sb) { lockFocus = a; sb.focus({ preventScroll: true }); }
    }
    parts.forEach((x) => { x.inert = on; x.classList.toggle('adm-locked', on); });
    if (!on) {
      const f = lockFocus;
      lockFocus = null;
      const a = document.activeElement;
      if (f && f.isConnected && (!a || a === document.body || a.matches('button[type="submit"]'))) f.focus({ preventScroll: true });
    }
    const st = $('#saveState', main);
    if (st && on) { st.dataset.prev = st.textContent; st.textContent = '保存しています…'; }
    else if (st && st.dataset.prev !== undefined) { st.textContent = st.dataset.prev; delete st.dataset.prev; }
  }

  // apply a change to the catalog and save it. mutate(c) edits c in place (or returns a whole
  // new catalog); returning false cancels. Resolves true when saved.
  // live: when the catalog was saved elsewhere first (409 — another screen, or an order that
  // reduced stock), the server's latest copy becomes the base and the change is applied to it
  // again: automatically, or after asking when conflict(latest) returns a question
  // ({ title, body, ok }). declined() runs when the owner chooses not to save.
  async function commit(mutate, okMsg, link = SHOP_LINK, { conflict = null, declined = null } = {}) {
    if (saving) { announce('保存しています。少しお待ちください。'); return false; }
    const build = () => { const c = clone(S.catalog()); const r = mutate(c); return r === false ? null : r && typeof r === 'object' ? r : c; };
    let next = build();
    if (!next) return false;
    if (!LIVE) {
      const r = S.saveCatalog(next);
      if (!r.ok) { toast(r.error, { error: true }); return false; }
      if (okMsg) toast(okMsg, link ? { link } : {});
      updateNavCounts();
      return true;
    }
    busy(true);
    try {
      for (let tries = 0; tries < 3; tries++) {
        try {
          const res = await api(() => API.admin.saveCatalog(S.normalize(next), S.rev()));
          S.setCatalog(res.catalog, res.rev);
          catalogLoad.at = Date.now();
          if (okMsg) toast(okMsg, link ? { link } : {});
          return true;
        } catch (err) {
          const latest = err && err.code === 'conflict' && err.details && err.details.catalog;
          if (!latest) throw err;
          S.setCatalog(latest, err.details.rev);
          catalogLoad.at = Date.now();
          const q = conflict && conflict(S.catalog());
          if (q) {
            busy(false);
            const ok = await confirmDialog(q);
            if (!ok) { if (declined) declined(); toast('保存していません。入力した内容は、そのまま残っています。'); return false; }
            busy(true);
          }
          next = build();
          if (!next) return false;
        }
      }
      toast('ほかの画面からの保存が続いたため、保存できませんでした。少し待ってから、もう一度お試しください。', { error: true });
      return false;
    } catch (err) {
      toast(errText(err), { error: true });
      return false;
    } finally {
      if (saving) busy(false);
    }
  }

  /* ---------- live mode: API calls and login ---------- */
  // run an API call. When the server says the login is no longer valid (401), ask for the
  // password again over the current screen (unsaved input stays as it is) and retry once
  async function api(call) {
    try { return await call(); }
    catch (err) {
      if (!err || err.status !== 401 || locked) throw err;
      API.admin.clearToken();
      if (!(await askLogin())) throw err;
      return call();
    }
  }
  let loginWait = null;
  const askLogin = () => loginWait || (loginWait = loginDialog().finally(() => { loginWait = null; }));

  const loginFields = (p) => `
    <div class="adm-field">
      <label for="${p}-pw">管理用パスワード</label>
      <div class="adm-pw">
        <input class="input" id="${p}-pw" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" enterkeyhint="go">
        <button class="adm-btn" type="button" data-pw-toggle="${p}-pw" aria-controls="${p}-pw" aria-label="パスワードを表示する">表示する</button>
      </div>
      <p class="adm-error" id="${p}-err" hidden></p>
    </div>`;
  function togglePassword(btn) {
    const inp = document.getElementById(btn.dataset.pwToggle);
    if (!inp) return;
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.textContent = show ? '隠す' : '表示する';
    btn.setAttribute('aria-label', show ? 'パスワードを隠す' : 'パスワードを表示する');
  }
  // check a password with the server (p: id prefix of the fields). → true when accepted
  async function tryLogin(p) {
    const inp = document.getElementById(`${p}-pw`);
    const pw = inp.value.trim();
    const fail = (msg) => { showErr(`${p}-err`, msg, `#${p}-pw`); announce(msg); inp.focus(); if (pw) inp.select(); return false; };
    if (!pw) return fail('パスワードを入力してください。');
    API.admin.setToken(pw);
    try { await API.admin.check(); }
    catch (err) {
      API.admin.clearToken();
      return fail(err.status === 401 ? 'パスワードが違います。もう一度入力してください。' : err.message);
    }
    showErr(`${p}-err`, '', `#${p}-pw`);
    return true;
  }
  const loginBusy = (b, on, label) => { if (on) { b.setAttribute('aria-disabled', 'true'); b.textContent = '確認しています…'; } else { b.removeAttribute('aria-disabled'); b.textContent = label; } };

  // full-page login (first visit, or after logging out)
  function showLogin(msg = '') {
    locked = true;
    draft = null; dirty = false; formDirty = false; currentRoute = null;
    document.body.classList.add('is-locked');
    $('#logoutBtn').hidden = true;
    document.title = 'ログイン｜管理画面｜満月米';
    main.innerHTML = `
      <div class="adm-login">
        <form class="adm-card adm-login__card" id="loginForm" novalidate>
          <span class="logo__moon" aria-hidden="true"></span>
          <h1 tabindex="-1" data-focus>管理画面にログイン</h1>
          ${msg ? `<p class="adm-login__msg">${esc(msg)}</p>` : ''}
          <p class="adm-muted">管理用のパスワードを入力してください。</p>
          ${loginFields('lg')}
          <button class="btn btn--gold btn--sm btn--block" type="submit">ログイン</button>
          <p class="adm-faint">ログインは、このタブを閉じるまで続きます。</p>
        </form>
      </div>`;
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const b = $('#loginForm [type="submit"]');
      if (b.getAttribute('aria-disabled') === 'true') return;
      loginBusy(b, true);
      if (await tryLogin('lg')) enter({ focus: true });
      else loginBusy(b, false, 'ログイン');
    });
    $('#lg-pw').focus();
  }

  // login again over the current screen (the login expired or the password was changed)
  function loginDialog() {
    return new Promise((resolve) => {
      let modal = $('#admLogin');
      if (!modal) {
        modal = document.createElement('div');
        modal.className = 'adm-modal'; modal.id = 'admLogin'; modal.hidden = true;
        document.body.appendChild(modal);
      }
      const back = document.activeElement;
      modal.innerHTML = `
        <form class="adm-dialog" role="dialog" aria-modal="true" aria-labelledby="rlTitle" aria-describedby="rlBody" novalidate>
          <h2 id="rlTitle">もう一度ログインしてください</h2>
          <p id="rlBody">ログインの有効期限が切れたか、パスワードが変更されました。入力中の内容は、そのまま残っています。</p>
          ${loginFields('rl')}
          <div class="adm-dialog__actions">
            <button class="adm-btn" type="button" data-rl-cancel>キャンセル</button>
            <button class="btn btn--gold btn--sm" type="submit">ログイン</button>
          </div>
        </form>`;
      modal.hidden = false;
      const done = (v) => {
        modal.hidden = true; modal.innerHTML = '';
        document.removeEventListener('keydown', onKey, true);
        if (back && back.isConnected) back.focus({ preventScroll: true });
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
        if (e.key === 'Tab') {
          const f = $$('input, button', modal);
          const i = f.indexOf(document.activeElement);
          e.preventDefault(); e.stopPropagation();
          f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        }
      };
      document.addEventListener('keydown', onKey, true);
      $('[data-rl-cancel]', modal).addEventListener('click', () => done(false));
      $('form', modal).addEventListener('submit', async (e) => {
        e.preventDefault();
        const b = $('[type="submit"]', modal);
        if (b.getAttribute('aria-disabled') === 'true') return;
        loginBusy(b, true);
        if (await tryLogin('rl')) { done(true); toast('ログインしました'); }
        else loginBusy(b, false, 'ログイン');
      });
      $('#rl-pw').focus();
    });
  }

  const loadingHTML = (msg) => `<div class="adm-card adm-empty adm-loading" role="status"><span class="empty__moon" aria-hidden="true"></span><p>${esc(msg)}</p></div>`;

  // live: check the saved password, then load the catalog
  async function boot() {
    if (!LIVE) { updateNavCounts(); renderRoute(); return; }
    document.body.classList.add('is-locked');
    $('.adm-brand small').textContent = '管理画面';
    $('.adm-note').textContent = '保存した内容は、すぐにショップに反映されます。';
    if (!API.admin.token()) { showLogin(); return; }
    main.innerHTML = loadingHTML('管理画面を読み込んでいます…');
    try { await API.admin.check(); }
    catch (err) {
      if (err.status === 401) { API.admin.clearToken(); showLogin(); return; }
      bootError(err); return;
    }
    enter();
  }
  async function enter({ focus = false } = {}) {
    locked = true;
    main.innerHTML = loadingHTML('管理画面を読み込んでいます…');
    try {
      const d = await API.admin.getCatalog();
      S.setCatalog(d.catalog, d.rev);
      catalogLoad.at = Date.now();
    } catch (err) {
      if (err.status === 401) { API.admin.clearToken(); showLogin('もう一度ログインしてください。'); return; }
      bootError(err); return;
    }
    locked = false;
    document.body.classList.remove('is-locked');
    $('#logoutBtn').hidden = false;
    renderRoute();
    if (focus) { const h = $('[data-focus]', main); if (h) h.focus({ preventScroll: true }); }
    loadOrders('paid');
  }
  function bootError(err) {
    document.title = '管理画面｜満月米';
    main.innerHTML = `${head('読み込めませんでした')}
      <div class="adm-card adm-empty"><p>管理画面のデータを読み込めませんでした。<br>${esc(errText(err, '読み込めませんでした'))}</p><button class="btn btn--line btn--sm" type="button" id="bootRetry">もう一度読み込む</button></div>`;
    $('#bootRetry').addEventListener('click', boot);
  }
  async function logout() {
    if (saving) { announce('保存しています。少しお待ちください。'); return; }
    if (hasUnsaved() && !(await confirmDialog({ title: 'ログアウトしますか？', body: '保存していない変更があります。ログアウトすると、変更は失われます。', ok: 'ログアウトする', cancel: '編集を続ける' }))) return;
    API.admin.clearToken();
    Object.keys(orderCache).forEach((k) => { delete orderCache[k]; });
    S.setCatalog(clone(S.DEFAULT_CATALOG), null);
    catalogLoad.at = 0;
    updateNavCounts();
    showLogin();
    toast('ログアウトしました');
  }

  /* ---------- orders (demo: this browser / live: the server, cached briefly) ---------- */
  const ORDER_TTL = 60000;
  const orderCache = {}; // live: payment filter → { list, at, error, loading }
  const ordersList = (payment = 'paid') => (LIVE ? (orderCache[payment] && orderCache[payment].list) || [] : S.orders());
  const ordersStatus = (payment = 'paid') => {
    const e = LIVE ? orderCache[payment] : { list: [] };
    return e && e.list ? 'ok' : e && e.error ? 'error' : 'loading';
  };
  // live: fetch the orders unless a recent copy exists. never rejects
  function loadOrders(payment = 'paid', { force = false } = {}) {
    if (!LIVE) return Promise.resolve(S.orders());
    const e = orderCache[payment] || (orderCache[payment] = { list: null, at: 0, error: null, loading: null });
    if (e.loading) return e.loading;
    if (!force && e.at && Date.now() - e.at < ORDER_TTL) return Promise.resolve(e.list);
    e.loading = api(() => API.admin.listOrders({ payment }))
      .then((d) => { e.list = Array.isArray(d && d.orders) ? d.orders : []; e.error = null; })
      .catch((err) => { e.error = err; })
      .then(() => { e.at = Date.now(); e.loading = null; if (orderCache[payment] === e) ordersLoaded(payment); return e.list; });
    return e.loading;
  }
  // refresh what shows orders on the current screen
  function ordersLoaded(payment) {
    updateNavCounts();
    if (locked) return;
    if (currentRoute === 'orders' && orderState.payment === payment) rerender(renderOrders);
    if (payment !== 'paid') return;
    if ($('#dashNew')) { $('#dashNew').innerHTML = dashNewHTML(); $('#dashRecent').innerHTML = dashRecentHTML(); $('#dashEvent').innerHTML = dashEventHTML(); }
    if ($('#evOrders')) $('#evOrders').innerHTML = eventOrdersHTML();
  }
  const patchCachedOrder = (o) => Object.values(orderCache).forEach((e) => { if (e.list) e.list = e.list.map((x) => (x.no === o.no ? o : x)); });

  /* ---------- catalog (live: read again from the server, like the orders) ---------- */
  // orders in the shop change the stock, and other screens may save meanwhile, so the screens
  // that show the catalog read it again when the copy here is older than CATALOG_TTL
  const FIELD_SEL = 'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, select';
  // what a newer catalog may do now: 'redraw' the screen, 'store' it (the screen does not show
  // it), or '' — not now: unsaved input, a save or a dialog, a photo on its way, or a control
  // in use that a redraw would take away
  function refreshMode() {
    if (locked || saving || !$('#admModal').hidden || $('#admLogin:not([hidden])')) return '';
    if (currentRoute === 'orders') return 'store';
    if (hasUnsaved() || uploadsFor(draft) || evUploading()) return '';
    const a = document.activeElement;
    if (a && a !== main && main.contains(a) && (a.matches(FIELD_SEL) || !(a.id || a.matches('[data-focus]')))) return '';
    return 'redraw';
  }
  // live: read the catalog unless a recent copy exists (force: always). A newer copy replaces the
  // one here only when refreshMode() allows; otherwise the screen keeps the copy it was drawn
  // from (so its save still meets the conflict check) and the next screen reads it again.
  // → the server's { catalog, rev }, or null when it could not be read. never rejects
  function loadCatalog({ force = false } = {}) {
    if (!LIVE || locked) return Promise.resolve(null);
    if (catalogLoad.loading) return catalogLoad.loading;
    if (!force && Date.now() - catalogLoad.at < CATALOG_TTL) return Promise.resolve(null);
    const p = api(() => API.admin.getCatalog())
      .then((d) => {
        catalogLoad.error = null;
        const rev = Number(d.rev), have = Number(S.rev());
        if (locked || rev < have) return d; // a save finished meanwhile: its copy is newer
        if (rev === have) { catalogLoad.at = Date.now(); return d; }
        const mode = refreshMode();
        if (!mode) return d;
        S.setCatalog(d.catalog, d.rev);
        catalogLoad.at = Date.now();
        updateNavCounts();
        if (mode === 'redraw') redrawCatalog();
        return d;
      }, (err) => { catalogLoad.error = err; return null; })
      .finally(() => { catalogLoad.loading = null; });
    catalogLoad.loading = p;
    return p;
  }
  // draw the current screen again with the newer catalog, keeping the scroll position and the
  // focus (a control with an id, or the heading)
  function redrawCatalog() {
    const a = document.activeElement;
    const sel = a && a !== main && main.contains(a) ? (a.id ? `#${CSS.escape(a.id)}` : '[data-focus]') : '';
    const y = window.scrollY;
    renderRoute();
    window.scrollTo({ top: y, behavior: 'instant' });
    const el = sel && $(sel, main);
    if (el) el.focus({ preventScroll: true });
  }
  // re-render a screen and keep the focus on the same control (by id)
  const rerender = (fn) => {
    const a = document.activeElement;
    const id = a && main.contains(a) ? a.id : '';
    fn();
    const el = id && document.getElementById(id);
    if (el) el.focus({ preventScroll: true });
  };

  const focusAfter = (sel) => { const el = sel && $(sel, main); const t = el && !el.disabled ? el : $('[data-focus]', main); if (t) t.focus({ preventScroll: true }); };

  const head = (title, { crumbs = [], actions = '', lead = '' } = {}) => `
    <div class="adm-head">
      <div class="adm-head__title">
        ${crumbs.length ? `<ol class="adm-crumbs">${crumbs.map(([t, h]) => `<li>${h ? `<a href="${h}">${esc(t)}</a>` : esc(t)}</li>`).join('')}</ol>` : ''}
        <h1 tabindex="-1" data-focus>${esc(title)}</h1>
      </div>
      ${actions ? `<div class="adm-head__actions">${actions}</div>` : ''}
    </div>
    ${lead ? `<p class="adm-lead">${lead}</p>` : ''}`;

  const thumb = (p) => `<span class="adm-thumb" aria-hidden="true">${U.visualHTML(p)}</span>`;
  const priceRange = (p) => {
    const ps = p.variants.map((v) => v.price);
    const lo = Math.min(...ps), hi = Math.max(...ps);
    return lo === hi ? `¥${yen(lo)}` : `¥${yen(lo)}〜¥${yen(hi)}`;
  };
  const stockText = (p) => {
    const managed = p.variants.filter((v) => v.stock !== null);
    if (!managed.length) return '<span class="adm-faint">管理しない</span>';
    return managed.map((v) => `${p.variants.length > 1 ? esc(v.label) + '：' : ''}<b${v.stock <= 5 ? ' style="color:var(--danger)"' : ''}>${v.stock}</b>`).join('<br>');
  };
  const kgText = (kg) => `${Math.round(Number(kg) * 10) / 10}kg`;
  const weightText = (p) => [...new Set(p.variants.map((v) => v.weight))].sort((a, b) => a - b).map(kgText).join('・');
  const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const catName = (id) => { const c = S.category(id); return c ? c.name : '未分類'; };
  // small labels under a product's name: イベント限定 / 送料込み (and an event-only product
  // that is not on the event page, so nobody can buy it)
  function productTags(p, c = S.catalog()) {
    const t = [];
    if (p.options.eventOnly) t.push('<span class="adm-tag">イベント限定</span>');
    if (p.options.shipIncluded) t.push('<span class="adm-tag">送料込み</span>');
    if (p.options.eventOnly && p.status !== 'draft' && !c.settings.event.products.includes(p.id)) t.push('<span class="adm-tag adm-tag--warn">イベントページに入っていません</span>');
    return t.length ? `<span class="adm-tags">${t.join('')}</span>` : '';
  }

  /* ---------- event period: 非公開 / 開始前 / 販売中 / 終了 ---------- */
  // e: settings.event (or the event form's values). Follows core.eventActive
  function eventPhase(e, today = S.today()) {
    if (!e.enabled) return 'off';
    if (e.start && today < e.start) return 'before';
    if (e.end && today > e.end) return 'after';
    return 'on';
  }
  const PHASE = { off: '非公開', before: '開始前', on: '販売中', after: '終了' };
  const PHASE_PILL = { off: 'draft', before: 'preparing', on: 'published', after: 'draft' };
  const phasePill = (ph) => `<span class="pill pill--${PHASE_PILL[ph]}">${PHASE[ph]}</span>`;
  const dateText = (d) => (d ? d.replace(/-/g, '/') : '');

  // shipping of an order: 「送料 ¥1,280（関東・1個口）」 when the order has shipDetail
  const parcelsOf = (o) => (o.shipDetail && Array.isArray(o.shipDetail.parcels) ? o.shipDetail.parcels : []);
  // the order has 送料込みの商品 (options.shipIncluded): they are not in the parcels nor in the fee
  const shipIncluded = (o) => !!(o.shipDetail && typeof o.shipDetail === 'object' && o.shipDetail.included === true);
  const hasShipNote = (o) => parcelsOf(o).length > 0 || shipIncluded(o);
  const SHIP_INCL = '<span class="adm-ship-incl">送料込みの商品を含む</span>';
  // withIncl false: the caller puts SHIP_INCL itself (the details show the boxes first)
  function shipLine(o, withIncl = true) {
    const ps = parcelsOf(o);
    const incl = withIncl && shipIncluded(o) ? SHIP_INCL : '';
    if (!ps.length) return incl ? `<span class="nowrap">送料 ¥${yen(o.ship)}</span>${incl}` : `送料 ¥${yen(o.ship)}`;
    const d = o.shipDetail;
    const region = d.region && typeof d.region === 'object' ? d.region.name : d.region;
    const free = Number(o.ship) === 0 && ps.some((p) => Number(p.fee) > 0);
    // unbreakable pieces, so a narrow table cell wraps only between them: 「送料 ¥0」「（送料無料・」「関東・1個口）」
    const where = esc([region, `${ps.length}個口`].filter(Boolean).join('・'));
    const pieces = [`送料 ¥${yen(o.ship)}`, ...(free ? ['（送料無料・', `${where}）`] : [`（${where}）`])];
    return pieces.map((x) => `<span class="nowrap">${x}</span>`).join('') + incl;
  }
  const parcelLine = (o) => { const ps = parcelsOf(o); return ps.length ? `箱の内訳：${ps.map((p) => `${esc(kgText(p.kg))} ¥${yen(p.fee)}`).join('／')}` : ''; };

  // text that wraps only between its phrases (a phrase longer than the line still wraps inside).
  // parts are HTML already escaped; sep ' ' keeps the spaces of a name, '<wbr>' joins Japanese phrases
  const phrases = (parts, sep = '<wbr>') => parts.map((p) => `<span class="adm-phrase">${p}</span>`).join(sep);
  // 「満月米 ななつぼし 新米 令和8年産 10kg（5kg×2袋） ×1」: the name breaks between its words,
  // the variant stays whole, and the quantity (or a tail like 「（1点）」) stays with the last part
  const variantOf = (it) => (it.variant && it.variant !== '通常' && !String(it.name).includes(it.variant) ? String(it.variant) : '');
  function wordPhrases(name, variant = '', tail = '') {
    const parts = String(name || '').split(/\s+/).filter(Boolean).map(esc);
    if (variant) parts.push(esc(variant));
    if (tail) { if (parts.length) parts[parts.length - 1] += tail; else parts.push(tail); }
    return phrases(parts, ' ');
  }
  // in the details also the gift wrapping and the line's price (kept with the quantity)
  const itemLine = (it, detail = false) => wordPhrases(it.name, variantOf(it), `${detail && it.gift ? `（${esc(it.gift)}）` : ''} ×${esc(it.qty)}${detail ? `　¥${yen(it.total)}` : ''}`);

  // live: Stripe took a different amount (or currency) than the order's total. The order still
  // counts as paid (the money was taken), so the owner has to check it before shipping
  const mismatchOf = (o) => (o.amountMismatch && typeof o.amountMismatch === 'object' ? o.amountMismatch : null);
  const MISMATCH_BADGE = '<span class="adm-error adm-short adm-flag">金額不一致</span>';
  function mismatchLine(m) {
    const cur = String(m.currency || '').toLowerCase();
    const n = Number(m.received);
    const got = m.received === null || m.received === undefined || m.received === '' || !Number.isFinite(n) ? '不明'
      : !cur || cur === 'jpy' ? `¥${yen(n)}` : `${yen(n)}（通貨：${esc(cur.toUpperCase())}）`;
    return `お支払い金額が注文の合計と違います：受け取り ${got}／注文 ¥${yen(m.expected)}。発送の前に Stripe のダッシュボードで確認してください。`;
  }

  // live: the postal code usually belongs to another prefecture than the one the shopper chose.
  // The order went through (the fee was charged for the chosen prefecture), so the owner checks
  // the address with the customer before shipping
  const addrWarningsOf = (o) => (Array.isArray(o.addressWarnings) ? o.addressWarnings.filter((w) => w && typeof w === 'object') : []);
  const ADDR_BADGE = '<span class="adm-error adm-short adm-flag">住所を確認</span>';
  const ADDR_WHO = { customer: 'ご注文者さま', shipTo: 'お届け先' };
  const str = (x) => (typeof x === 'string' || typeof x === 'number' ? String(x).trim() : '');
  // a label from a fixed map, '' for anything else (never an inherited key like 'constructor')
  const own = (map, k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(map, k) ? map[k] : '');
  // '0950000' → '095-0000' (anything else is shown as it came)
  const zipText = (z) => { const s = str(z); return /^\d{3}-?\d{4}$/.test(s) ? `${s.slice(0, 3)}-${s.slice(-4)}` : s; };
  // ['山梨県', '静岡県'] → 「山梨県か静岡県」
  const orText = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join('、')}か${xs[xs.length - 1]}` : xs.join(''));
  function addrWarningLine(w, o) {
    const who = own(ADDR_WHO, w.who) ? `${own(ADDR_WHO, w.who)}の` : '';
    const ask = '発送の前にお客さまに確認してください。';
    if (w.code !== 'zip_pref_mismatch') return `${esc(who)}ご住所に、確認が必要な点があります。${ask}`;
    const zip = zipText(w.zip);
    const pref = str(w.pref);
    const expected = (Array.isArray(w.expected) ? w.expected : []).map(str).filter(Boolean);
    // the fee goes by where the parcel is sent: the customer's own address only when there is no other one
    const ships = w.who === 'shipTo' || (w.who === 'customer' && !o.shipTo);
    const zipHTML = zip ? `<span class="nowrap">〒${esc(zip)}</span>` : '';
    const chosen = pref ? `選ばれた都道府県（${esc(pref)}）` : '選ばれた都道府県';
    const fee = ships && pref ? `送料は${esc(pref)}で計算されています。` : '';
    return expected.length
      ? `${esc(who)}郵便番号${zipHTML}は、ふつう${esc(orText(expected))}の番号です。${chosen}と合っているか、${ask}${fee}`
      : `${esc(who)}郵便番号${zipHTML}が、${chosen}と合っていない可能性があります。${ask}${fee}`;
  }
  const addrWarningItems = (ws, o) => ws.map((w) => `<li class="adm-error">${addrWarningLine(w, o)}</li>`).join('');

  // live: paid with a Stripe test card (test keys), so no money came in — never ship it
  const isTestPay = (o) => !!(o.stripe && typeof o.stripe === 'object' && o.stripe.livemode === false);
  const TEST_BADGE = '<span class="adm-error adm-short adm-flag">テスト決済</span>';
  const TEST_LINE = 'Stripe のテスト用カードでの決済です。実際の入金はありません。発送しないでください。';

  // live: a product was sold out / hidden / deleted by the time the payment went through.
  // The money was taken, so the owner decides whether it can still be shipped or refunds it
  const unavailableOf = (o) => (Array.isArray(o.unavailable) ? o.unavailable.filter((u) => u && typeof u === 'object' && !Array.isArray(u)) : []);
  const UNAVAIL_BADGE = '<span class="adm-error adm-short adm-flag">販売停止後の決済</span>';
  // event_ended: an event-only product whose event was over (or that was taken off the event page)
  const UNAVAIL_REASON = { soldout: '売り切れでした', draft: '非公開でした', deleted: '削除済みでした', event_ended: 'イベントでの販売を終えていました' };
  // 「満月米 ななつぼし 新米（5kg）」: the name as it was ordered (the line in 内訳), else the one sent with the flag
  function unavailableName(u, o) {
    const pid = str(u.pid), vid = str(u.vid);
    const it = pid ? (Array.isArray(o.items) ? o.items : []).find((x) => x && typeof x === 'object' && str(x.pid) === pid && str(x.vid) === vid && str(x.name)) : null;
    const name = it ? str(it.name) : str(u.name);
    const variant = it ? str(it.variant) : str(u.variant);
    if (!name) return 'ご注文の商品の一つ';
    return variant && variant !== '通常' && !name.includes(variant) ? `${name}（${variant}）` : name;
  }
  function unavailableItems(us, o) {
    const lines = us.map((u) => {
      const why = own(UNAVAIL_REASON, u.reason);
      return `${esc(unavailableName(u, o))}は、お支払いの時点で${why || '販売していませんでした'}。発送できるか確認し、できない場合は Stripe のダッシュボードから返金してください。`;
    });
    return [...new Set(lines)].map((x) => `<li class="adm-error">${x}</li>`).join('');
  }

  function updateNavCounts() {
    const n = ordersList().filter((o) => o.status === 'new').length;
    const el = $('#navOrderCount');
    el.hidden = !n;
    el.textContent = n;
    el.setAttribute('aria-label', `新規 ${n}件`);
  }

  /* =========================================================
     Dashboard
     ========================================================= */
  // the parts that show orders are filled again when the live orders arrive
  function dashNewHTML() {
    const st = ordersStatus();
    if (st !== 'ok') return `—<small>${st === 'error' ? '読み込めませんでした' : '読み込み中'}</small>`;
    const orders = ordersList();
    return `${orders.filter((o) => o.status === 'new').length}<small>件／全${orders.length}件</small>`;
  }
  function dashRecentHTML() {
    const st = ordersStatus();
    if (st === 'loading') return '<p class="adm-muted">注文を読み込んでいます…</p>';
    if (st === 'error') return '<p class="adm-muted">注文を読み込めませんでした。<a class="link" href="#orders">注文一覧で読み込み直す</a></p>';
    const orders = ordersList();
    if (!orders.length) return `<p class="adm-muted">${LIVE ? 'まだ注文はありません。カードでのお支払いが済んだ注文が、ここに表示されます。' : 'まだ注文はありません。ショップで試しに注文すると、ここに表示されます。'}</p>`;
    return `
          <div class="adm-table-wrap adm-table-wrap--recent" style="box-shadow:none;background:none">
            <table class="adm-table adm-table--recent"><thead><tr><th>注文番号・日時</th><th>お客様</th><th class="adm-num">合計</th><th>状態</th></tr></thead><tbody>
              ${orders.slice(0, 5).map((o) => `<tr><td class="cell-no">${esc(o.no)}<span class="adm-order-at">${fmtDate(o.at)}</span></td><td data-label="お客様">${wordPhrases((o.customer || {}).name)}${addrWarningsOf(o).length ? ADDR_BADGE : ''}</td><td class="adm-num" data-label="合計">¥${yen(o.total)}${hasShipNote(o) ? `<small class="adm-ship-note">${shipLine(o)}</small>` : ''}</td><td class="cell-status" data-label="状態"><span class="pill pill--${esc(o.status)}">${ORDER_STATUS[o.status] || ''}</span>${isTestPay(o) ? TEST_BADGE : ''}${mismatchOf(o) ? MISMATCH_BADGE : ''}${unavailableOf(o).length ? UNAVAIL_BADGE : ''}</td></tr>`).join('')}
            </tbody></table>
          </div>`;
  }
  function dashEventHTML() {
    const e = S.catalog().settings.event;
    return ordersStatus() === 'ok' ? `${ordersList().filter((o) => o.source === e.slug).length}件` : '—';
  }
  function renderDashboard() {
    const c = S.catalog();
    const ps = c.products;
    loadOrders('paid');
    const lowStock = ps.filter((p) => p.variants.some((v) => v.stock !== null && v.stock <= 5));
    const count = (st) => ps.filter((p) => p.status === st).length;
    main.innerHTML = `
      ${head('ダッシュボード', { actions: `<a class="btn btn--gold btn--sm" href="#product-new">${ICON.plus}商品を追加</a>` })}
      <dl class="adm-stats">
        <div class="adm-stat"><dt>公開中の商品</dt><dd>${count('published')}<small>件</small></dd><a href="#products">商品一覧へ</a></div>
        <div class="adm-stat"><dt>非公開の商品</dt><dd>${count('draft')}<small>件</small></dd><a href="#products?status=draft" data-filter="draft">見る</a></div>
        <div class="adm-stat"><dt>売り切れ</dt><dd>${ps.filter((p) => S.productSoldOut(p)).length}<small>件</small></dd><a href="#products" data-filter="soldout">見る</a></div>
        <div class="adm-stat"><dt>新規の注文</dt><dd id="dashNew">${dashNewHTML()}</dd><a href="#orders">注文一覧へ</a></div>
      </dl>
      <div class="adm-grid2">
        <section class="adm-card">
          <div class="adm-card__head"><h2>最近の注文</h2><a class="adm-muted" href="#orders">すべて見る</a></div>
          <div id="dashRecent">${dashRecentHTML()}</div>
        </section>
        <div>
          <section class="adm-card">
            <h2>在庫が少ない商品</h2>
            ${lowStock.length ? `<ul class="adm-checks">${lowStock.map((p) => `<li class="adm-prod">${thumb(p)}<span class="adm-prod__name"><a href="#product-${esc(p.id)}">${esc(p.name)}</a><small>${p.variants.filter((v) => v.stock !== null && v.stock <= 5).map((v) => `${esc(v.label)} 残り${v.stock}`).join('／')}</small></span></li>`).join('')}</ul>`
              : '<p class="adm-muted">在庫が5点以下の商品はありません（在庫を管理している商品のみ表示）。</p>'}
          </section>
          <section class="adm-card">
            <h2>イベントページ</h2>
            ${(() => { const e = c.settings.event; return `<p>${phasePill(eventPhase(e))}　${esc(e.title)}</p><p class="adm-muted" style="margin-top:6px">イベントからの注文：<span id="dashEvent">${dashEventHTML()}</span>　<a class="link" href="#event">QRコード・設定</a></p>`; })()}
          </section>
          ${LIVE ? `
          <section class="adm-card">
            <h2>使い方</h2>
            <ol class="adm-howto">
              <li><b>1</b><span>「商品」で、商品を追加・編集して保存します。保存した内容は、すぐに<a class="link" href="../shop.html" target="_blank" rel="noopener">ショップ</a>に反映されます。</span></li>
              <li><b>2</b><span>お客さまがカードでのお支払いを済ませると、「注文」に届きます。</span></li>
              <li><b>3</b><span>発送の準備ができたら、注文の状態を「発送準備中」「発送済み」などに変えて管理します。</span></li>
            </ol>
          </section>` : `
          <section class="adm-card">
            <h2>このデモの使い方</h2>
            <ol class="adm-howto">
              <li><b>1</b><span>「商品」で、商品を追加・編集して保存します。</span></li>
              <li><b>2</b><span><a class="link" href="../shop.html" target="_blank" rel="noopener">ショップ</a>を別のタブで開いておくと、保存した内容がすぐに反映されます。</span></li>
              <li><b>3</b><span>ショップで注文すると、「注文」に届きます。状態を「発送済み」などに変えて管理できます。</span></li>
            </ol>
            <p class="adm-faint" style="margin-top:12px">デモ版のため、データはこのブラウザの中にだけ保存されます。ほかの人の画面には反映されません。</p>
          </section>`}
        </div>
      </div>`;
  }

  /* =========================================================
     Products list
     ========================================================= */
  const listState = { q: '', cat: '', status: '' };
  function renderProducts() {
    const c = S.catalog();
    if (listState.cat && listState.cat !== '__none' && !c.categories.some((k) => k.id === listState.cat)) listState.cat = '';
    const filtered = c.products.filter((p) =>
      (!listState.q || `${p.name} ${p.id} ${p.meta}`.toLowerCase().includes(listState.q.toLowerCase()))
      && (!listState.cat || (listState.cat === '__none' ? !S.category(p.category) : p.category === listState.cat))
      && (!listState.status || (listState.status === 'soldout' ? S.productSoldOut(p) : p.status === listState.status)));
    const filtering = !!(listState.q || listState.cat || listState.status);
    main.innerHTML = `
      ${head('商品', { actions: `<a class="btn btn--gold btn--sm" href="#product-new">${ICON.plus}商品を追加</a>`, lead: 'ショップの「おすすめ順」は、この一覧の並び順です。★ を付けた商品は、トップページの「満月米をお届けします」に表示されます（最大4件）。' })}
      <div class="adm-toolbar" role="search">
        <label class="visually-hidden" for="fQ">商品を検索</label>
        <input class="input" id="fQ" type="search" placeholder="商品名・IDで検索" value="${esc(listState.q)}">
        <label class="visually-hidden" for="fCat">カテゴリで絞り込む</label>
        <select class="select" id="fCat">
          <option value="">すべてのカテゴリ</option>
          ${c.categories.map((k) => `<option value="${esc(k.id)}" ${listState.cat === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}
          <option value="__none" ${listState.cat === '__none' ? 'selected' : ''}>未分類</option>
        </select>
        <label class="visually-hidden" for="fStatus">状態で絞り込む</label>
        <select class="select" id="fStatus">
          <option value="">すべての状態</option>
          ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${listState.status === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <span class="adm-toolbar__note">${filtered.length}件${filtering ? '（絞り込み中は並べ替えできません）' : ''}</span>
      </div>
      ${filtered.length ? `
      <div class="adm-table-wrap">
        <table class="adm-table adm-table--cards">
          <thead><tr><th><span class="visually-hidden">並び順</span></th><th>商品</th><th>カテゴリ</th><th class="adm-num">価格（税込）</th><th>在庫</th><th>状態</th><th>トップ</th><th><span class="visually-hidden">操作</span></th></tr></thead>
          <tbody>
            ${filtered.map((p) => {
              const i = c.products.indexOf(p);
              return `
              <tr data-id="${esc(p.id)}">
                <td class="cell-order">
                  <span class="adm-order">
                    <button class="adm-btn adm-btn--icon adm-btn--quiet" type="button" data-move="-1" aria-label="${esc(p.name)}を上へ" ${filtering || i === 0 ? 'aria-disabled="true"' : ''}>${ICON.up}</button>
                    <button class="adm-btn adm-btn--icon adm-btn--quiet" type="button" data-move="1" aria-label="${esc(p.name)}を下へ" ${filtering || i === c.products.length - 1 ? 'aria-disabled="true"' : ''}>${ICON.down}</button>
                  </span>
                </td>
                <td class="cell-prod"><div class="adm-prod">${thumb(p)}<span class="adm-prod__name"><a href="#product-${esc(p.id)}">${esc(p.name)}</a><small>ID：${esc(p.id)}${p.meta ? `　${esc(p.meta)}` : ''}</small>${productTags(p, c)}</span></div></td>
                <td data-label="カテゴリ">${esc(catName(p.category))}</td>
                <td class="adm-num" data-label="価格">${priceRange(p)}${p.options.subscription ? '<span class="adm-faint">／回</span>' : ''}<small class="adm-weight">重さ ${weightText(p)}</small></td>
                <td data-label="在庫">${stockText(p)}</td>
                <td data-label="状態">
                  <label class="visually-hidden" for="st-${esc(p.id)}">${esc(p.name)}の状態</label>
                  <select class="select adm-status-select" id="st-${esc(p.id)}" data-status-of="${esc(p.id)}" data-status="${p.status}">
                    ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v}</option>`).join('')}
                  </select>
                </td>
                <td data-label="トップ">${p.options.eventOnly
                  ? `<button class="adm-star" type="button" data-feature="${esc(p.id)}" aria-pressed="false" aria-disabled="true" aria-label="${esc(p.name)}をトップページに表示（イベント限定の商品のため、選べません）" title="${EVENT_FEATURE_NOTE}">${ICON.star}</button>`
                  : `<button class="adm-star" type="button" data-feature="${esc(p.id)}" aria-pressed="${p.featured}" aria-label="${esc(p.name)}をトップページに表示">${ICON.star}</button>`}</td>
                <td class="cell-actions">
                  <div class="adm-row-actions">
                    <a class="adm-btn" href="#product-${esc(p.id)}">編集</a>
                    <button class="adm-btn" type="button" data-dup="${esc(p.id)}">複製</button>
                    ${p.status !== 'draft' ? `<a class="adm-btn adm-btn--quiet" href="../shop.html#item-${esc(p.id)}" target="_blank" rel="noopener" aria-label="${esc(p.name)}をショップで見る（新しいタブ）">${ICON.ext}</a>` : ''}
                    <button class="adm-btn adm-btn--icon adm-btn--danger" type="button" data-del="${esc(p.id)}" aria-label="${esc(p.name)}を削除">${ICON.del}</button>
                  </div>
                </td>
              </tr>`; }).join('')}
          </tbody>
        </table>
      </div>` : `<div class="adm-card adm-empty"><span class="empty__moon" aria-hidden="true"></span><p>${filtering ? '条件に合う商品はありません。' : 'まだ商品がありません。'}</p><a class="btn btn--gold btn--sm" href="#product-new">${ICON.plus}商品を追加</a></div>`}`;

    const refilter = () => { const f = document.activeElement && document.activeElement.id; renderProducts(); if (f) { const el = document.getElementById(f); if (el) { el.focus(); if (el.setSelectionRange && el.type === 'search') el.setSelectionRange(el.value.length, el.value.length); } } };
    $('#fQ').addEventListener('input', (e) => { if (e.isComposing) return; listState.q = e.target.value; refilter(); });
    $('#fQ').addEventListener('compositionend', (e) => { listState.q = e.target.value; refilter(); });
    $('#fCat').addEventListener('change', (e) => { listState.cat = e.target.value; refilter(); });
    $('#fStatus').addEventListener('change', (e) => { listState.status = e.target.value; refilter(); });
  }

  async function productAction(e) {
    const r0 = S.rev();
    // live: a failed save may have brought newer data from the server, so show it
    const refreshed = () => currentRoute === 'products' && LIVE && S.rev() !== r0;
    const mv = e.target.closest('[data-move]');
    if (mv) {
      if (mv.getAttribute('aria-disabled') === 'true') return;
      const id = mv.closest('tr').dataset.id;
      const step = Number(mv.dataset.move);
      const ok = await commit((c) => {
        const i = c.products.findIndex((p) => p.id === id);
        const j = i + step;
        if (i < 0) return gone('この商品');
        if (j < 0 || j >= c.products.length) return false;
        [c.products[i], c.products[j]] = [c.products[j], c.products[i]];
      });
      if (ok && currentRoute === 'products') {
        renderProducts();
        const again = $(`tr[data-id="${CSS.escape(id)}"] [data-move="${mv.dataset.move}"]`);
        const row = $(`tr[data-id="${CSS.escape(id)}"] a`);
        (again && again.getAttribute('aria-disabled') !== 'true' ? again : row || main).focus();
        announce('並び順を変更しました');
      } else if (refreshed()) renderProducts();
      return;
    }
    const star = e.target.closest('[data-feature]');
    if (star) {
      const id = star.dataset.feature;
      const noStar = 'イベント限定の商品には、★を付けられません。イベントの期間中は、トップページのイベントのバナーで紹介されます。';
      if (star.getAttribute('aria-disabled') === 'true') { toast(noStar); return; }
      const want = !(S.product(id) || {}).featured;
      let many = false, eventOnly = false;
      const ok = await commit((c) => {
        const p = c.products.find((x) => x.id === id);
        if (!p) return gone('この商品');
        // made event-only on another screen meanwhile
        eventOnly = !!p.options.eventOnly;
        if (eventOnly) return false;
        p.featured = want;
        // only the stars that can be shown there (event-only goods are not in the top page's grid)
        many = want && c.products.filter((x) => x.featured && !x.options.eventOnly).length > 4;
      });
      if (eventOnly) {
        if (currentRoute === 'products') { renderProducts(); const again = $(`[data-feature="${CSS.escape(id)}"]`); if (again) again.focus(); }
        toast(noStar);
        return;
      }
      if (ok && many) toast('トップページには、★の付いた商品のうち並び順の上から4件が表示されます。');
      if (ok && currentRoute === 'products') { renderProducts(); const again = $(`[data-feature="${CSS.escape(id)}"]`); if (again) again.focus(); announce(want ? 'トップページに表示します' : 'トップページに表示しません'); }
      else if (refreshed()) renderProducts();
      return;
    }
    const dup = e.target.closest('[data-dup]');
    if (dup) {
      const sid = dup.dataset.dup;
      let newId = '';
      const ok = await commit((c) => {
        const src = c.products.find((x) => x.id === sid);
        if (!src) return gone('複製しようとした商品');
        const copy = clone(src);
        const base = src.id.slice(0, 33);
        let n = 2; copy.id = `${base}-copy`;
        while (c.products.some((x) => x.id === copy.id)) copy.id = `${base}-copy${n++}`;
        copy.name = `${src.name}（コピー）`;
        copy.status = 'draft';
        copy.featured = false;
        c.products.splice(c.products.indexOf(src) + 1, 0, copy);
        newId = copy.id;
      }, '複製しました（非公開の状態です）', null);
      if (ok && currentRoute === 'products') location.hash = `product-${newId}`;
      else if (refreshed()) renderProducts();
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const p = S.product(del.dataset.del);
      if (!p) return;
      const ok = await confirmDialog({ title: '商品を削除しますか？', body: `「${esc(p.name)}」を削除します。元に戻すことはできません。<br>一時的に隠したいときは、状態を「非公開」にしてください。`, ok: '削除する', danger: true });
      if (!ok) return;
      const done = await commit((c) => { c.products = c.products.filter((x) => x.id !== p.id); }, '削除しました', null);
      if ((done || refreshed()) && currentRoute === 'products') { renderRoute(); focusAfter(); }
    }
  }
  async function productChange(e) {
    const sel = e.target.closest('[data-status-of]');
    if (!sel) return;
    const id = sel.dataset.statusOf;
    const value = sel.value;
    const r0 = S.rev();
    const ok = await commit((c) => {
      const p = c.products.find((x) => x.id === id);
      if (!p) return gone('この商品');
      p.status = value;
    });
    if (currentRoute !== 'products') return;
    if (ok || (LIVE && S.rev() !== r0)) { renderProducts(); const again = $(`#st-${CSS.escape(id)}`); if (again) again.focus(); }
    else if (sel.isConnected) sel.value = sel.dataset.status;
    const p = S.product(id);
    if (ok && p) toast(`「${p.name}」を${STATUS[p.status]}にしました`);
  }

  /* =========================================================
     Product editor
     ========================================================= */
  let draft = null;        // product being edited
  let originalId = null;   // null for a new product
  let dirty = false;
  let openedStock = new Map(); // variant stock when the editor was opened
  let baseJSON = null;         // product as it was when the editor was opened
  const blankProduct = () => ({
    id: `item-${Date.now().toString(36).slice(-5)}`,
    name: '', category: (S.catalog().categories[0] || {}).id || '', status: 'draft', featured: false,
    meta: '', badge: { text: '', line: true }, card: '', when: 'ご購入順に順次発送', lead: '', ship: 'ご購入いただいた順に、順次発送します',
    visual: { kind: 'image', src: '', fit: 'cover' }, gallery: [],
    variants: [{ id: 'v1', label: '', price: '', stock: null, weight: 5 }],
    options: { gift: false, award: false, preorder: false, subscription: false, traits: false, eventOnly: false, shipIncluded: false },
    specs: [['名称', ''], ['内容量', ''], ['賞味期限', ''], ['保存方法', ''], ['配送方法', '常温便'], ['生産者', '満月農園（北海道士別市上士別町）']],
  });

  function renderEditor(id) {
    if (id === 'new') { draft = blankProduct(); originalId = null; openedStock = new Map(); baseJSON = null; }
    else {
      const p = S.product(id);
      if (!p) {
        draft = null; dirty = false;
        main.innerHTML = `${head('商品が見つかりません', { crumbs: [['商品', '#products']] })}<div class="adm-card adm-empty"><p>この商品は削除されたか、IDが変わった可能性があります。</p><a class="btn btn--line btn--sm" href="#products">商品一覧へ戻る</a></div>`;
        return;
      }
      draft = clone(p); originalId = p.id;
      openedStock = new Map(p.variants.map((v) => [v.id, v.stock]));
      baseJSON = JSON.stringify(p);
    }
    dirty = false;
    const c = S.catalog();
    const isNew = !originalId;
    main.innerHTML = `
      ${head(isNew ? '商品を追加' : '商品を編集', { crumbs: [['商品', '#products'], [isNew ? '新規' : draft.name]], actions: !isNew && draft.status !== 'draft' ? `<a class="adm-btn" href="../shop.html#item-${esc(originalId)}" target="_blank" rel="noopener">ショップで見る${ICON.ext}</a>` : '' })}
      <form class="adm-editor" id="edForm" novalidate>
        <div class="adm-form">
          <section class="adm-sec" aria-labelledby="sec1">
            <h2 id="sec1">基本情報</h2>
            <div class="adm-fields">
              <div class="adm-field adm-field--full">
                <label for="f-name">商品名<span class="req">必須</span></label>
                <input class="input" id="f-name" name="name" value="${esc(draft.name)}" maxlength="60" placeholder="例：満月米 ななつぼし 5kg">
                <p class="adm-error" id="f-name-err" hidden></p>
              </div>
              <div class="adm-field">
                <label for="f-category">カテゴリ</label>
                <select class="select" id="f-category" name="category">
                  <option value="">未分類</option>
                  ${c.categories.map((k) => `<option value="${esc(k.id)}" ${draft.category === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}
                </select>
                <p class="adm-hint"><a class="link" href="#categories">カテゴリを追加・編集</a></p>
              </div>
              <div class="adm-field">
                <label for="f-id">商品ID（URLに使われます）</label>
                <input class="input" id="f-id" name="id" value="${esc(draft.id)}" maxlength="40" inputmode="url" autocapitalize="off" spellcheck="false" aria-describedby="f-id-hint">
                <p class="adm-hint" id="f-id-hint">半角英小文字・数字・ハイフン。${isNew ? '' : '変えると、これまでの商品ページのURLは開けなくなります。'}</p>
                <p class="adm-error" id="f-id-err" hidden></p>
              </div>
              <fieldset class="adm-field adm-field--full" style="border:0;margin:0;padding:0">
                <legend class="adm-legend">ショップでの表示</legend>
                <div class="adm-seg" style="margin-top:6px">
                  ${Object.entries({ published: '公開する', draft: '非公開（下書き）', soldout: '売り切れとして表示' }).map(([k, v]) => `<label><input type="radio" name="status" value="${k}" ${draft.status === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}
                </div>
              </fieldset>
              <label class="adm-check adm-field--full"><input type="checkbox" name="featured" id="f-featured" ${draft.featured && !draft.options.eventOnly ? 'checked' : ''} ${draft.options.eventOnly ? 'disabled' : ''}><span>トップページの「満月米をお届けします」に表示する<small id="f-featured-note">${featuredNote()}</small></span></label>
            </div>
          </section>

          <section class="adm-sec" aria-labelledby="sec2">
            <h2 id="sec2">価格・種類<small>種類が2つ以上あると、商品ページで選べるようになります</small></h2>
            <div class="adm-rows" id="variantRows"></div>
            <div><button class="adm-btn" type="button" data-add-variant>${ICON.plus}種類を追加</button></div>
          </section>

          <section class="adm-sec" aria-labelledby="sec3">
            <h2 id="sec3">画像</h2>
            <div id="visualBox"></div>
            <div class="adm-field">
              <span class="adm-label">追加の写真<small class="adm-faint">（商品ページで切り替えて見られます）</small></span>
              <div id="galleryBox"></div>
            </div>
          </section>

          <section class="adm-sec" aria-labelledby="sec4">
            <h2 id="sec4">説明文</h2>
            <div class="adm-fields">
              <div class="adm-field">
                <label for="f-badge">バッジの文字</label>
                <input class="input" id="f-badge" name="badge.text" value="${esc(draft.badge.text)}" maxlength="12" placeholder="例：定番、予約受付中">
              </div>
              <div class="adm-field">
                <label for="f-badgeline">バッジの見た目</label>
                <select class="select" id="f-badgeline" name="badge.line">
                  <option value="line" ${draft.badge.line ? 'selected' : ''}>枠線（控えめ）</option>
                  <option value="solid" ${!draft.badge.line ? 'selected' : ''}>金色（目立たせる）</option>
                </select>
              </div>
              <div class="adm-field">
                <label for="f-meta">小見出し</label>
                <input class="input" id="f-meta" name="meta" value="${esc(draft.meta)}" maxlength="30" placeholder="例：令和8年産・精米">
              </div>
              <div class="adm-field">
                <label for="f-when">発送時期（一覧用の短い文）</label>
                <input class="input" id="f-when" name="when" value="${esc(draft.when)}" maxlength="30" placeholder="例：ご購入順に順次発送">
              </div>
              <div class="adm-field adm-field--full">
                <label for="f-card">一覧用のひとこと</label>
                <input class="input" id="f-card" name="card" value="${esc(draft.card)}" maxlength="60" placeholder="例：まずはこちらから。毎日のごはんに、ちょうどいい量です。">
              </div>
              <div class="adm-field adm-field--full">
                <label for="f-lead">商品説明</label>
                <textarea class="textarea" id="f-lead" name="lead" rows="4" maxlength="400">${esc(draft.lead)}</textarea>
              </div>
              <div class="adm-field adm-field--full">
                <label for="f-ship">発送について（商品ページ）</label>
                <input class="input" id="f-ship" name="ship" value="${esc(draft.ship)}" maxlength="60" placeholder="例：ご購入いただいた順に、順次発送します">
              </div>
            </div>
          </section>

          <section class="adm-sec" aria-labelledby="sec5">
            <h2 id="sec5">オプション</h2>
            <div class="adm-checks">
              <label class="adm-check"><input type="checkbox" name="options.preorder" ${draft.options.preorder ? 'checked' : ''}><span>予約商品として扱う<small>カートと購入手続きで、発送時期の案内が出ます。日付指定はできなくなります。</small></span></label>
              <label class="adm-check"><input type="checkbox" name="options.subscription" ${draft.options.subscription ? 'checked' : ''}><span>定期便として扱う<small>価格に「／1回」が付き、確認画面に定期便の案内が出ます。</small></span></label>
              <label class="adm-check"><input type="checkbox" name="options.award" ${draft.options.award ? 'checked' : ''}><span>金賞メダルを表示する<small>米-1グランプリ in らんこし 2025 で金賞を受賞したお米（令和7年産）にだけ付けてください。</small></span></label>
              <label class="adm-check"><input type="checkbox" name="options.traits" ${draft.options.traits ? 'checked' : ''}><span>「ななつぼしの特徴」を表示する<span class="nowrap">（満月米の商品）</span></span></label>
              <div class="adm-check-group">
                <label class="adm-check"><input type="checkbox" name="options.eventOnly" ${draft.options.eventOnly ? 'checked' : ''} aria-describedby="f-eventonly-note"><span>イベント限定<span class="nowrap">（イベントページだけで販売）</span><small>イベントの期間中だけ、イベントページに表示して販売します。イベントページの設定で、表示する商品に入れてください。</small></span></label>
                <div class="adm-optnote" id="f-eventonly-note" aria-live="polite">${eventOnlyNote()}</div>
              </div>
              <label class="adm-check"><input type="checkbox" name="options.shipIncluded" ${draft.options.shipIncluded ? 'checked' : ''}><span>送料込み<span class="nowrap">（この商品には送料がかかりません）</span><small>送料は商品の価格に含まれます。ほかの商品と一緒に注文されたときは、ほかの商品の分だけ送料がかかります。</small></span></label>
            </div>
          </section>

          <section class="adm-sec" aria-labelledby="sec6">
            <h2 id="sec6">商品情報（表）<small>商品ページの「商品情報」に表示されます</small></h2>
            <div class="adm-rows" id="specRows"></div>
            <div><button class="adm-btn" type="button" data-add-spec>${ICON.plus}行を追加</button></div>
          </section>
        </div>

        <aside class="adm-preview" aria-label="プレビュー">
          <p class="adm-preview__label">一覧での見え方（プレビュー）</p>
          <div id="previewBox" inert></div>
        </aside>

        <div class="adm-savebar" style="grid-column:1/-1">
          <span class="adm-savebar__state" id="saveState">${isNew ? '新しい商品です。まだ保存されていません。' : '保存済み'}</span>
          <div class="adm-savebar__btns">
            ${isNew ? '' : `<button class="adm-btn adm-btn--danger" type="button" data-del-current>削除</button>`}
            <a class="adm-btn" href="#products">一覧に戻る</a>
            <button class="btn btn--gold btn--sm" type="submit">${isNew ? '追加する' : '保存する'}</button>
          </div>
        </div>
      </form>`;
    renderVariants(); renderVisual(); renderGallery(); renderSpecs(); renderPreview();
    $('#f-eventonly-note').dataset.live = eventOnlyNote();
    if (isNew) $('#f-name').focus();
  }

  const markDirty = () => {
    dirty = true;
    const s = $('#saveState');
    if (s) { s.textContent = '保存されていない変更があります'; s.classList.add('is-dirty'); }
    renderPreview();
  };
  // under the イベント限定 option: whether the product can be bought now, and what to do if not
  function eventOnlyNote() {
    if (!draft || !draft.options.eventOnly) return '';
    const e = S.catalog().settings.event;
    const link = '<a class="link" href="#event">イベントページの設定</a>';
    const until = e.end ? `（${dateText(e.end)}まで）` : '';
    let msg = '', warn = false;
    if (!originalId) msg = `保存したあと、${link}で、表示する商品に入れてください。${draft.status === 'draft' ? '非公開のあいだは、イベントページにも表示されません。' : ''}`;
    else if (draft.status === 'draft') msg = '非公開の商品は、イベントページにも表示されません。';
    else if (!e.products.includes(originalId)) { warn = true; msg = `この商品は、イベントページに入っていません。このままでは購入できません。${link}で、表示する商品に入れてください。`; }
    else {
      const ph = eventPhase(e);
      if (ph === 'on') msg = `いまは、イベントページで販売中です${until}。`;
      else if (ph === 'before') msg = `イベントページの開始前です。${dateText(e.start)}から販売します${until}。`;
      else { warn = true; msg = ph === 'after' ? `イベントページの期間（${dateText(e.end)}まで）が終わったため、いまは購入できません。` : `イベントページを公開していないため、いまは購入できません（${link}）。`; }
    }
    return `<p class="${warn ? 'adm-error' : 'adm-hint'}">${msg}</p><p class="adm-hint">ショップの一覧・カテゴリ・トップページには表示されません。</p>`;
  }
  // a live region is written only when its text changes (so it is not announced again for nothing)
  const liveHTML = (el, html) => { if (el && el.dataset.live !== html) { el.dataset.live = html; el.innerHTML = html; } };
  const updateEventOnlyNote = () => liveHTML($('#f-eventonly-note'), eventOnlyNote());
  // the トップページ checkbox: not for event-only goods (they are not in the top page's grid).
  // Its own value stays in the draft while イベント限定 is on, and is dropped when saved (see saveDraft)
  const featuredNote = () => (draft.options.eventOnly ? `${EVENT_FEATURE_NOTE}（ここでは選べません）` : '★の付いた商品のうち、並び順の上から4件が表示されます');
  function syncFeatured() {
    const f = $('#f-featured');
    if (!f) return;
    const ev = !!draft.options.eventOnly;
    f.disabled = ev;
    f.checked = !ev && !!draft.featured;
    $('#f-featured-note').textContent = featuredNote();
  }
  const normalized = () => S.normalize({ categories: [], products: [draft], settings: S.catalog().settings }).products[0];
  function renderPreview() {
    const box = $('#previewBox');
    if (!box) return;
    box.innerHTML = U.cardHTML(normalized(), { preview: true });
    if (draft.visual.kind === 'image' && !draft.visual.src) {
      const v = box.querySelector('.p-card__visual');
      if (v) v.innerHTML = '<span class="adm-faint" style="position:absolute;inset:0;display:grid;place-items:center">写真はまだありません</span>';
    }
  }

  function renderVariants() {
    $('#variantRows').innerHTML = draft.variants.map((v, i) => `
      <div class="adm-row adm-row--variant" data-vi="${i}">
        <div class="adm-field"><label for="v-label-${i}">種類の名前${draft.variants.length > 1 ? '<span class="req">必須</span>' : ''}</label><input class="input" id="v-label-${i}" data-vf="label" value="${esc(v.label)}" maxlength="30" placeholder="例：5kg、毎月 5kg"></div>
        <div class="adm-field"><label for="v-price-${i}">価格（税込・円）<span class="req">必須</span></label><input class="input input--num" id="v-price-${i}" data-vf="price" type="number" min="0" step="1" inputmode="numeric" value="${v.price || v.price === 0 ? v.price : ''}"></div>
        <div class="adm-field"><label for="v-weight-${i}">重さ（kg）<span class="req">必須</span></label><input class="input input--num" id="v-weight-${i}" data-vf="weight" type="number" min="0.1" max="30" step="0.1" inputmode="decimal" required value="${esc(v.weight ?? '')}" aria-describedby="v-weight-hint"></div>
        <div class="adm-field"><label for="v-stock-${i}"><span>在庫<span class="adm-phrase">（空欄＝管理しない）</span></span></label><input class="input input--num" id="v-stock-${i}" data-vf="stock" type="number" min="0" step="1" inputmode="numeric" value="${v.stock === null ? '' : v.stock}" placeholder="—"></div>
        <div class="adm-row__tools">
          <button class="adm-btn adm-btn--icon adm-btn--quiet" type="button" data-vmove="-1" aria-label="種類${i + 1}を上へ" ${i === 0 ? 'aria-disabled="true"' : ''}>${ICON.up}</button>
          <button class="adm-btn adm-btn--icon adm-btn--quiet" type="button" data-vmove="1" aria-label="種類${i + 1}を下へ" ${i === draft.variants.length - 1 ? 'aria-disabled="true"' : ''}>${ICON.down}</button>
          <button class="adm-btn adm-btn--icon adm-btn--danger" type="button" data-vdel aria-label="種類${i + 1}を削除" ${draft.variants.length === 1 ? 'aria-disabled="true"' : ''}>${ICON.del}</button>
        </div>
      </div>`).join('') + '<p class="adm-hint" id="v-weight-hint">重さ（kg）は、送料の計算に使います（1点あたり）。30kgまでの商品を登録できます。</p><p class="adm-error" id="v-err" hidden></p>';
  }
  function renderSpecs() {
    $('#specRows').innerHTML = draft.specs.length ? draft.specs.map((r, i) => `
      <div class="adm-row adm-row--spec" data-si="${i}">
        <div class="adm-field"><label class="visually-hidden" for="s-k-${i}">項目名${i + 1}</label><input class="input" id="s-k-${i}" data-sf="0" value="${esc(r[0])}" maxlength="20" placeholder="項目（例：内容量）"></div>
        <div class="adm-field"><label class="visually-hidden" for="s-v-${i}">内容${i + 1}</label><input class="input" id="s-v-${i}" data-sf="1" value="${esc(r[1])}" maxlength="120" placeholder="内容（例：5kg）"></div>
        <div class="adm-row__tools">
          <button class="adm-btn adm-btn--icon adm-btn--quiet" type="button" data-smove="-1" aria-label="${i + 1}行目を上へ" ${i === 0 ? 'aria-disabled="true"' : ''}>${ICON.up}</button>
          <button class="adm-btn adm-btn--icon adm-btn--quiet" type="button" data-smove="1" aria-label="${i + 1}行目を下へ" ${i === draft.specs.length - 1 ? 'aria-disabled="true"' : ''}>${ICON.down}</button>
          <button class="adm-btn adm-btn--icon adm-btn--danger" type="button" data-sdel aria-label="${i + 1}行目を削除">${ICON.del}</button>
        </div>
      </div>`).join('') : '<p class="adm-muted">行がありません。「行を追加」で項目を作れます。</p>';
  }
  function renderVisual() {
    const v = draft.visual;
    const isBag = v.kind !== 'image';
    $('#visualBox').innerHTML = `
      <div class="adm-visual">
        <div class="adm-visual__prev" aria-hidden="true">${isBag || v.src ? U.visualHTML(normalized()) : '<span class="adm-faint" style="position:absolute;inset:0;display:grid;place-items:center;padding:12px;text-align:center">写真はまだありません</span>'}</div>
        <div class="adm-form" style="gap:14px">
          <fieldset class="adm-field" style="border:0;margin:0;padding:0">
            <legend class="adm-legend">メイン画像</legend>
            <div class="adm-seg" style="margin-top:6px">
              <label><input type="radio" name="visual.kind" value="image" ${!isBag ? 'checked' : ''}><span>写真を使う</span></label>
              <label><input type="radio" name="visual.kind" value="bag" ${isBag ? 'checked' : ''}><span>満月米の袋のイラスト</span></label>
            </div>
          </fieldset>
          ${isBag ? `
          <div class="adm-fields">
            <div class="adm-field"><label for="f-bag">袋の種類</label>
              <select class="select" id="f-bag" name="visual.style">${Object.entries(BAG_STYLES).map(([k, t]) => `<option value="${k}" ${v.style === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            <div class="adm-field"><label for="f-baglabel">袋に入れる文字</label><input class="input" id="f-baglabel" name="visual.label" value="${esc(v.label || '')}" maxlength="8" placeholder="例：5kg"></div>
          </div>` : `
          <div class="adm-field">
            <span class="adm-upload"><input type="file" accept="image/*" id="mainUpload" aria-label="メイン画像の写真をアップロード" aria-describedby="up-hint"><span class="adm-btn">${v.src ? '写真を変更する' : '写真をアップロード'}</span></span>
            <p class="adm-hint" id="up-hint">JPEG・PNG・WebPなど。長い辺が1200pxになるように自動で縮小して保存します。</p>
            <p class="adm-error" id="v-img-err" hidden></p>
          </div>
          <div class="adm-field"><span class="adm-label">サイト内の写真から選ぶ</span>
            <div class="adm-builtins">${BUILTIN_IMAGES.map((b, i) => `<button class="adm-builtin" type="button" data-main-builtin="${i}" aria-label="${esc(b.alt)}を使う">${builtinImg(b)}</button>`).join('')}</div>
          </div>
          <div class="adm-field"><label for="f-fit">写真の見せ方</label>
            <select class="select" id="f-fit" name="visual.fit"><option value="cover" ${v.fit !== 'contain' ? 'selected' : ''}>枠いっぱいに表示（はみ出た部分を切る）</option><option value="contain" ${v.fit === 'contain' ? 'selected' : ''}>写真全体を表示する</option></select></div>`}
        </div>
      </div>`;
  }
  function renderGallery() {
    $('#galleryBox').innerHTML = `
      ${draft.gallery.length ? `<div class="adm-gallery">${draft.gallery.map((g, i) => `
        <div class="adm-gitem" data-gi="${i}">
          <div class="adm-gitem__img">${U.imageHTML(g, '')}</div>
          <label class="visually-hidden" for="g-alt-${i}">写真${i + 1}の説明</label>
          <input class="input" id="g-alt-${i}" data-galt value="${esc(g.alt)}" placeholder="写真の説明" style="min-height:36px;padding:6px 8px">
          <div class="adm-gitem__tools">
            <button class="adm-btn adm-btn--icon adm-btn--quiet" type="button" data-gmove="-1" aria-label="写真${i + 1}を前へ" ${i === 0 ? 'aria-disabled="true"' : ''}>${ICON.up}</button>
            <button class="adm-btn adm-btn--icon adm-btn--quiet" type="button" data-gmove="1" aria-label="写真${i + 1}を後ろへ" ${i === draft.gallery.length - 1 ? 'aria-disabled="true"' : ''}>${ICON.down}</button>
            <button class="adm-btn adm-btn--icon adm-btn--danger" type="button" data-gdel aria-label="写真${i + 1}を外す">${ICON.del}</button>
          </div>
        </div>`).join('')}</div>` : '<p class="adm-muted">追加の写真はありません。</p>'}
      <div class="adm-toolbar" style="margin:12px 0 0">
        <span class="adm-upload"><input type="file" accept="image/*" id="galleryUpload" multiple aria-label="追加の写真をアップロード（一度に6枚まで）"><span class="adm-btn">${ICON.plus}写真をアップロード</span></span>
        <span class="adm-faint">サイト内の写真を追加：</span>
        ${BUILTIN_IMAGES.map((b, i) => `<button class="adm-builtin" type="button" data-gal-builtin="${i}" aria-label="${esc(b.alt)}を追加" style="width:44px;height:44px">${builtinImg(b)}</button>`).join('')}
      </div>`;
  }

  // read an image file, shrink it and return a data URL (kept small for browser storage)
  function shrinkImage(file, max = 1200) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) { reject(new Error('画像ファイルを選んでください。')); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        let data = cv.toDataURL('image/webp', 0.82);
        if (!data.startsWith('data:image/webp')) data = cv.toDataURL('image/jpeg', 0.85);
        resolve(data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この画像は読み込めませんでした。別の画像を選んでください。')); };
      img.src = url;
    });
  }

  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    keys.slice(0, -1).forEach((k) => { o = o[k]; });
    o[keys[keys.length - 1]] = value;
  }
  function editorInput(e) {
    const el = e.target;
    // not while saving (the form is locked), nor from a field already taken off the screen
    // (its change event comes after a redraw, and would land in the next draft)
    if (!draft || saving || !el.isConnected || !el.closest('#edForm')) return;
    if (el.name) {
      let val = el.type === 'checkbox' ? el.checked : el.value;
      if (el.name === 'badge.line') val = el.value === 'line';
      setPath(draft, el.name, val);
      if (el.name === 'visual.kind') {
        // keep both sets of fields while editing (normalize() drops the unused ones on save)
        draft.visual = { src: '', fit: 'cover', style: 'single', label: '5kg', ...draft.visual, kind: val === 'bag' ? 'bag' : 'image' };
        renderVisual();
      } else if (el.name.startsWith('visual.')) {
        const prev = $('.adm-visual__prev');
        if (prev) prev.innerHTML = U.visualHTML(normalized());
      } else if (el.name === 'options.eventOnly' || el.name === 'status') {
        updateEventOnlyNote();
        if (el.name === 'options.eventOnly') syncFeatured();
      }
    }
    const vr = el.closest('[data-vi]');
    if (vr && el.dataset.vf) {
      const v = draft.variants[+vr.dataset.vi];
      if (el.dataset.vf === 'label') v.label = el.value;
      if (el.dataset.vf === 'price') v.price = el.value.trim();
      if (el.dataset.vf === 'weight') v.weight = el.value.trim();
      if (el.dataset.vf === 'stock') v.stock = el.value.trim() === '' ? null : el.value.trim();
    }
    const sr = el.closest('[data-si]');
    if (sr && el.dataset.sf) draft.specs[+sr.dataset.si][+el.dataset.sf] = el.value;
    const gi = el.closest('[data-gi]');
    if (gi && el.hasAttribute('data-galt')) draft.gallery[+gi.dataset.gi].alt = el.value;
    if (el.getAttribute('aria-invalid') === 'true') {
      const eid = (el.getAttribute('aria-describedby') || '').split(' ').find((x) => x.endsWith('-err'));
      if (eid) showErr(eid, '', '#' + CSS.escape(el.id));
    }
    markDirty();
  }
  const moveIn = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true; };
  async function editorClick(e) {
    if (!draft || !e.target.closest('#edForm')) return;
    const t = e.target.closest('button');
    if (!t || t.getAttribute('aria-disabled') === 'true') return;
    if (saving) { announce('保存しています。少しお待ちください。'); return; }
    const refocus = (sel) => { const el = $(sel); if (el) el.focus(); };
    if (t.hasAttribute('data-add-variant')) {
      let id; do { id = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`; } while (draft.variants.some((v) => v.id === id));
      draft.variants.push({ id, label: '', price: draft.variants[draft.variants.length - 1].price ?? '', stock: null, weight: 5 });
      renderVariants(); markDirty(); refocus(`#v-label-${draft.variants.length - 1}`); return;
    }
    const vr = t.closest('[data-vi]');
    if (vr) {
      const i = +vr.dataset.vi;
      if (t.hasAttribute('data-vdel')) { draft.variants.splice(i, 1); renderVariants(); markDirty(); refocus(`#v-label-${Math.max(0, i - 1)}`); }
      if (t.dataset.vmove && moveIn(draft.variants, i, +t.dataset.vmove)) { renderVariants(); markDirty(); refocus(`[data-vi="${i + +t.dataset.vmove}"] [data-vmove="${t.dataset.vmove}"]`); }
      return;
    }
    if (t.hasAttribute('data-add-spec')) { draft.specs.push(['', '']); renderSpecs(); markDirty(); refocus(`#s-k-${draft.specs.length - 1}`); return; }
    const sr = t.closest('[data-si]');
    if (sr) {
      const i = +sr.dataset.si;
      if (t.hasAttribute('data-sdel')) { draft.specs.splice(i, 1); renderSpecs(); markDirty(); refocus(draft.specs.length ? `#s-k-${Math.max(0, i - 1)}` : '[data-add-spec]'); }
      if (t.dataset.smove && moveIn(draft.specs, i, +t.dataset.smove)) { renderSpecs(); markDirty(); refocus(`[data-si="${i + +t.dataset.smove}"] [data-smove="${t.dataset.smove}"]`); }
      return;
    }
    if (t.dataset.mainBuiltin !== undefined) {
      const b = BUILTIN_IMAGES[+t.dataset.mainBuiltin];
      draft.visual = { kind: 'image', src: b.src, fit: b.fit };
      renderVisual(); markDirty(); refocus(`[data-main-builtin="${t.dataset.mainBuiltin}"]`); return;
    }
    if (t.dataset.galBuiltin !== undefined) {
      const b = BUILTIN_IMAGES[+t.dataset.galBuiltin];
      draft.gallery.push({ src: b.src, alt: b.alt, fit: b.fit });
      renderGallery(); markDirty(); refocus(`[data-gal-builtin="${t.dataset.galBuiltin}"]`); return;
    }
    const gi = t.closest('[data-gi]');
    if (gi) {
      const i = +gi.dataset.gi;
      if (t.hasAttribute('data-gdel')) { draft.gallery.splice(i, 1); renderGallery(); markDirty(); refocus('#galleryUpload'); }
      if (t.dataset.gmove && moveIn(draft.gallery, i, +t.dataset.gmove)) { renderGallery(); markDirty(); refocus(`[data-gi="${i + +t.dataset.gmove}"] [data-gmove="${t.dataset.gmove}"]`); }
      return;
    }
    if (t.hasAttribute('data-del-current')) {
      const ok = await confirmDialog({ title: '商品を削除しますか？', body: `「${esc(draft.name || '名称未設定')}」を削除します。元に戻すことはできません。`, ok: '削除する', danger: true });
      if (!ok) return;
      const oid = originalId;
      const route = currentRoute;
      if (await commit((c) => { c.products = c.products.filter((x) => x.id !== oid); }, '削除しました') && currentRoute === route) { dirty = false; location.hash = 'products'; }
    }
  }

  // live: send a shrunk photo (data URL) to the server and use its URL.
  // without image storage on the server (501), the photo stays inside the product data
  let inlineImages = 0; // photos kept inside the product data in this visit (live)
  function dataURLToBlob(url) {
    const [meta, body] = url.split(',');
    const type = (/^data:([^;,]+)/.exec(meta) || [])[1] || 'image/jpeg';
    const bin = atob(body);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type });
  }
  async function storeImage(data) {
    if (!LIVE) return data;
    try {
      const r = await api(() => API.admin.uploadImage(dataURLToBlob(data)));
      if (r && typeof r.url === 'string' && r.url) return r.url;
      throw new Error('写真を保存できませんでした。もう一度お試しください。');
    } catch (err) {
      if (err && (err.code === 'images_unavailable' || err.status === 501)) { inlineImages++; return data; }
      throw err;
    }
  }
  // photos still being read / sent, per draft: saving waits for them, or they would be left out
  const uploads = new WeakMap();
  const uploadsFor = (d) => (d && uploads.get(d)) || 0;
  // live: show that photos are being sent (the file input is blocked meanwhile). what: 写真 / 画像
  function uploading(el, on, what = '写真') {
    if (!LIVE) return;
    const b = el.nextElementSibling;
    el.disabled = on;
    if (on) { b.dataset.label = b.innerHTML; b.textContent = `${what}を送っています…`; announce(`${what}を送っています。少しお待ちください。`); }
    else if (b.dataset.label !== undefined) { b.innerHTML = b.dataset.label; delete b.dataset.label; }
  }
  async function editorFile(e) {
    const el = e.target;
    if (!draft || el.type !== 'file') return;
    const files = Array.from(el.files || []);
    if (!files.length) return;
    const d = draft;
    const inline0 = inlineImages;
    const msgs = [];
    uploading(el, true);
    uploads.set(d, uploadsFor(d) + 1);
    try {
      if (el.id === 'mainUpload') {
        const src = await storeImage(await shrinkImage(files[0]));
        if (draft !== d) return;
        d.visual = { kind: 'image', src, fit: d.visual.fit || 'cover' };
        renderVisual(); markDirty(); $('#mainUpload').focus();
      } else if (el.id === 'galleryUpload') {
        const res = await Promise.allSettled(files.slice(0, 6).map((f) => shrinkImage(f)));
        const ok = res.filter((r) => r.status === 'fulfilled');
        let added = 0;
        for (const r of ok) {
          let src;
          try { src = await storeImage(r.value); }
          catch (err) { msgs.push(`${ok.length - added}枚を保存できませんでした。${errText(err, '写真を保存できませんでした')}`); break; }
          if (draft !== d) return;
          d.gallery.push({ src, alt: '', fit: 'cover' });
          added++;
        }
        if (draft !== d) return;
        renderGallery(); if (added) markDirty(); $('#galleryUpload').focus();
        const bad = res.length - ok.length, over = Math.max(0, files.length - 6);
        if (bad || over) msgs.unshift(`${bad ? `${bad}枚は読み込めませんでした（HEICなどはJPEGにしてから選んでください）。` : ''}${over ? '一度に追加できる写真は6枚までです。' : ''}`);
      }
    } catch (err) {
      msgs.push(errText(err, '写真を保存できませんでした'));
    } finally {
      uploads.set(d, uploadsFor(d) - 1);
      if (el.isConnected) { uploading(el, false); el.value = ''; }
    }
    if (msgs.length) toast(msgs.join(''), { error: true });
    else if (inlineImages > inline0) toast('写真の保存先（サーバー）が用意されていないため、写真は商品データの中に保存します。データが大きくなるため、写真は少なめにしてください。');
  }

  // mark a field (in)valid and link it to its error text, keeping its other aria-describedby ids
  function setInvalid(f, errId, bad) {
    if (bad) f.setAttribute('aria-invalid', 'true'); else f.removeAttribute('aria-invalid');
    const ids = new Set((f.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
    if (bad) ids.add(errId); else ids.delete(errId);
    if (ids.size) f.setAttribute('aria-describedby', [...ids].join(' ')); else f.removeAttribute('aria-describedby');
  }
  function showErr(id, msg, field) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg; el.hidden = !msg;
    const f = field && $(field);
    if (f) setInvalid(f, id, !!msg);
  }
  function validateDraft() {
    const errs = [];
    const name = draft.name.trim();
    showErr('f-name-err', name ? '' : '商品名を入力してください。', '#f-name');
    if (!name) errs.push('#f-name');
    const id = String(draft.id).trim();
    let idMsg = '';
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) idMsg = '半角英小文字・数字・ハイフンで、2〜40文字にしてください（先頭は英数字）。';
    else if (id === 'new') idMsg = '「new」は使えません。別のIDにしてください。';
    else if (S.catalog().products.some((p) => p.id === id && p.id !== originalId)) idMsg = 'この商品IDはすでに使われています。別のIDにしてください。';
    showErr('f-id-err', idMsg, '#f-id');
    if (idMsg) errs.push('#f-id');
    const badPrice = (v) => !/^\d{1,7}$/.test(String(v.price)) || (draft.status !== 'draft' && Number(v.price) < 1);
    const badStock = (v) => v.stock !== null && !/^\d{1,6}$/.test(String(v.stock));
    // kg per unit: 0.1–30, one decimal place
    const badWeight = (v) => { const w = String(v.weight ?? '').trim(); return !/^\d{0,2}(\.\d)?$/.test(w) || !(Number(w) >= 0.1 && Number(w) <= 30); };
    const needLabel = (v) => draft.variants.length > 1 && !String(v.label).trim();
    $$('#variantRows [aria-invalid]').forEach((x) => setInvalid(x, 'v-err', false));
    const badVar = draft.variants.findIndex((v) => needLabel(v) || badPrice(v) || badWeight(v) || badStock(v));
    const bv = draft.variants[badVar];
    const fld = badVar < 0 ? '' : needLabel(bv) ? 'label' : badPrice(bv) ? 'price' : badWeight(bv) ? 'weight' : 'stock';
    const VMSG = { label: '名前を入力してください', price: '価格を整数で入力してください（公開する商品は1円以上）', weight: '重さは0.1〜30の数字で入力してください（kg・小数は1けたまで）', stock: '在庫は0以上の整数で入力するか、空欄にしてください' };
    showErr('v-err', badVar < 0 ? '' : `${draft.variants.length > 1 ? `種類${badVar + 1}の` : ''}${VMSG[fld]}。`, badVar >= 0 ? `#v-${fld}-${badVar}` : null);
    if (badVar >= 0) errs.push(`#v-${fld}-${badVar}`);
    if (draft.visual.kind === 'image' && !draft.visual.src) {
      showErr('v-img-err', '写真をアップロードするか、サイト内の写真を選んでください。', '#mainUpload');
      errs.push('#mainUpload');
    } else showErr('v-img-err', '', '#mainUpload');
    return errs;
  }
  const stockWord = (n) => (n === null ? '管理しない' : `${n}点`);
  // live: what to ask when the catalog was saved elsewhere while this product was being edited.
  // null = nothing of this product clashes, so the edit is simply applied to the latest data
  const editorConflict = (d, oid) => (latest) => {
    if (!oid) return null;
    const cur = latest.products.find((x) => x.id === oid);
    if (!cur) return { title: 'この商品は削除されていました', body: 'ほかの画面（または別の方）が、この商品を先に削除していました。保存すると、もう一度追加されます。', ok: '追加して保存する' };
    if (baseJSON && strip(cur) !== strip(JSON.parse(baseJSON))) return { title: 'この商品は先に変更されていました', body: 'ほかの画面（または別の方）が、この商品を先に保存していました。もう一度保存すると、いま編集している内容で上書きします。', ok: '上書きして保存する' };
    // stock the owner typed in, which also changed meanwhile (sold in the shop)
    const clash = d.variants.map((v) => ({ v, lv: cur.variants.find((x) => x.id === v.id) }))
      .filter(({ v, lv }) => lv && openedStock.has(v.id) && openedStock.get(v.id) !== v.stock && lv.stock !== openedStock.get(v.id));
    if (clash.length) {
      return {
        title: '在庫が変わっています',
        body: `編集しているあいだに、注文などで在庫が変わりました。<br>${clash.map(({ v, lv }) => `「${esc(v.label)}」：開いたとき ${stockWord(openedStock.get(v.id))} → いま ${stockWord(lv.stock)}（入力した在庫：${stockWord(v.stock)}）`).join('<br>')}<br>入力した在庫数で保存しますか？`,
        ok: '入力した在庫数で保存する',
      };
    }
    return null;
  };
  // live: the owner chose not to save after a conflict. show the latest stock for the
  // variants whose stock they did not touch, and keep everything else they typed
  function rebaseDraft(d) {
    if (draft !== d || !originalId) return;
    const cur = S.product(originalId);
    if (!cur) return;
    d.variants.forEach((v) => {
      const lv = cur.variants.find((x) => x.id === v.id);
      if (lv && openedStock.has(v.id) && openedStock.get(v.id) === v.stock) { v.stock = lv.stock; openedStock.set(v.id, lv.stock); }
    });
    renderVariants();
  }
  async function saveDraft(e) {
    e.preventDefault();
    if (saving) return;
    if (uploadsFor(draft)) {
      toast(LIVE ? '写真を送っています。送り終わってから保存してください。' : '写真を読み込んでいます。読み込み終わってから保存してください。');
      return;
    }
    const errs = validateDraft();
    if (errs.length) {
      const first = $(errs[0]);
      if (first) first.focus();
      toast(`入力内容を確認してください（${errs.length}か所）`, { error: true });
      return;
    }
    const d = draft;
    const oid = originalId;
    // this product was changed or deleted elsewhere while it was open
    // (demo: another tab. live: someone else, noticed when an earlier save met a conflict)
    if (oid && baseJSON) {
      const cur = S.product(oid);
      if (!cur || strip(cur) !== strip(JSON.parse(baseJSON))) {
        const where = LIVE ? 'ほかの画面（または別の方）' : '別のタブ';
        const ok = await confirmDialog({ title: 'ほかの画面で変更されています', body: cur ? `この商品は${where}で変更されました。保存すると、その変更を上書きします。` : `この商品は${where}で削除されました。保存すると、もう一度追加されます。`, ok: '上書きして保存' });
        if (!ok || draft !== d) return;
      }
    }
    d.id = d.id.trim();
    d.name = d.name.trim();
    d.variants.forEach((v, i) => {
      v.price = Number(v.price);
      v.stock = v.stock === null ? null : Number(v.stock);
      v.weight = Math.round(Number(v.weight) * 10) / 10;
      if (!String(v.label).trim()) v.label = d.variants.length > 1 ? `種類${i + 1}` : '通常';
    });
    d.specs = d.specs.filter((r) => r[0].trim() || r[1].trim());
    let idTaken = false;
    const apply = (c) => {
      const p = clone(d);
      if (p.options.eventOnly) p.featured = false; // not shown in the top page's grid (see featuredNote)
      const i = oid ? c.products.findIndex((x) => x.id === oid) : -1;
      if (c.products.some((x, j) => x.id === p.id && j !== i)) { idTaken = true; return false; }
      if (i >= 0) {
        const cur = c.products[i];
        // keep stock sold in the shop while the editor was open, unless the owner changed that field
        p.variants.forEach((v) => {
          const lv = cur.variants.find((x) => x.id === v.id);
          if (lv && openedStock.has(v.id) && openedStock.get(v.id) === v.stock) v.stock = lv.stock;
        });
        c.products[i] = p;
      } else c.products.push(p);
      if (oid && oid !== p.id) {
        if (c.settings.news.link === oid) c.settings.news.link = p.id;
        c.settings.event.products = c.settings.event.products.map((x) => (x === oid ? p.id : x));
      }
    };
    const wasNew = !oid;
    const hidden = d.status === 'draft';
    const msg = hidden ? `${wasNew ? '追加' : '保存'}しました（非公開のため、ショップには表示されません）` : (wasNew ? '商品を追加しました' : '保存しました');
    const ok = await commit(apply, msg, hidden ? null : { href: `../shop.html#item-${d.id}`, text: 'ショップで確認' }, { conflict: editorConflict(d, oid), declined: () => rebaseDraft(d) });
    if (draft !== d) return; // moved to another screen while saving
    if (!ok) {
      // the draft was tidied for saving (empty spec rows dropped, numbers converted): show it as it is now
      rerender(() => { renderVariants(); renderSpecs(); });
      if (idTaken) { showErr('f-id-err', 'この商品IDは、ほかの画面ですでに使われています。別のIDにしてください。', '#f-id'); $('#f-id').focus(); }
      return;
    }
    dirty = false;
    if (wasNew || originalId !== draft.id) { history.replaceState(null, '', `#product-${draft.id}`); currentRoute = `product-${draft.id}`; }
    renderEditor(draft.id);
    $('#saveState').textContent = '保存しました';
    focusAfter('#edForm [type=submit]');
  }

  /* =========================================================
     Categories
     ========================================================= */
  function renderCategories() {
    const c = S.catalog();
    main.innerHTML = `
      ${head('カテゴリ', { lead: 'ショップの一覧ページで、カテゴリごとに商品を切り替えられます。商品のないカテゴリはショップには表示されません。' })}
      <div class="adm-table-wrap">
        <table class="adm-table adm-cat-table">
          <thead><tr><th><span class="visually-hidden">並び順</span></th><th>カテゴリ名</th><th>ID</th><th class="adm-num">商品数</th><th><span class="visually-hidden">操作</span></th></tr></thead>
          <tbody>
            ${c.categories.map((k, i) => `
              <tr data-cid="${esc(k.id)}">
                <td><span class="adm-order">
                  <button class="adm-btn adm-btn--icon adm-btn--quiet" type="button" data-cmove="-1" aria-label="${esc(k.name)}を上へ" ${i === 0 ? 'aria-disabled="true"' : ''}>${ICON.up}</button>
                  <button class="adm-btn adm-btn--icon adm-btn--quiet" type="button" data-cmove="1" aria-label="${esc(k.name)}を下へ" ${i === c.categories.length - 1 ? 'aria-disabled="true"' : ''}>${ICON.down}</button>
                </span></td>
                <td><label class="visually-hidden" for="cn-${i}">カテゴリ名</label><input class="input" id="cn-${i}" data-cname value="${esc(k.name)}" maxlength="20" style="max-width:280px"></td>
                <td class="adm-faint">${esc(k.id)}</td>
                <td class="adm-num">${c.products.filter((p) => p.category === k.id).length}</td>
                <td><div class="adm-row-actions"><button class="adm-btn adm-btn--icon adm-btn--danger" type="button" data-cdel aria-label="${esc(k.name)}を削除">${ICON.del}</button></div></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <form class="adm-card" id="catAdd" style="margin-top:20px" novalidate>
        <h2>カテゴリを追加</h2>
        <div class="adm-fields">
          <div class="adm-field"><label for="nc-name">カテゴリ名<span class="req">必須</span></label><input class="input" id="nc-name" maxlength="20" placeholder="例：精米、玄米"></div>
          <div class="adm-field"><label for="nc-id">ID（URLに使われます）</label><input class="input" id="nc-id" maxlength="30" placeholder="例：vegetables" autocapitalize="off" spellcheck="false"><p class="adm-hint">半角英小文字・数字・ハイフン。空欄なら自動で付けます。</p></div>
        </div>
        <p class="adm-error" id="nc-err" hidden></p>
        <div style="margin-top:14px"><button class="btn btn--gold btn--sm" type="submit">${ICON.plus}追加する</button></div>
      </form>`;
    $('#catAdd').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (saving) return;
      const name = $('#nc-name').value.trim();
      const id = $('#nc-id').value.trim();
      let msg = '';
      if (!name) msg = 'カテゴリ名を入力してください。';
      else if (id && !/^[a-z0-9][a-z0-9-]{0,29}$/.test(id)) msg = 'IDは半角英小文字・数字・ハイフンで入力してください。';
      else if (id && S.category(id)) msg = 'このIDはすでに使われています。';
      showErr('nc-err', msg);
      if (msg) { $(name ? '#nc-id' : '#nc-name').focus(); return; }
      let taken = false;
      const ok = await commit((cat) => {
        let cid = id;
        if (cid && cat.categories.some((k) => k.id === cid)) { taken = true; return false; }
        if (!cid) { let n = cat.categories.length + 1; cid = `cat-${n}`; while (cat.categories.some((k) => k.id === cid)) cid = `cat-${++n}`; }
        cat.categories.push({ id: cid, name });
      }, `「${name}」を追加しました`);
      if (currentRoute !== 'categories') return;
      if (taken) { showErr('nc-err', 'このIDは、ほかの画面ですでに使われています。'); $('#nc-id').focus(); return; }
      if (ok) { formDirty = false; renderCategories(); $('#nc-name').focus(); }
    });
  }
  async function categoryAction(e) {
    const tr = e.target.closest('[data-cid]');
    if (!tr) return;
    const b = e.target.closest('button');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    const cid = tr.dataset.cid;
    const r0 = S.rev();
    // after a save, or when a failed save brought newer data from the server (live)
    const refresh = (ok) => currentRoute === 'categories' && (ok || (LIVE && S.rev() !== r0));
    if (b.dataset.cmove) {
      const step = +b.dataset.cmove;
      const ok = await commit((c) => {
        const i = c.categories.findIndex((k) => k.id === cid);
        if (i < 0) return gone('このカテゴリ');
        if (!moveIn(c.categories, i, step)) return false;
      });
      if (refresh(ok)) { renderCategories(); const again = $(`[data-cid="${CSS.escape(cid)}"] [data-cmove="${b.dataset.cmove}"]`); if (again) again.focus(); }
      return;
    }
    if (b.hasAttribute('data-cdel')) {
      const k = S.category(cid);
      if (!k) return;
      const n = S.catalog().products.filter((p) => p.category === k.id).length;
      const ok = await confirmDialog({ title: 'カテゴリを削除しますか？', body: `「${esc(k.name)}」を削除します。${n ? `このカテゴリの商品${n}件は「未分類」になります（商品は削除されません）。` : ''}`, ok: '削除する', danger: true });
      if (!ok) return;
      const done = await commit((c) => {
        c.categories = c.categories.filter((x) => x.id !== cid);
        c.products.forEach((p) => { if (p.category === cid) p.category = ''; });
      }, '削除しました');
      if (refresh(done)) { renderCategories(); focusAfter('#nc-name'); }
    }
  }
  async function categoryRename(e) {
    const inp = e.target.closest('[data-cname]');
    if (!inp) return;
    const name = inp.value.trim();
    const cid = inp.closest('[data-cid]').dataset.cid;
    const k = S.category(cid);
    if (!k) return;
    if (!name) { inp.value = k.name; toast('カテゴリ名は空にできません。', { error: true }); return; }
    if (name === k.name) return;
    const ok = await commit((c) => {
      const x = c.categories.find((y) => y.id === cid);
      if (!x) return gone('このカテゴリ');
      x.name = name;
    }, `カテゴリ名を「${name}」にしました`);
    if (!inp.isConnected) return;
    if (!ok) { const cur = S.category(cid); if (cur) inp.value = cur.name; else if (currentRoute === 'categories') renderCategories(); return; }
    const tr = inp.closest('[data-cid]');
    tr.querySelector('[data-cmove="-1"]').setAttribute('aria-label', `${name}を上へ`);
    tr.querySelector('[data-cmove="1"]').setAttribute('aria-label', `${name}を下へ`);
    tr.querySelector('[data-cdel]').setAttribute('aria-label', `${name}を削除`);
  }

  /* =========================================================
     Orders
     ========================================================= */
  const orderState = { status: '', src: '', open: null, payment: 'paid' };
  function renderOrders() {
    const pay = orderState.payment;
    if (LIVE) loadOrders(pay);
    const st = ordersStatus(pay);
    const all = ordersList(pay);
    const sources = [...new Set(all.map((o) => o.source).filter(Boolean))];
    // drop a source filter that no longer matches any order (the select would be hidden)
    if (!sources.length || (orderState.src && orderState.src !== '__shop' && !sources.includes(orderState.src))) orderState.src = '';
    const list = all.filter((o) => (!orderState.status || o.status === orderState.status)
      && (!orderState.src || (orderState.src === '__shop' ? !o.source : o.source === orderState.src)));
    const unpaid = (o) => LIVE && o.payment && o.payment !== 'paid';
    const lead = LIVE
      ? 'カードでのお支払いが済んだ注文が届きます。状態を変えて、発送の進み具合を管理できます。「決済待ち」「期限切れ」の注文は、お支払いが済んでいないため発送しないでください。'
      : 'ショップで確定した注文が届きます（デモのため、このブラウザで行った注文だけが表示されます）。状態を変えて、発送の進み具合を管理できます。';
    const empty = st === 'loading' ? loadingHTML('注文を読み込んでいます…')
      : st === 'error' ? `<div class="adm-card adm-empty"><span class="empty__moon" aria-hidden="true"></span><p>注文を読み込めませんでした。<br>${esc(errText(orderCache[pay].error, '読み込めませんでした'))}</p><button class="adm-btn" type="button" data-orders-reload>もう一度読み込む</button></div>`
      : `<div class="adm-card adm-empty"><span class="empty__moon" aria-hidden="true"></span><p>${all.length ? 'この条件の注文はありません。' : LIVE ? (pay === 'paid' ? 'まだ注文はありません。カードでのお支払いが済んだ注文が、ここに表示されます。' : 'この条件の注文はありません。') : 'まだ注文はありません。ショップで試しに注文すると、ここに表示されます。'}</p><a class="adm-btn" href="../shop.html" target="_blank" rel="noopener">ショップを開く${ICON.ext}</a></div>`;
    main.innerHTML = `
      ${head('注文', { lead })}
      <div class="adm-toolbar">
        ${LIVE ? `
        <label class="visually-hidden" for="oPay">お支払いの状態で絞り込む</label>
        <select class="select" id="oPay">
          ${Object.entries(PAY_FILTER).map(([k, v]) => `<option value="${k}" ${pay === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>` : ''}
        <label class="visually-hidden" for="oStatus">状態で絞り込む</label>
        <select class="select" id="oStatus">
          <option value="">すべての状態（${all.length}）</option>
          ${Object.entries(ORDER_STATUS).map(([k, v]) => `<option value="${k}" ${orderState.status === k ? 'selected' : ''}>${v}（${all.filter((o) => o.status === k).length}）</option>`).join('')}
        </select>
        ${sources.length ? `
        <label class="visually-hidden" for="oSrc">注文の経路で絞り込む</label>
        <select class="select" id="oSrc">
          <option value="">すべての経路</option>
          ${sources.map((k) => `<option value="${esc(k)}" ${orderState.src === k ? 'selected' : ''}>イベントページから（${all.filter((o) => o.source === k).length}）</option>`).join('')}
          <option value="__shop" ${orderState.src === '__shop' ? 'selected' : ''}>通常のショップから（${all.filter((o) => !o.source).length}）</option>
        </select>` : ''}
        ${LIVE ? `<button class="adm-btn" type="button" id="oReload" data-orders-reload>最新の注文を読み込む</button>` : ''}
      </div>
      ${st === 'ok' && list.length ? `
      <div class="adm-table-wrap adm-table-wrap--orders">
        <table class="adm-table adm-table--orders">
          <thead><tr><th>注文番号・日時</th><th>お客様</th><th>商品</th><th class="adm-num">合計</th><th>お支払い</th><th>状態</th></tr></thead>
          <tbody>
            ${list.map((o) => { const cu = o.customer || {}; const items = Array.isArray(o.items) ? o.items : []; const short = Array.isArray(o.stockShort) ? o.stockShort : []; const mm = mismatchOf(o); const test = isTestPay(o); const ua = unavailableOf(o); const aw = addrWarningsOf(o); const awCu = addrWarningItems(aw.filter((w) => w.who === 'customer'), o); const awTo = addrWarningItems(aw.filter((w) => w.who !== 'customer'), o); return `
              <tr>
                <td class="cell-no"><button class="adm-toggle" type="button" data-open="${esc(o.no)}" aria-expanded="${orderState.open === o.no}" aria-controls="od-${esc(o.no)}">${esc(o.no)}</button><span class="adm-order-at">${fmtDate(o.at)}</span></td>
                <td class="cell-cu" data-label="お客様">${wordPhrases(cu.name)}${o.shipTo ? '<br><span class="adm-faint nowrap">別住所へお届け</span>' : ''}${o.source ? '<br><span class="pill pill--event">イベント</span>' : ''}${aw.length ? ADDR_BADGE : ''}</td>
                <td class="cell-items" data-label="商品"><div class="adm-items">${items.map((it) => `<span class="adm-item">${itemLine(it)}</span>`).join('')}${short.length ? `<span class="adm-error adm-short">在庫が足りません：${short.map((x) => wordPhrases(x.name, '', `（${esc(x.short)}点）`)).join('、')}</span>` : ''}</div></td>
                <td class="cell-total adm-num" data-label="合計">¥${yen(o.total)}${hasShipNote(o) ? `<small class="adm-ship-note">${shipLine(o)}</small>` : ''}</td>
                <td class="cell-pay nowrap" data-label="お支払い">${esc(o.pay)}${LIVE && PAY_STATE[o.payment] ? `<br><span class="pill pill--pay-${esc(o.payment)}">${PAY_STATE[o.payment]}</span>` : ''}${test ? TEST_BADGE : ''}${mm ? MISMATCH_BADGE : ''}${ua.length ? UNAVAIL_BADGE : ''}</td>
                <td class="cell-status" data-label="状態">
                  ${unpaid(o) ? `<span class="adm-faint">${o.payment === 'expired' ? phrases(['お支払いが', 'なかったため、', '発送しません']) : phrases(['お支払いの完了を', '待っています'])}</span>` : `
                  <label class="visually-hidden" for="os-${esc(o.no)}">${esc(o.no)}の状態</label>
                  <select class="select adm-status-select" id="os-${esc(o.no)}" data-order="${esc(o.no)}" data-status="${esc(o.status)}">
                    ${Object.entries(ORDER_STATUS).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}
                  </select>`}
                </td>
              </tr>
              <tr class="adm-order-detail" id="od-${esc(o.no)}" ${orderState.open === o.no ? '' : 'hidden'}>
                <td colspan="6">
                  <div class="adm-order-grid">
                    <div><h3>ご注文者さま</h3><ul><li>${esc(cu.name)}（${esc(cu.kana)}）</li><li>〒${esc(zipText(cu.zip))} ${esc(cu.address)}</li>${awCu}<li>${esc(cu.tel)}</li><li>${esc(cu.email)}</li></ul></div>
                    <div><h3>お届け先</h3><ul>${o.shipTo ? `<li>${esc(o.shipTo.name)} さま</li><li>〒${esc(zipText(o.shipTo.zip))} ${esc(o.shipTo.address)}</li>${awTo}<li>${esc(o.shipTo.tel)}</li>` : `<li>ご注文者さまと同じ</li>${awTo}`}<li>希望日：${esc(o.date || (o.preorder ? '予約商品の発送にあわせる' : o.source ? 'イベント注文（日付指定なし）' : '最短'))}／時間帯：${esc(o.time || '指定なし')}</li>${o.noshi ? `<li>のし名入れ：${esc(o.noshi)}</li>` : ''}</ul></div>
                    <div><h3>内訳</h3><ul>${items.map((it) => `<li>${itemLine(it, true)}</li>`).join('')}<li>${shipLine(o, false)}${parcelsOf(o).length ? `<br><span class="adm-faint">${parcelLine(o)}</span>` : ''}${shipIncluded(o) ? SHIP_INCL : ''}</li><li><b>合計 ¥${yen(o.total)}</b></li>${LIVE && PAY_STATE[o.payment] ? `<li>お支払い：${esc(o.pay)}（${PAY_STATE[o.payment]}${o.paidAt ? `　${fmtDate(o.paidAt)}` : ''}）</li>` : ''}${test ? `<li class="adm-error">${TEST_LINE}</li>` : ''}${mm ? `<li class="adm-error">${mismatchLine(mm)}</li>` : ''}${unavailableItems(ua, o)}${short.length ? `<li class="adm-error">在庫が足りません：${short.map((x) => `${esc(x.name)} ${esc(x.short)}点`).join('、')}。お客さまへのご連絡をお願いします。</li>` : ''}${o.memo ? `<li>備考：${esc(o.memo)}</li>` : ''}</ul></div>
                  </div>
                </td>
              </tr>`; }).join('')}
          </tbody>
        </table>
      </div>` : empty}`;
    $('#oStatus').addEventListener('change', (e) => { orderState.status = e.target.value; renderOrders(); $('#oStatus').focus(); });
    if ($('#oSrc')) $('#oSrc').addEventListener('change', (e) => { orderState.src = e.target.value; renderOrders(); $('#oSrc').focus(); });
    if ($('#oPay')) $('#oPay').addEventListener('change', (e) => { orderState.payment = e.target.value; orderState.open = null; renderOrders(); $('#oPay').focus(); });
  }
  async function orderAction(e) {
    const r = e.target.closest('[data-orders-reload]');
    if (r) {
      if (r.getAttribute('aria-disabled') === 'true') return;
      r.setAttribute('aria-disabled', 'true');
      announce('注文を読み込んでいます…');
      const pay = orderState.payment;
      loadCatalog({ force: true }); // orders change the stock, so the products are read again too
      await loadOrders(pay, { force: true });
      const err = orderCache[pay] && orderCache[pay].error;
      if (r.isConnected) r.removeAttribute('aria-disabled');
      if (err && orderCache[pay].list) toast(errText(err, '読み込めませんでした'), { error: true });
      else if (!err) announce(`注文を読み込みました（${ordersList(pay).length}件）`);
      return;
    }
    const t = e.target.closest('[data-open]');
    if (!t) return;
    const no = t.dataset.open;
    orderState.open = orderState.open === no ? null : no;
    const row = document.getElementById(`od-${no}`);
    $$('.adm-order-detail').forEach((x) => { x.hidden = x !== row || orderState.open !== no; });
    $$('[data-open]').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.open === orderState.open)));
  }
  const orderSaving = new Set(); // live: order numbers whose status is being saved
  async function orderChange(e) {
    const sel = e.target.closest('[data-order]');
    if (!sel) return;
    const no = sel.dataset.order;
    if (!LIVE) {
      const r = S.updateOrder(no, { status: sel.value });
      if (!r.ok) { toast(r.error, { error: true }); return; }
      sel.dataset.status = sel.value;
      updateNavCounts();
      toast(`${no} を「${ORDER_STATUS[sel.value]}」にしました`);
      return;
    }
    const prev = sel.dataset.status;
    if (orderSaving.has(no)) { sel.value = prev; announce('保存しています。少しお待ちください。'); return; }
    orderSaving.add(no);
    sel.setAttribute('aria-busy', 'true');
    try {
      const res = await api(() => API.admin.updateOrder(no, { status: sel.value }));
      const o = res && res.order;
      if (!o || o.no !== no) throw new Error('注文の状態を保存できませんでした。もう一度お試しください。');
      patchCachedOrder(o);
      const cur = document.getElementById(`os-${no}`) || sel;
      cur.value = o.status; cur.dataset.status = o.status;
      updateNavCounts();
      toast(`${no} を「${ORDER_STATUS[o.status] || o.status}」にしました`);
    } catch (err) {
      const cur = document.getElementById(`os-${no}`) || sel;
      cur.value = prev;
      toast(errText(err), { error: true });
    } finally {
      orderSaving.delete(no);
      sel.removeAttribute('aria-busy');
    }
  }

  /* =========================================================
     Event page (高輪) + QR code
     ========================================================= */
  // preview=1 keeps the owner's own browser from being tagged as an event visitor
  const eventURL = (e, preview = false) => new URL(`../shop.html${preview ? '?preview=1' : ''}#${e.slug}`, location.href).href;
  function qrCanvas(text, size = 1024) {
    if (!window.qrcode) return null;
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount(), margin = 4, cell = Math.floor(size / (n + margin * 2));
    const cv = document.createElement('canvas');
    cv.width = cv.height = cell * (n + margin * 2);
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#1b222b';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    return cv;
  }
  function eventOrdersHTML() {
    const e = S.catalog().settings.event;
    const st = ordersStatus();
    if (st !== 'ok') return `<h2>イベントからの注文</h2><p class="adm-muted">${st === 'error' ? '注文を読み込めませんでした。' : '注文を読み込んでいます…'}</p>`;
    const n = ordersList().filter((o) => o.source === e.slug).length;
    return `<h2>イベントからの注文</h2>
            <p><b style="font-size:28px;color:var(--gold-300);font-family:var(--font-display)">${n}</b> 件</p>
            ${n ? `<p><a class="link" href="#orders" data-src-filter="${esc(e.slug)}">注文一覧で見る</a></p>` : ''}`;
  }
  // the event form's banner image while it is edited (null: none) and how many images are on
  // their way. A new object for every drawing of the screen, so a late upload never lands in the next one
  let evEdit = null;
  const evUploading = () => !!(evEdit && evEdit.uploads > 0);
  // the description that comes with a built-in image (the flyer: the text printed on it)
  const builtinAlt = (b) => { const d = S.DEFAULT_EVENT.banner; return d && b.src === d.src ? d.alt : b.alt; };
  // a description the owner did not write: it is replaced when another image is chosen
  const autoAlt = (alt) => !String(alt || '').trim() || BUILTIN_IMAGES.some((b) => b.alt === alt || builtinAlt(b) === alt);
  function evBannerHTML() {
    const b = evEdit.banner;
    return `
      <div class="adm-banner">
        <div class="adm-banner__prev">${b ? `<img src="${esc(U.asset(b.src))}" alt="">` : '<span class="adm-faint">画像はありません</span>'}</div>
        <div class="adm-field">
          <div class="adm-banner__btns">
            <span class="adm-upload"><input type="file" accept="image/*" id="evBannerUpload" aria-label="${b ? 'ページ上部の画像を変更する（アップロード）' : 'ページ上部の画像をアップロード'}" aria-describedby="ev-banner-hint"><span class="adm-btn">${b ? '画像を変更する' : '画像をアップロード'}</span></span>
            ${b ? '<button class="adm-btn adm-btn--danger" type="button" id="evBannerRemove">画像を外す</button>' : ''}
          </div>
          <p class="adm-hint" id="ev-banner-hint">JPEG・PNG・WebPなど。長い辺が1600pxになるように自動で縮小して保存します。チラシは横長（3:2くらい）のものがおすすめです。</p>
        </div>
        <div class="adm-field"><span class="adm-label">サイト内の画像から選ぶ</span>
          <div class="adm-builtins">${BUILTIN_IMAGES.map((x, i) => `<button class="adm-builtin${b && b.src === x.src ? ' is-current' : ''}" type="button" data-ev-builtin="${i}" aria-label="${esc(x.alt)}${b && b.src === x.src ? '（いま使っている画像）' : 'を使う'}">${builtinImg(x)}</button>`).join('')}</div>
        </div>
        ${b ? `
        <div class="adm-field">
          <label for="ev-banner-alt">画像の説明<span class="req">必須</span></label>
          <textarea class="textarea" id="ev-banner-alt" rows="4" maxlength="300" aria-describedby="ev-banner-alt-hint">${esc(b.alt)}</textarea>
          <p class="adm-hint" id="ev-banner-alt-hint">画像に書かれている内容（商品名・価格など）を、文章で入れてください。画像が見えない方の読み上げや、画像を読み込めないときに使われます。画像を変えたときは、説明も見直してください。</p>
          <p class="adm-error" id="ev-banner-alt-err" hidden></p>
        </div>` : ''}
      </div>`;
  }
  function renderEvBanner(focusSel) {
    const box = $('#evBannerBox');
    if (!box) return;
    box.innerHTML = evBannerHTML();
    const el = focusSel && $(focusSel, box);
    if (el) el.focus({ preventScroll: true });
  }
  // upload a banner image: shrunk like the product photos (a little larger: flyers carry small text),
  // live: sent to the server's image storage (or kept in the data when there is none)
  async function evBannerFile(el) {
    const f = el.files && el.files[0];
    if (!f || !evEdit) return;
    const st = evEdit;
    const inline0 = inlineImages;
    let msg = '';
    uploading(el, true, '画像');
    st.uploads++;
    try {
      const src = await storeImage(await shrinkImage(f, 1600));
      if (evEdit !== st) return;
      const prev = st.banner;
      st.banner = { src, alt: prev && !autoAlt(prev.alt) ? prev.alt : '' };
      formDirty = true;
      renderEvBanner('#evBannerUpload');
      announce(st.banner.alt ? '画像を変更しました。画像の説明も見直してください。' : '画像を読み込みました。画像の説明を入力してください。');
    } catch (err) {
      msg = errText(err, '画像を保存できませんでした');
    } finally {
      st.uploads--;
      if (el.isConnected) { uploading(el, false, '画像'); el.value = ''; }
    }
    if (msg) toast(msg, { error: true });
    else if (inlineImages > inline0) toast('画像の保存先（サーバー）が用意されていないため、画像はイベントページのデータの中に保存します。データが大きくなるため、できるだけ小さな画像にしてください。');
  }
  // the form's switch and dates → 「販売中」 etc. (follows the form, before it is saved)
  function evPhaseHTML(f, saved) {
    const ph = eventPhase(f);
    const text = {
      on: `いまは販売中です${f.end ? `（${dateText(f.end)}まで）` : ''}。イベントページを公開し、イベント限定の商品も購入できます。`,
      before: `${dateText(f.start)}から公開・販売します。それまでは、イベントページは表示されず、イベント限定の商品も購入できません。`,
      after: `${dateText(f.end)}で終了しました。イベントページは表示されず、イベント限定の商品も購入できません。`,
      off: 'イベントページを公開していないため、ページは表示されず、イベント限定の商品も購入できません。',
    }[ph];
    const pending = ph !== eventPhase(saved) ? '<small>保存すると、この状態になります</small>' : '';
    return `<span class="adm-evphase__label">いまの状態</span>${phasePill(ph)}<span class="adm-evphase__text">${text}${pending}</span>`;
  }
  // event-only products that are for sale but not on the page: nobody could buy them
  function evMissingHTML(c, picked) {
    return c.products.filter((p) => p.options.eventOnly && p.status !== 'draft' && !picked.has(p.id))
      .map((p) => `<p class="adm-error adm-evwarn__item">イベント限定の商品「${esc(p.name)}」が、イベントページに入っていません。このままでは購入できません。</p>`).join('');
  }
  function renderEventAdmin() {
    const c = S.catalog();
    const e = c.settings.event;
    const evBase = JSON.stringify(e);
    evEdit = { banner: e.banner ? { src: e.banner.src, alt: e.banner.alt } : null, uploads: 0 };
    loadOrders('paid');
    const url = eventURL(e);
    const previewURL = eventURL(e, true);
    const cv = qrCanvas(url, 720);
    const fmt = (d) => (d ? d.replace(/-/g, '/') : '指定なし');
    const phase0 = evPhaseHTML(e, e), warn0 = evMissingHTML(c, new Set(e.products));
    main.innerHTML = `
      ${head('イベントページ', { actions: `<a class="adm-btn" href="${esc(previewURL)}" target="_blank" rel="noopener">ページを見る${ICON.ext}</a>`, lead: '高輪のイベント会場で、QRコードから開いてもらうページです。表示期間のあいだだけ公開され、トップページとショップにもバナーが出ます。このページから注文すると、注文一覧に「イベント」と表示されます。' })}
      <div class="adm-grid2">
        <form class="adm-form" id="evForm" novalidate>
          <section class="adm-sec" aria-labelledby="ev1">
            <h2 id="ev1">公開の設定</h2>
            <label class="adm-check"><input type="checkbox" id="ev-enabled" ${e.enabled ? 'checked' : ''}><span>イベントページを公開する<small>チェックを外すと、期間中でもページとバナーを隠します</small></span></label>
            <div class="adm-fields adm-fields--3">
              <div class="adm-field"><label for="ev-date">開催日</label><input class="input" id="ev-date" type="date" value="${esc(e.date)}"></div>
              <div class="adm-field"><label for="ev-start">表示の開始日</label><input class="input" id="ev-start" type="date" value="${esc(e.start)}"></div>
              <div class="adm-field"><label for="ev-end">表示の終了日</label><input class="input" id="ev-end" type="date" value="${esc(e.end)}"><p class="adm-hint">目安はイベントから3か月ほど</p></div>
            </div>
            <p class="adm-error" id="ev-err" hidden></p>
            <p class="adm-evphase" id="evPhase" aria-live="polite">${phase0}</p>
            <p class="adm-hint">イベント限定の商品は、この期間のあいだだけ、イベントページで購入できます。</p>
          </section>
          <section class="adm-sec" aria-labelledby="ev3">
            <h2 id="ev3">ページ上部の画像<small>チラシなどを、ページのいちばん上に大きく表示します（なくてもかまいません）</small></h2>
            <div id="evBannerBox">${evBannerHTML()}</div>
          </section>
          <section class="adm-sec" aria-labelledby="ev2">
            <h2 id="ev2">ページの内容</h2>
            <div class="adm-field"><label for="ev-title">見出し</label><input class="input" id="ev-title" value="${esc(e.title)}" maxlength="40"></div>
            <div class="adm-field"><label for="ev-lead">ごあいさつ文</label><textarea class="textarea" id="ev-lead" rows="3" maxlength="200">${esc(e.lead)}</textarea></div>
            <div class="adm-field"><label for="ev-ship">お届けの案内</label><input class="input" id="ev-ship" value="${esc(e.shipNote)}" maxlength="60"><p class="adm-hint">このページから注文した方の確認画面・完了画面にも表示されます</p></div>
            <fieldset class="adm-field" style="border:0;margin:0;padding:0">
              <legend class="adm-legend">ページで紹介する商品（上から順に表示）</legend>
              <div class="adm-checks" style="margin-top:8px">
                ${[...e.products.map((id) => c.products.find((p) => p.id === id)).filter(Boolean), ...c.products.filter((p) => !e.products.includes(p.id))].map((p) => `
                  <label class="adm-check"><input type="checkbox" name="ev-prod" value="${esc(p.id)}" ${e.products.includes(p.id) ? 'checked' : ''}><span>${esc(p.name)}${p.options.eventOnly ? '<span class="adm-tag adm-tag--inline">イベント限定</span>' : ''}${p.status === 'draft' ? '<small>非公開の商品です（ページには表示されません）</small>' : p.options.eventOnly ? '<small>イベントページだけで販売する商品です。チェックを外すと、購入できなくなります</small>' : ''}</span></label>`).join('')}
              </div>
              <div class="adm-evwarn" id="evWarn" aria-live="polite">${warn0}</div>
            </fieldset>
          </section>
          <div><button class="btn btn--gold btn--sm" type="submit">イベントページを保存する</button></div>
        </form>
        <div>
          <section class="adm-card adm-qr">
            <h2>会場用のQRコード</h2>
            <p class="adm-muted">いまの状態：${phasePill(eventPhase(e))}（${fmt(e.start)}〜${fmt(e.end)}）</p>
            ${cv ? `<img class="adm-qr__img" src="${cv.toDataURL('image/png')}" alt="イベントページのQRコード" width="240" height="240">` : '<p class="adm-error">QRコードを作れませんでした（ネットワークにつながっているか確認してください）。</p>'}
            <p class="adm-qr__url"><code id="evUrl">${esc(url)}</code></p>
            <div class="adm-row-actions" style="justify-content:flex-start">
              ${cv ? '<button class="adm-btn" type="button" id="qrSave">QRコードを画像で保存</button>' : ''}
              <button class="adm-btn" type="button" id="urlCopy">URLをコピー</button>
            </div>
            <p class="adm-hint" style="margin-top:10px">チラシやPOPに印刷するときは、画像で保存したQRコードを使ってください。${LIVE ? '' : 'デモ版のURLなので、本番の公開後に作り直します。'}</p>
          </section>
          <section class="adm-card" id="evOrders">${eventOrdersHTML()}</section>
        </div>
      </div>`;
    const save1 = $('#qrSave');
    if (save1) save1.addEventListener('click', () => {
      const big = qrCanvas(url, 1600);
      const a = document.createElement('a');
      a.href = big.toDataURL('image/png');
      a.download = `mangetsu-event-${e.slug}-qr.png`;
      document.body.appendChild(a); a.click(); a.remove();
      toast('QRコードを保存しました');
    });
    $('#urlCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); toast('URLをコピーしました'); }
      catch { const r = document.createRange(); r.selectNodeContents($('#evUrl')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('URLを選択しました。コピーしてお使いください。'); }
    });
    $('#evPhase').dataset.live = phase0;
    $('#evWarn').dataset.live = warn0;
    const form = $('#evForm');
    const formEvent = () => ({ enabled: $('#ev-enabled').checked, start: $('#ev-start').value, end: $('#ev-end').value });
    const onField = (ev) => {
      const t = ev.target;
      if (t.matches('#ev-enabled, #ev-start, #ev-end')) liveHTML($('#evPhase'), evPhaseHTML(formEvent(), e));
      else if (t.matches('[name="ev-prod"]')) liveHTML($('#evWarn'), evMissingHTML(c, new Set($$('input[name="ev-prod"]:checked', form).map((x) => x.value))));
      else if (t.id === 'ev-banner-alt' && evEdit.banner) {
        evEdit.banner.alt = t.value;
        if (t.getAttribute('aria-invalid') === 'true' && t.value.trim()) showErr('ev-banner-alt-err', '', '#ev-banner-alt');
      } else if (t.id === 'evBannerUpload' && ev.type === 'change') evBannerFile(t);
    };
    form.addEventListener('input', onField);
    form.addEventListener('change', onField);
    form.addEventListener('click', (ev) => {
      const bb = ev.target.closest('[data-ev-builtin]');
      const rm = ev.target.closest('#evBannerRemove');
      if (!bb && !rm) return;
      if (saving) return;
      if (evUploading()) { announce(LIVE ? '画像を送っています。少しお待ちください。' : '画像を読み込んでいます。少しお待ちください。'); return; }
      formDirty = true;
      if (rm) {
        evEdit.banner = null;
        renderEvBanner('#evBannerUpload');
        announce('画像を外しました。「イベントページを保存する」を押すと反映されます。');
        return;
      }
      const x = BUILTIN_IMAGES[+bb.dataset.evBuiltin];
      const prev = evEdit.banner;
      evEdit.banner = { src: x.src, alt: prev && !autoAlt(prev.alt) ? prev.alt : builtinAlt(x) };
      renderEvBanner(`[data-ev-builtin="${bb.dataset.evBuiltin}"]`);
      announce(`「${x.alt}」を、ページ上部の画像にしました。`);
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (saving) return;
      if (evUploading()) { toast(LIVE ? '画像を送っています。送り終わってから保存してください。' : '画像を読み込んでいます。読み込み終わってから保存してください。'); return; }
      const start = $('#ev-start').value, end = $('#ev-end').value;
      const errs = [];
      const badDates = !!(start && end && start > end);
      showErr('ev-err', badDates ? '表示の終了日は、開始日より後の日付にしてください。' : '', '#ev-end');
      if (badDates) errs.push('#ev-end');
      const altEl = $('#ev-banner-alt');
      const banner = evEdit.banner ? { src: evEdit.banner.src, alt: (altEl ? altEl.value : evEdit.banner.alt).trim() } : null;
      if (banner) {
        showErr('ev-banner-alt-err', banner.alt ? '' : '画像の説明を入力してください（画像に書かれている内容を文章で）。', '#ev-banner-alt');
        if (!banner.alt) errs.push('#ev-banner-alt');
      }
      if (errs.length) {
        $(errs[0]).focus();
        toast(`入力内容を確認してください（${errs.length}か所）`, { error: true });
        return;
      }
      const next = {
        enabled: $('#ev-enabled').checked,
        date: $('#ev-date').value, start, end,
        title: $('#ev-title').value.trim() || S.DEFAULT_EVENT.title,
        lead: $('#ev-lead').value.trim(),
        shipNote: $('#ev-ship').value.trim() || S.DEFAULT_EVENT.shipNote,
        products: $$('input[name="ev-prod"]:checked').map((x) => x.value),
        banner,
      };
      const ok = await commit((cat) => { cat.settings.event = { ...cat.settings.event, ...next }; }, 'イベントページを保存しました', { href: previewURL, text: 'ページで確認' }, {
        conflict: (latest) => (JSON.stringify(latest.settings.event) === evBase ? null
          : { title: 'イベントページが先に変更されていました', body: 'ほかの画面（または別の方）が、イベントページの設定を先に保存していました。入力した内容で上書きして保存しますか？', ok: '上書きして保存する' }),
      });
      if (ok && currentRoute === 'event') { formDirty = false; renderEventAdmin(); focusAfter('#evForm [type=submit]'); }
    });
  }

  /* =========================================================
     Settings
     ========================================================= */
  const RATE_RE = /^\d{1,5}$/; // 0–99,999 yen
  const clsLabel = (kg) => `${kg}kgまで`;
  const settingsKey = (c) => JSON.stringify([c.settings.ship, c.settings.maxQty, c.settings.news]);
  // narrow screens: the rate table scrolls sideways. A hint above it and a fade on its right edge
  // show that there is more (the hint only while the table is wider than its box)
  let rateObserver = null;
  function watchRateScroll() {
    const box = $('.adm-ratebox', main);
    const wrap = box && $('.adm-ratewrap', box);
    const hint = $('[data-rate-hint]', main);
    if (!wrap || !hint) return;
    const update = () => {
      const more = wrap.scrollWidth - wrap.clientWidth > 1;
      const left = Math.abs(wrap.scrollLeft);
      hint.hidden = !more;
      box.classList.toggle('is-more', more && left + wrap.clientWidth < wrap.scrollWidth - 1);
      box.classList.toggle('is-scrolled', more && left > 1);
    };
    wrap.addEventListener('scroll', update, { passive: true });
    if (rateObserver) rateObserver.disconnect();
    if ('ResizeObserver' in window) {
      rateObserver = new ResizeObserver(update);
      rateObserver.observe(wrap);
      rateObserver.observe($('table', wrap));
    } else update();
  }

  function renderSettings() {
    const c = S.catalog();
    const s = c.settings;
    const ship = s.ship;
    const base = settingsKey(c);
    const num = (id, label, val, hint = '', attrs = 'min="0" step="1"') => `
      <div class="adm-field"><label for="${id}">${label}</label><input class="input input--num" id="${id}" type="number" ${attrs} inputmode="numeric" value="${esc(val)}"${hint ? ` aria-describedby="${id}-hint"` : ''}>${hint ? `<p class="adm-hint" id="${id}-hint">${hint}</p>` : ''}<p class="adm-error" id="${id}-err" hidden></p></div>`;
    // examples use the saved rates, so they always match the table
    const kanto = C.SHIP_REGIONS.find((r) => r.id === 'kanto') || C.SHIP_REGIONS[0];
    const quote = (weight, qty) => C.shippingQuote({ lines: [{ weight, qty }], pref: kanto.prefs[0], ship: { rates: ship.rates, freeOver: 0 } });
    const ex1 = quote(5, 3), ex2 = quote(30, 2);
    main.innerHTML = `
      ${head('ショップ設定')}
      <form class="adm-form" id="setForm" novalidate>
        <section class="adm-sec" aria-labelledby="ss1">
          <h2 id="ss1">送料<small>金額はすべて税込・円</small></h2>
          <div class="adm-shipcalc">
            <p>送料は、お届け先の地域（都道府県）と、箱の重さで決まります。</p>
            <ul>
              <li>1つの箱（1個口）には30kgまで入ります。30kgを超えるご注文は、いくつかの箱（複数口）に分けてお送りします。</li>
              <li>箱ごとに、下の表の「◯kgまで」の送料がかかります。ご注文の送料は、箱ごとの送料の合計です。</li>
              <li>例（${esc(kanto.name)}の場合）：5kgの商品を3点 → 15kgの箱が1個口で ${yen(ex1.fee)}円。30kgの商品を2点 → 30kgの箱が2個口で ${yen(ex2.parcels[0].fee)}円×2＝${yen(ex2.fee)}円。</li>
              <li>商品の重さは、商品の編集画面の「重さ（kg）」で設定します。</li>
            </ul>
          </div>
          <p class="adm-scrollhint" data-rate-hint hidden>表は横にスクロールできます<span aria-hidden="true">→</span></p>
          <div class="adm-ratebox">
            <div class="adm-ratewrap">
              <table class="adm-rates">
                <caption class="visually-hidden">送料表（お届け先の地域・箱の重さごと、税込・円）</caption>
                <thead><tr><th scope="col">お届け先の地域</th>${C.SHIP_CLASSES.map((kg) => `<th scope="col">${clsLabel(kg)}</th>`).join('')}</tr></thead>
                <tbody>
                  ${C.SHIP_REGIONS.map((r) => `
                  <tr>
                    <th scope="row">${esc(r.name)}<small>${r.prefs.map((p) => `<span class="nowrap">${esc(p)}</span>`).join('・')}</small></th>
                    ${C.SHIP_CLASSES.map((kg, i) => `<td><input class="input input--num" id="rate-${r.id}-${i}" data-rate="${r.id}" data-ci="${i}" type="number" min="0" max="99999" step="1" inputmode="numeric" value="${esc(ship.rates[r.id][i])}" aria-label="${esc(r.name)} ${clsLabel(kg)} の送料"></td>`).join('')}
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
          <p class="adm-error" id="rate-err" hidden></p>
          <div class="adm-ratebar">
            <p class="adm-hint">金額は0〜99,999円の整数で入力してください。</p>
            <button class="adm-btn" type="button" id="rateReset">送料表を最初の金額に戻す</button>
          </div>
          <div class="adm-fields">
            ${num('s-free', '送料無料になるご注文金額（商品の合計・税込）', ship.freeOver, '商品の合計がこの金額以上のご注文は、送料が無料になります。0 にすると、送料無料にはしません。')}
          </div>
        </section>
        <section class="adm-sec" aria-labelledby="ss4">
          <h2 id="ss4">ご注文</h2>
          <div class="adm-fields">
            ${num('s-max', '同じ商品を1回で買える上限（点）', s.maxQty, '1〜99', 'min="1" max="99" step="1"')}
          </div>
        </section>
        <section class="adm-sec" aria-labelledby="ss2">
          <h2 id="ss2">トップページのお知らせ（NEWS）</h2>
          <label class="adm-check"><input type="checkbox" id="s-news-show" ${s.news.show ? 'checked' : ''}><span>お知らせを表示する</span></label>
          <div class="adm-fields">
            <div class="adm-field"><label for="s-news-text">お知らせの文言</label><input class="input" id="s-news-text" value="${esc(s.news.text)}" maxlength="40"></div>
            <div class="adm-field"><label for="s-news-link">リンク先の商品</label>
              <select class="select" id="s-news-link"><option value="">オンラインショップの一覧</option>${c.products.map((p) => `<option value="${esc(p.id)}" ${s.news.link === p.id ? 'selected' : ''}>${esc(p.name)}${p.status === 'draft' ? '（非公開）' : ''}</option>`).join('')}</select></div>
          </div>
        </section>
        <section class="adm-sec" aria-labelledby="ss3">
          <h2 id="ss3">お支払い方法</h2>
          <p>クレジットカード（Stripe）で受け付けます。カード決済の手数料（Stripeの標準は売上の3.6%）は、商品価格や送料に含めて設定してください。</p>
          <p class="adm-hint">本番では、Stripeのアカウント登録（入金先の銀行口座の設定と本人確認）が必要です。</p>
        </section>
        <div><button class="btn btn--gold btn--sm" type="submit">設定を保存する</button></div>
      </form>`;

    watchRateScroll();
    const rateInputs = () => $$('[data-rate]', main);
    const checkRates = () => {
      const bad = rateInputs().filter((x) => !RATE_RE.test(x.value.trim()));
      rateInputs().forEach((x) => setInvalid(x, 'rate-err', bad.includes(x)));
      showErr('rate-err', bad.length ? `送料は0〜99,999円の整数で入力してください（${bad.length}か所）。` : '');
      return bad;
    };
    const checkNum = (id, ok, msg) => { showErr(`${id}-err`, ok ? '' : msg, `#${id}`); return ok ? [] : [$(`#${id}`)]; };
    const checkFree = () => checkNum('s-free', /^\d{1,7}$/.test($('#s-free').value.trim()), '0以上の整数で入力してください（0 は送料無料にしない）。');
    const checkMax = () => { const v = $('#s-max').value.trim(); return checkNum('s-max', /^\d{1,2}$/.test(v) && +v >= 1 && +v <= 99, '1〜99の整数で入力してください。'); };
    // clear an error as soon as the field is fixed
    $('#setForm').addEventListener('input', (e) => {
      if (e.target.getAttribute('aria-invalid') !== 'true') return;
      if (e.target.dataset.rate) checkRates();
      else if (e.target.id === 's-free') checkFree();
      else if (e.target.id === 's-max') checkMax();
    });
    $('#rateReset').addEventListener('click', async () => {
      const ok = await confirmDialog({ title: '送料表を最初の金額に戻しますか？', body: '表の金額を、最初に登録した送料表の金額に戻します。「設定を保存する」を押すまでは保存されません。', ok: '最初の金額に戻す' });
      if (!ok) return;
      C.SHIP_REGIONS.forEach((r) => C.SHIP_CLASSES.forEach((_, i) => { $(`#rate-${r.id}-${i}`).value = C.DEFAULT_SHIP_RATES[r.id][i]; }));
      checkRates();
      formDirty = true;
      toast('送料表を最初の金額に戻しました。「設定を保存する」を押すと保存されます。');
    });
    $('#setForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (saving) return;
      const bad = [...checkRates(), ...checkFree(), ...checkMax()];
      if (bad.length) {
        bad[0].focus();
        toast(`入力内容を確認してください（${bad.length}か所）`, { error: true });
        return;
      }
      const rates = {};
      C.SHIP_REGIONS.forEach((r) => { rates[r.id] = C.SHIP_CLASSES.map((_, i) => Number($(`#rate-${r.id}-${i}`).value.trim())); });
      const freeOver = Number($('#s-free').value.trim());
      const maxQty = Number($('#s-max').value.trim());
      const news = { show: $('#s-news-show').checked, text: $('#s-news-text').value.trim(), link: $('#s-news-link').value };
      const ok = await commit((cat) => {
        cat.settings.ship = { rates, freeOver };
        cat.settings.maxQty = maxQty;
        cat.settings.news = news;
      }, '設定を保存しました', SHOP_LINK, {
        conflict: (latest) => (settingsKey(latest) === base ? null
          : { title: '設定が先に変更されていました', body: 'ほかの画面（または別の方）が、送料やお知らせなどの設定を先に保存していました。入力した内容で上書きして保存しますか？', ok: '上書きして保存する' }),
      });
      if (ok && currentRoute === 'settings') { formDirty = false; renderSettings(); focusAfter('#setForm [type=submit]'); }
    });
  }

  /* =========================================================
     Data
     ========================================================= */
  // live: import / reset replace everything, so a conflict always asks
  const replaceConflict = () => ({ title: 'ほかの画面で先に保存されていました', body: 'この操作の前に、ほかの画面（または注文による在庫の変動）で商品データが更新されていました。それでも、いまの内容をすべて置き換えますか？', ok: '置き換える', danger: true });
  function renderData() {
    const c = S.catalog();
    let bytes = 0;
    if (!LIVE) {
      try { for (const k of Object.values(S.KEYS)) bytes += (localStorage.getItem(k) || '').length * 2; } catch { /* ignore */ }
    }
    const limit = 5 * 1024 * 1024;
    const pct = Math.min(100, Math.round((bytes / limit) * 100));
    main.innerHTML = `
      ${head('データ管理')}
      <section class="adm-card">
        <h2>いまの状態</h2>
        ${LIVE ? `
        <p>商品・カテゴリ・設定は、サーバーに保存されています（商品${c.products.length}件・カテゴリ${c.categories.length}件）。保存した内容は、すぐにショップに反映されます。</p>` : `
        <p>${S.isCustomized() ? '商品や設定が編集されています。' : '最初に用意した商品データのままです。'}　注文データ：${S.orders().length}件</p>
        <div class="adm-meter" aria-hidden="true"><i style="width:${pct}%"></i></div>
        <p class="adm-faint">ブラウザの保存領域の使用量：約${(bytes / 1024 / 1024).toFixed(2)}MB（目安の上限 5MB）。写真をたくさんアップロードすると増えます。</p>`}
      </section>
      <section class="adm-card">
        <h2>バックアップと復元</h2>
        <div class="adm-actions-list">
          <div class="adm-action"><div><h3>データを書き出す</h3><p>${LIVE ? '商品・カテゴリ・設定をファイル（JSON）に保存します。念のためのバックアップとして、ときどき書き出しておくと安心です。' : '商品・カテゴリ・設定をファイル（JSON）に保存します。別のパソコンやブラウザに移すときに使います。'}</p></div><button class="adm-btn" type="button" id="exportBtn">書き出す</button></div>
          <div class="adm-action"><div><h3>データを読み込む</h3><p>書き出したファイルを読み込んで、いまの商品・カテゴリ・設定と置き換えます。${LIVE ? 'ショップにもすぐに反映されます。' : ''}</p></div><span class="adm-upload"><input type="file" accept="application/json,.json" id="importFile" aria-label="書き出したデータファイルを選んで読み込む"><span class="adm-btn">ファイルを選ぶ</span></span></div>
        </div>
      </section>
      <section class="adm-card">
        <h2>リセット</h2>
        <div class="adm-actions-list">
          <div class="adm-action"><div><h3>商品データを最初の状態に戻す</h3><p>追加・編集した商品、カテゴリ、設定をすべて取り消して、最初に用意した商品データに戻します。${LIVE ? 'ショップにもすぐに反映されます。' : ''}</p></div><button class="adm-btn adm-btn--danger" type="button" id="resetBtn">最初の状態に戻す</button></div>
          ${LIVE ? '' : `<div class="adm-action"><div><h3>注文データを消す</h3><p>注文一覧に表示されている試しの注文をすべて消します。</p></div><button class="adm-btn adm-btn--danger" type="button" id="clearOrdersBtn" ${S.orders().length ? '' : 'disabled'}>注文データを消す</button></div>`}
        </div>
      </section>
      ${LIVE ? '' : `
      <section class="adm-card">
        <h2>本番運用にするには</h2>
        <p class="adm-muted">このデモでは、データの保存先がこのブラウザの中です。本番では保存先をサーバーのデータベースにつなぎ替えることで、管理画面で保存した内容が、すべてのお客さまのショップに反映されるようになります（ログイン機能、決済サービスとの連携もあわせて追加します）。</p>
      </section>`}`;
    $('#exportBtn').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (b.getAttribute('aria-disabled') === 'true') return;
      if (saving) { announce('保存しています。少しお待ちください。'); return; }
      let data = S.catalog();
      if (LIVE) {
        // live: stock changes with every order, so the file gets the server's latest copy
        b.setAttribute('aria-disabled', 'true');
        announce('最新のデータを読み込んでいます…');
        const got = await loadCatalog({ force: true });
        b.removeAttribute('aria-disabled');
        if (!got) {
          const err = catalogLoad.error;
          toast(err && err.status === 401 ? errText(err, '書き出せませんでした') : `書き出せませんでした。${errText(err)}`, { error: true });
          return;
        }
        data = Number(got.rev) >= Number(S.rev()) ? S.normalize(got.catalog) : S.catalog();
      }
      const d = new Date();
      const name = `mangetsu-catalog-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`「${name}」を書き出しました`);
    });
    $('#importFile').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch { toast('このファイルは読み込めませんでした（JSON形式ではありません）。', { error: true }); return; }
      if (!data || !Array.isArray(data.products) || !Array.isArray(data.categories)) { toast('満月米の管理画面で書き出したファイルを選んでください。', { error: true }); return; }
      const ok = await confirmDialog({ title: 'データを読み込みますか？', body: `商品${data.products.length}件・カテゴリ${data.categories.length}件のデータで、いまの内容を置き換えます。${LIVE ? '<br>在庫数もファイルの内容になります。書き出したあとに注文があった場合は、読み込んだあとで在庫数を確かめてください。' : ''}`, ok: '読み込む' });
      if (!ok) return;
      const next = S.normalize(data);
      if (await commit(() => clone(next), 'データを読み込みました', SHOP_LINK, { conflict: replaceConflict }) && currentRoute === 'data') { renderData(); focusAfter('#importFile'); }
    });
    $('#resetBtn').addEventListener('click', async () => {
      const ok = await confirmDialog({ title: '最初の状態に戻しますか？', body: `追加・編集した商品、カテゴリ、設定がすべて消えます。${LIVE ? 'ショップにもすぐに反映され、在庫数も最初の状態（管理しない）に戻ります。' : ''}必要なら先に「書き出す」で保存してください。`, ok: '最初の状態に戻す', danger: true });
      if (!ok) return;
      if (LIVE) {
        if (await commit(() => clone(S.DEFAULT_CATALOG), '最初の状態に戻しました', null, { conflict: replaceConflict }) && currentRoute === 'data') { renderData(); focusAfter('#resetBtn'); }
        return;
      }
      S.resetCatalog();
      toast('最初の状態に戻しました');
      renderData(); focusAfter('#resetBtn');
    });
    if ($('#clearOrdersBtn')) $('#clearOrdersBtn').addEventListener('click', async () => {
      const ok = await confirmDialog({ title: '注文データを消しますか？', body: `${S.orders().length}件の注文をすべて消します。元に戻すことはできません。`, ok: '消す', danger: true });
      if (!ok) return;
      S.clearOrders(); updateNavCounts(); toast('注文データを消しました'); renderData(); focusAfter('#clearOrdersBtn');
    });
  }

  /* =========================================================
     Router
     ========================================================= */
  const ROUTES = { dashboard: renderDashboard, products: renderProducts, categories: renderCategories, orders: renderOrders, event: renderEventAdmin, settings: renderSettings, data: renderData };
  const TITLES = { dashboard: 'ダッシュボード', products: '商品', categories: 'カテゴリ', orders: '注文', event: 'イベントページ', settings: 'ショップ設定', data: 'データ管理' };
  let currentRoute = null;
  let formDirty = false; // unsaved typing in 設定 / カテゴリを追加
  const routeId = () => { try { return decodeURIComponent(location.hash.slice(1)).split('?')[0] || 'dashboard'; } catch { return 'dashboard'; } };

  function renderRoute() {
    if (locked) return;
    formDirty = false;
    const id = routeId();
    const section = id.startsWith('product-') ? 'products' : (ROUTES[id] ? id : 'dashboard');
    if (id.startsWith('product-')) {
      renderEditor(id.slice(8));
      document.title = `${id === 'product-new' ? '商品を追加' : '商品を編集'}｜管理画面｜満月米`;
    } else {
      draft = null;
      (ROUTES[id] || renderDashboard)();
      document.title = `${TITLES[section]}｜管理画面｜満月米`;
    }
    $$('.adm-nav a').forEach((a) => { if (a.dataset.nav === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const cur = $('.adm-nav a[aria-current="page"]');
    if (cur && matchMedia('(max-width: 900px)').matches) cur.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' });
    currentRoute = id;
    // live: the screens that show products or settings read them again when the copy is old
    if (LIVE && id !== 'orders') loadCatalog();
  }
  const confirmLeave = () => confirmDialog({ title: '保存していない変更があります', body: 'このまま移動すると、変更は失われます。', ok: '保存せずに移動する', cancel: '編集を続ける' });
  const hasUnsaved = () => (dirty && draft) || formDirty;
  // ask before the URL changes for in-app links
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.classList.contains('skip-link') || a.closest('#admModal') || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
    // live: stay on the screen until its save has finished
    if (saving) { e.preventDefault(); announce('保存しています。少しお待ちください。'); return; }
    if (!hasUnsaved()) return;
    e.preventDefault();
    if (await confirmLeave()) { dirty = false; formDirty = false; location.hash = a.getAttribute('href'); }
  }, true);
  let skipHash = false;
  async function onHashChange() {
    if (locked) return;
    if (skipHash) { skipHash = false; return; }
    // Back / Forward with unsaved input: undo the step instead of pushing a new entry
    if (hasUnsaved() && !(await confirmLeave())) { skipHash = true; history.go(1); return; }
    dirty = false; formDirty = false;
    renderRoute();
    window.scrollTo({ top: 0, behavior: 'instant' });
    const h = $('[data-focus]', main);
    if (h) h.focus({ preventScroll: true });
  }

  /* ---------- events ---------- */
  main.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) { e.preventDefault(); listState.status = f.dataset.filter; location.hash = 'products'; return; }
    const sf = e.target.closest('[data-src-filter]');
    if (sf) { e.preventDefault(); orderState.src = sf.dataset.srcFilter; orderState.status = ''; orderState.payment = 'paid'; location.hash = 'orders'; return; }
    if (currentRoute === 'products') productAction(e);
    else if (currentRoute === 'categories') categoryAction(e);
    else if (currentRoute === 'orders') orderAction(e);
    else if (draft) editorClick(e);
  });
  main.addEventListener('change', (e) => {
    if (currentRoute === 'products') productChange(e);
    else if (currentRoute === 'categories') categoryRename(e);
    else if (currentRoute === 'orders') orderChange(e);
    else if (draft) { if (e.target.type === 'file') editorFile(e); else editorInput(e); }
  });
  main.addEventListener('input', (e) => { if (draft && e.target.type !== 'file' && e.target.type !== 'radio' && e.target.tagName !== 'SELECT' && e.target.type !== 'checkbox') editorInput(e); });
  // match by selector: the form has a field named "id", which shadows form.id
  main.addEventListener('submit', (e) => { if (e.target.matches('#edForm')) saveDraft(e); });
  main.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-cname]')) { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && draft && $('#edForm') && $('#admModal').hidden && !$('#admLogin:not([hidden])')) { e.preventDefault(); if (!saving) $('#edForm').requestSubmit(); }
  });
  window.addEventListener('beforeunload', (e) => { if (hasUnsaved() || saving || uploadsFor(draft) || evUploading()) { e.preventDefault(); e.returnValue = ''; } });
  // live: back to this tab after a while — read the catalog again (stock may have been sold)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && LIVE && !locked && currentRoute && currentRoute !== 'orders') loadCatalog(); });
  // password fields (login screen and the login dialog)
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-pw-toggle]'); if (b) togglePassword(b); });
  $('#logoutBtn').addEventListener('click', logout);
  main.addEventListener('input', (e) => { if (e.target.closest('#setForm, #catAdd, #evForm')) formDirty = true; });
  main.addEventListener('change', (e) => { if (e.target.closest('#setForm, #catAdd, #evForm')) formDirty = true; });
  $('.skip-link').addEventListener('click', (e) => { e.preventDefault(); main.focus(); });
  window.addEventListener('hashchange', onHashChange);

  // orders placed / catalog edited in another tab (demo only: live data is on the server)
  S.onChange((key) => {
    if (LIVE) return;
    updateNavCounts();
    if (key === S.KEYS.cart) return;   // the shop's cart never changes admin screens
    if (draft || formDirty) return;    // never re-render over unsaved input
    const y = window.scrollY;
    renderRoute();
    window.scrollTo({ top: y, behavior: 'instant' });
  });

  boot();
})();
