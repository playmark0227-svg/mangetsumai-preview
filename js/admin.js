/* =========================================================
   満月米 管理画面（デモ） — admin.js
   画面：#dashboard / #products / #product-new / #product-<id>
        #categories / #orders / #settings / #data
   データは store.js（このブラウザの localStorage）に保存。
   ショップを別タブで開いていれば、保存と同時に反映される。
   ========================================================= */
(() => {
  'use strict';

  const S = window.MangetsuStore;
  const U = window.MangetsuUI;
  const { esc, yen } = U;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const main = $('#admMain');
  const clone = S.clone;

  const STATUS = { published: '公開中', draft: '非公開', soldout: '売り切れ' };
  const ORDER_STATUS = { new: '新規', preparing: '発送準備中', shipped: '発送済み', canceled: 'キャンセル' };
  const BAG_STYLES = { single: '1袋', double: '2袋セット', seal: '新米シール付き', phases: '定期便（月の満ち欠け）', plain: '無地の紙袋（玄米など）' };
  const BUILTIN_IMAGES = [
    { src: 'assets/img/bowl.webp', alt: '茶碗に盛った炊きたてのごはん', fit: 'contain' },
    { src: 'assets/img/rice-hand-sm.webp', alt: '手のひらにすくった精米', fit: 'cover' },
    { src: 'assets/img/moon-sm.webp', alt: '満月', fit: 'contain' },
    { src: 'assets/img/medal.webp', alt: '米-1グランプリ in らんこし 2025 金賞受賞メダル', fit: 'contain' },
    { src: 'assets/img/photo/grains.webp', alt: '枡からこぼれる精米（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/onigiri.webp', alt: 'おにぎり（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/teishoku.webp', alt: '和食の食卓（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/gohan.webp', alt: '土鍋で炊いたごはん（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/ears-moon.webp', alt: '月あかりに実る稲穂（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/moon-paddy.webp', alt: '満月と実りの田んぼ（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/summer.webp', alt: '夏の夕暮れの田んぼ（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/winter.webp', alt: '冬の夜の雪原（イメージ）', fit: 'cover' },
    { src: 'assets/img/photo/spring.webp', alt: '山の湧き水（イメージ）', fit: 'cover' },
  ];
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

  function save(catalog, okMsg, link = { href: '../shop.html', text: 'ショップで確認' }) {
    const r = S.saveCatalog(catalog);
    if (!r.ok) { toast(r.error, { error: true }); return false; }
    if (okMsg) toast(okMsg, link ? { link } : {});
    updateNavCounts();
    return true;
  }
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
  const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const catName = (id) => { const c = S.category(id); return c ? c.name : '未分類'; };

  function updateNavCounts() {
    const n = S.orders().filter((o) => o.status === 'new').length;
    const el = $('#navOrderCount');
    el.hidden = !n;
    el.textContent = n;
    el.setAttribute('aria-label', `新規 ${n}件`);
  }

  /* =========================================================
     Dashboard
     ========================================================= */
  function renderDashboard() {
    const c = S.catalog();
    const ps = c.products;
    const orders = S.orders();
    const lowStock = ps.filter((p) => p.variants.some((v) => v.stock !== null && v.stock <= 5));
    const count = (st) => ps.filter((p) => p.status === st).length;
    main.innerHTML = `
      ${head('ダッシュボード', { actions: `<a class="btn btn--gold btn--sm" href="#product-new">${ICON.plus}商品を追加</a>` })}
      <dl class="adm-stats">
        <div class="adm-stat"><dt>公開中の商品</dt><dd>${count('published')}<small>件</small></dd><a href="#products">商品一覧へ</a></div>
        <div class="adm-stat"><dt>非公開の商品</dt><dd>${count('draft')}<small>件</small></dd><a href="#products?status=draft" data-filter="draft">見る</a></div>
        <div class="adm-stat"><dt>売り切れ</dt><dd>${ps.filter((p) => S.productSoldOut(p)).length}<small>件</small></dd><a href="#products" data-filter="soldout">見る</a></div>
        <div class="adm-stat"><dt>新規の注文</dt><dd>${orders.filter((o) => o.status === 'new').length}<small>件／全${orders.length}件</small></dd><a href="#orders">注文一覧へ</a></div>
      </dl>
      <div class="adm-grid2">
        <section class="adm-card">
          <div class="adm-card__head"><h2>最近の注文</h2><a class="adm-muted" href="#orders">すべて見る</a></div>
          ${orders.length ? `
          <div class="adm-table-wrap" style="box-shadow:none;background:none">
            <table class="adm-table"><thead><tr><th>注文番号</th><th>日時</th><th>お客様</th><th class="adm-num">合計</th><th>状態</th></tr></thead><tbody>
              ${orders.slice(0, 5).map((o) => `<tr><td class="nowrap">${esc(o.no)}</td><td class="nowrap">${fmtDate(o.at)}</td><td>${esc((o.customer || {}).name || '')}</td><td class="adm-num">¥${yen(o.total)}</td><td><span class="pill pill--${esc(o.status)}">${ORDER_STATUS[o.status] || ''}</span></td></tr>`).join('')}
            </tbody></table>
          </div>` : `<p class="adm-muted">まだ注文はありません。ショップで試しに注文すると、ここに表示されます。</p>`}
        </section>
        <div>
          <section class="adm-card">
            <h2>在庫が少ない商品</h2>
            ${lowStock.length ? `<ul class="adm-checks">${lowStock.map((p) => `<li class="adm-prod">${thumb(p)}<span class="adm-prod__name"><a href="#product-${esc(p.id)}">${esc(p.name)}</a><small>${p.variants.filter((v) => v.stock !== null && v.stock <= 5).map((v) => `${esc(v.label)} 残り${v.stock}`).join('／')}</small></span></li>`).join('')}</ul>`
              : '<p class="adm-muted">在庫が5点以下の商品はありません（在庫を管理している商品のみ表示）。</p>'}
          </section>
          <section class="adm-card">
            <h2>イベントページ</h2>
            ${(() => { const e = c.settings.event; const on = S.eventActive(e); return `<p><span class="pill pill--${on ? 'published' : 'draft'}">${on ? '公開中' : '公開していません'}</span>　${esc(e.title)}</p><p class="adm-muted" style="margin-top:6px">イベントからの注文：${orders.filter((o) => o.source === e.slug).length}件　<a class="link" href="#event">QRコード・設定</a></p>`; })()}
          </section>
          <section class="adm-card">
            <h2>このデモの使い方</h2>
            <ol class="adm-howto">
              <li><b>1</b><span>「商品」で、商品を追加・編集して保存します。</span></li>
              <li><b>2</b><span><a class="link" href="../shop.html" target="_blank" rel="noopener">ショップ</a>を別のタブで開いておくと、保存した内容がすぐに反映されます。</span></li>
              <li><b>3</b><span>ショップで注文すると、「注文」に届きます。状態を「発送済み」などに変えて管理できます。</span></li>
            </ol>
            <p class="adm-faint" style="margin-top:12px">デモ版のため、データはこのブラウザの中にだけ保存されます。ほかの人の画面には反映されません。</p>
          </section>
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
                <td class="cell-prod"><div class="adm-prod">${thumb(p)}<span class="adm-prod__name"><a href="#product-${esc(p.id)}">${esc(p.name)}</a><small>ID：${esc(p.id)}${p.meta ? `　${esc(p.meta)}` : ''}</small></span></div></td>
                <td data-label="カテゴリ">${esc(catName(p.category))}</td>
                <td class="adm-num" data-label="価格">${priceRange(p)}${p.options.subscription ? '<span class="adm-faint">／回</span>' : ''}</td>
                <td data-label="在庫">${stockText(p)}</td>
                <td data-label="状態">
                  <label class="visually-hidden" for="st-${esc(p.id)}">${esc(p.name)}の状態</label>
                  <select class="select adm-status-select" id="st-${esc(p.id)}" data-status-of="${esc(p.id)}" data-status="${p.status}">
                    ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v}</option>`).join('')}
                  </select>
                </td>
                <td data-label="トップ"><button class="adm-star" type="button" data-feature="${esc(p.id)}" aria-pressed="${p.featured}" aria-label="${esc(p.name)}をトップページに表示">${ICON.star}</button></td>
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
    const mv = e.target.closest('[data-move]');
    if (mv) {
      if (mv.getAttribute('aria-disabled') === 'true') return;
      const id = mv.closest('tr').dataset.id;
      const c = clone(S.catalog());
      const i = c.products.findIndex((p) => p.id === id);
      const j = i + Number(mv.dataset.move);
      if (i < 0 || j < 0 || j >= c.products.length) return;
      [c.products[i], c.products[j]] = [c.products[j], c.products[i]];
      if (save(c)) {
        renderProducts();
        const again = $(`tr[data-id="${CSS.escape(id)}"] [data-move="${mv.dataset.move}"]`);
        (again && again.getAttribute('aria-disabled') !== 'true' ? again : $(`tr[data-id="${CSS.escape(id)}"] a`)).focus();
        announce('並び順を変更しました');
      }
      return;
    }
    const star = e.target.closest('[data-feature]');
    if (star) {
      const c = clone(S.catalog());
      const p = c.products.find((x) => x.id === star.dataset.feature);
      p.featured = !p.featured;
      if (p.featured && c.products.filter((x) => x.featured).length > 4) toast('トップページには、★の付いた商品のうち並び順の上から4件が表示されます。');
      if (save(c)) { renderProducts(); $(`[data-feature="${CSS.escape(p.id)}"]`).focus(); announce(p.featured ? 'トップページに表示します' : 'トップページに表示しません'); }
      return;
    }
    const dup = e.target.closest('[data-dup]');
    if (dup) {
      const c = clone(S.catalog());
      const src = c.products.find((x) => x.id === dup.dataset.dup);
      const copy = clone(src);
      const base = src.id.slice(0, 33);
      let n = 2; copy.id = `${base}-copy`;
      while (c.products.some((x) => x.id === copy.id)) copy.id = `${base}-copy${n++}`;
      copy.name = `${src.name}（コピー）`;
      copy.status = 'draft';
      copy.featured = false;
      c.products.splice(c.products.indexOf(src) + 1, 0, copy);
      if (save(c, '複製しました（非公開の状態です）', null)) location.hash = `product-${copy.id}`;
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const p = S.product(del.dataset.del);
      const ok = await confirmDialog({ title: '商品を削除しますか？', body: `「${esc(p.name)}」を削除します。元に戻すことはできません。<br>一時的に隠したいときは、状態を「非公開」にしてください。`, ok: '削除する', danger: true });
      if (!ok) return;
      const c = clone(S.catalog());
      c.products = c.products.filter((x) => x.id !== p.id);
      if (save(c, '削除しました', null)) { renderRoute(); focusAfter(); }
    }
  }
  function productChange(e) {
    const sel = e.target.closest('[data-status-of]');
    if (!sel) return;
    const c = clone(S.catalog());
    const p = c.products.find((x) => x.id === sel.dataset.statusOf);
    p.status = sel.value;
    if (save(c)) { renderProducts(); const again = $(`#st-${CSS.escape(p.id)}`); if (again) again.focus(); toast(`「${p.name}」を${STATUS[p.status]}にしました`); }
    else sel.value = sel.dataset.status;
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
    meta: '', badge: { text: '', line: true }, card: '', when: '3〜5営業日で発送', lead: '', ship: 'ご注文から3〜5営業日で発送します',
    visual: { kind: 'image', src: '', fit: 'cover' }, gallery: [],
    variants: [{ id: 'v1', label: '', price: '', stock: null }],
    options: { gift: false, award: false, preorder: false, subscription: false, traits: false },
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
              <label class="adm-check adm-field--full"><input type="checkbox" name="featured" ${draft.featured ? 'checked' : ''}><span>トップページの「満月米をお届けします」に表示する<small>★の付いた商品のうち、並び順の上から4件が表示されます</small></span></label>
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
                <input class="input" id="f-meta" name="meta" value="${esc(draft.meta)}" maxlength="30" placeholder="例：令和7年産・精米">
              </div>
              <div class="adm-field">
                <label for="f-when">発送時期（一覧用の短い文）</label>
                <input class="input" id="f-when" name="when" value="${esc(draft.when)}" maxlength="30" placeholder="例：3〜5営業日で発送">
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
                <input class="input" id="f-ship" name="ship" value="${esc(draft.ship)}" maxlength="60" placeholder="例：ご注文から3〜5営業日で発送します">
              </div>
            </div>
          </section>

          <section class="adm-sec" aria-labelledby="sec5">
            <h2 id="sec5">オプション</h2>
            <div class="adm-checks">
              <label class="adm-check"><input type="checkbox" name="options.preorder" ${draft.options.preorder ? 'checked' : ''}><span>予約商品として扱う<small>カートと購入手続きで、発送時期の案内が出ます。日付指定はできなくなります。</small></span></label>
              <label class="adm-check"><input type="checkbox" name="options.subscription" ${draft.options.subscription ? 'checked' : ''}><span>定期便として扱う<small>価格に「／1回」が付き、確認画面に定期便の案内が出ます。</small></span></label>
              <label class="adm-check"><input type="checkbox" name="options.award" ${draft.options.award ? 'checked' : ''}><span>金賞メダルを表示する<small>米-1グランプリ in らんこし 2025 で金賞を受賞したお米（令和7年産）にだけ付けてください。</small></span></label>
              <label class="adm-check"><input type="checkbox" name="options.traits" ${draft.options.traits ? 'checked' : ''}><span>「ななつぼしの特徴」を表示する（満月米の商品）</span></label>
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
    if (isNew) $('#f-name').focus();
  }

  const markDirty = () => {
    dirty = true;
    const s = $('#saveState');
    if (s) { s.textContent = '保存されていない変更があります'; s.classList.add('is-dirty'); }
    renderPreview();
  };
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
        <div class="adm-field"><label for="v-stock-${i}">在庫（空欄＝管理しない）</label><input class="input input--num" id="v-stock-${i}" data-vf="stock" type="number" min="0" step="1" inputmode="numeric" value="${v.stock === null ? '' : v.stock}" placeholder="—"></div>
        <div class="adm-row__tools">
          <button class="adm-btn adm-btn--icon adm-btn--quiet" type="button" data-vmove="-1" aria-label="種類${i + 1}を上へ" ${i === 0 ? 'aria-disabled="true"' : ''}>${ICON.up}</button>
          <button class="adm-btn adm-btn--icon adm-btn--quiet" type="button" data-vmove="1" aria-label="種類${i + 1}を下へ" ${i === draft.variants.length - 1 ? 'aria-disabled="true"' : ''}>${ICON.down}</button>
          <button class="adm-btn adm-btn--icon adm-btn--danger" type="button" data-vdel aria-label="種類${i + 1}を削除" ${draft.variants.length === 1 ? 'aria-disabled="true"' : ''}>${ICON.del}</button>
        </div>
      </div>`).join('') + '<p class="adm-error" id="v-err" hidden></p>';
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
            <div class="adm-builtins">${BUILTIN_IMAGES.map((b, i) => `<button class="adm-builtin" type="button" data-main-builtin="${i}" aria-label="${esc(b.alt)}を使う"><img class="visual-img is-${b.fit}" src="${U.asset(b.src)}" alt=""></button>`).join('')}</div>
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
          <div class="adm-gitem__img"><img class="visual-img is-${g.fit === 'contain' ? 'contain' : 'cover'}" src="${esc(U.asset(g.src))}" alt=""></div>
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
        ${BUILTIN_IMAGES.map((b, i) => `<button class="adm-builtin" type="button" data-gal-builtin="${i}" aria-label="${esc(b.alt)}を追加" style="width:44px;height:44px"><img class="visual-img is-${b.fit}" src="${U.asset(b.src)}" alt=""></button>`).join('')}
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
    if (!draft || !el.closest('#edForm')) return;
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
      }
    }
    const vr = el.closest('[data-vi]');
    if (vr && el.dataset.vf) {
      const v = draft.variants[+vr.dataset.vi];
      if (el.dataset.vf === 'label') v.label = el.value;
      if (el.dataset.vf === 'price') v.price = el.value.trim();
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
    const refocus = (sel) => { const el = $(sel); if (el) el.focus(); };
    if (t.hasAttribute('data-add-variant')) {
      let id; do { id = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`; } while (draft.variants.some((v) => v.id === id));
      draft.variants.push({ id, label: '', price: draft.variants[draft.variants.length - 1].price ?? '', stock: null });
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
      draft.gallery.push({ ...b });
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
      const c = clone(S.catalog());
      c.products = c.products.filter((x) => x.id !== originalId);
      if (save(c, '削除しました')) { dirty = false; location.hash = 'products'; }
    }
  }
  async function editorFile(e) {
    const el = e.target;
    if (!draft || el.type !== 'file') return;
    const files = Array.from(el.files || []);
    if (!files.length) return;
    try {
      if (el.id === 'mainUpload') {
        const src = await shrinkImage(files[0]);
        draft.visual = { kind: 'image', src, fit: draft.visual.fit || 'cover' };
        renderVisual(); markDirty(); $('#mainUpload').focus();
      } else if (el.id === 'galleryUpload') {
        const res = await Promise.allSettled(files.slice(0, 6).map((f) => shrinkImage(f)));
        const ok = res.filter((r) => r.status === 'fulfilled');
        ok.forEach((r) => draft.gallery.push({ src: r.value, alt: '', fit: 'cover' }));
        renderGallery(); if (ok.length) markDirty(); $('#galleryUpload').focus();
        const bad = res.length - ok.length, over = Math.max(0, files.length - 6);
        if (bad || over) toast(`${bad ? `${bad}枚は読み込めませんでした（HEICなどはJPEGにしてから選んでください）。` : ''}${over ? '一度に追加できる写真は6枚までです。' : ''}`, { error: true });
      }
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  function showErr(id, msg, field) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg; el.hidden = !msg;
    const f = field && $(field);
    if (!f) return;
    if (msg) f.setAttribute('aria-invalid', 'true'); else f.removeAttribute('aria-invalid');
    const ids = new Set((f.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
    if (msg) ids.add(id); else ids.delete(id);
    if (ids.size) f.setAttribute('aria-describedby', [...ids].join(' ')); else f.removeAttribute('aria-describedby');
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
    const needLabel = (v) => draft.variants.length > 1 && !String(v.label).trim();
    $$('#variantRows [aria-invalid]').forEach((x) => { x.removeAttribute('aria-invalid'); x.removeAttribute('aria-describedby'); });
    const badVar = draft.variants.findIndex((v) => needLabel(v) || badPrice(v) || badStock(v));
    const bv = draft.variants[badVar];
    const fld = badVar < 0 ? '' : needLabel(bv) ? 'label' : badPrice(bv) ? 'price' : 'stock';
    const VMSG = { label: '名前を入力してください', price: '価格を整数で入力してください（公開する商品は1円以上）', stock: '在庫は0以上の整数で入力するか、空欄にしてください' };
    showErr('v-err', badVar < 0 ? '' : `${draft.variants.length > 1 ? `種類${badVar + 1}の` : ''}${VMSG[fld]}。`, badVar >= 0 ? `#v-${fld}-${badVar}` : null);
    if (badVar >= 0) errs.push(`#v-${fld}-${badVar}`);
    if (draft.visual.kind === 'image' && !draft.visual.src) {
      showErr('v-img-err', '写真をアップロードするか、サイト内の写真を選んでください。', '#mainUpload');
      errs.push('#mainUpload');
    } else showErr('v-img-err', '', '#mainUpload');
    return errs;
  }
  async function saveDraft(e) {
    e.preventDefault();
    const errs = validateDraft();
    if (errs.length) {
      const first = $(errs[0]);
      if (first) first.focus();
      toast(`入力内容を確認してください（${errs.length}か所）`, { error: true });
      return;
    }
    // another tab changed or deleted this product while it was open
    if (originalId && baseJSON) {
      const live = S.product(originalId);
      const strip = (x) => JSON.stringify({ ...x, variants: x.variants.map(({ stock, ...v }) => v) });
      if (!live || strip(live) !== strip(JSON.parse(baseJSON))) {
        const ok = await confirmDialog({ title: 'ほかの画面で変更されています', body: live ? 'この商品は別のタブで変更されました。保存すると、その変更を上書きします。' : 'この商品は別のタブで削除されました。保存すると、もう一度追加されます。', ok: '上書きして保存' });
        if (!ok) return;
      }
    }
    draft.id = draft.id.trim();
    draft.name = draft.name.trim();
    draft.variants.forEach((v, i) => {
      v.price = Number(v.price);
      v.stock = v.stock === null ? null : Number(v.stock);
      if (!String(v.label).trim()) v.label = draft.variants.length > 1 ? `種類${i + 1}` : '通常';
    });
    draft.specs = draft.specs.filter((r) => r[0].trim() || r[1].trim());
    const c = clone(S.catalog());
    const i = originalId ? c.products.findIndex((p) => p.id === originalId) : -1;
    if (i >= 0) {
      const live = c.products[i];
      // keep stock sold in the shop while the editor was open, unless the owner changed that field
      draft.variants.forEach((v) => {
        const lv = live.variants.find((x) => x.id === v.id);
        if (lv && openedStock.has(v.id) && openedStock.get(v.id) === v.stock) v.stock = lv.stock;
      });
      c.products[i] = draft;
    } else c.products.push(draft);
    if (originalId && originalId !== draft.id && c.settings.news.link === originalId) c.settings.news.link = draft.id;
    const wasNew = !originalId;
    const hidden = draft.status === 'draft';
    const msg = hidden ? `${wasNew ? '追加' : '保存'}しました（非公開のため、ショップには表示されません）` : (wasNew ? '商品を追加しました' : '保存しました');
    if (!save(c, msg, hidden ? null : { href: `../shop.html#item-${draft.id}`, text: 'ショップで確認' })) return;
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
    $('#catAdd').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#nc-name').value.trim();
      let id = $('#nc-id').value.trim();
      const cat = clone(S.catalog());
      let msg = '';
      if (!name) msg = 'カテゴリ名を入力してください。';
      else if (id && !/^[a-z0-9][a-z0-9-]{0,29}$/.test(id)) msg = 'IDは半角英小文字・数字・ハイフンで入力してください。';
      else if (id && cat.categories.some((k) => k.id === id)) msg = 'このIDはすでに使われています。';
      showErr('nc-err', msg);
      if (msg) { $(name ? '#nc-id' : '#nc-name').focus(); return; }
      if (!id) { let n = cat.categories.length + 1; id = `cat-${n}`; while (cat.categories.some((k) => k.id === id)) id = `cat-${++n}`; }
      cat.categories.push({ id, name });
      if (save(cat, `「${name}」を追加しました`)) { formDirty = false; renderCategories(); $('#nc-name').focus(); }
    });
  }
  async function categoryAction(e) {
    const tr = e.target.closest('[data-cid]');
    if (!tr) return;
    const b = e.target.closest('button');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    const c = clone(S.catalog());
    const i = c.categories.findIndex((k) => k.id === tr.dataset.cid);
    if (b.dataset.cmove) {
      if (!moveIn(c.categories, i, +b.dataset.cmove)) return;
      if (save(c)) { renderCategories(); const again = $(`[data-cid="${CSS.escape(tr.dataset.cid)}"] [data-cmove="${b.dataset.cmove}"]`); if (again) again.focus(); }
      return;
    }
    if (b.hasAttribute('data-cdel')) {
      const k = c.categories[i];
      const n = c.products.filter((p) => p.category === k.id).length;
      const ok = await confirmDialog({ title: 'カテゴリを削除しますか？', body: `「${esc(k.name)}」を削除します。${n ? `このカテゴリの商品${n}件は「未分類」になります（商品は削除されません）。` : ''}`, ok: '削除する', danger: true });
      if (!ok) return;
      c.categories.splice(i, 1);
      c.products.forEach((p) => { if (p.category === k.id) p.category = ''; });
      if (save(c, '削除しました')) { renderCategories(); focusAfter('#nc-name'); }
    }
  }
  function categoryRename(e) {
    const inp = e.target.closest('[data-cname]');
    if (!inp) return;
    const name = inp.value.trim();
    const c = clone(S.catalog());
    const k = c.categories.find((x) => x.id === inp.closest('[data-cid]').dataset.cid);
    if (!name) { inp.value = k.name; toast('カテゴリ名は空にできません。', { error: true }); return; }
    if (name === k.name) return;
    k.name = name;
    if (!save(c, `カテゴリ名を「${name}」にしました`)) { inp.value = S.category(k.id).name; return; }
    const tr = inp.closest('[data-cid]');
    tr.querySelector('[data-cmove="-1"]').setAttribute('aria-label', `${name}を上へ`);
    tr.querySelector('[data-cmove="1"]').setAttribute('aria-label', `${name}を下へ`);
    tr.querySelector('[data-cdel]').setAttribute('aria-label', `${name}を削除`);
  }

  /* =========================================================
     Orders
     ========================================================= */
  const orderState = { status: '', src: '', open: null };
  function renderOrders() {
    const all = S.orders();
    const sources = [...new Set(all.map((o) => o.source).filter(Boolean))];
    // drop a source filter that no longer matches any order (the select would be hidden)
    if (!sources.length || (orderState.src && orderState.src !== '__shop' && !sources.includes(orderState.src))) orderState.src = '';
    const list = all.filter((o) => (!orderState.status || o.status === orderState.status)
      && (!orderState.src || (orderState.src === '__shop' ? !o.source : o.source === orderState.src)));
    main.innerHTML = `
      ${head('注文', { lead: 'ショップで確定した注文が届きます（デモのため、このブラウザで行った注文だけが表示されます）。状態を変えて、発送の進み具合を管理できます。' })}
      <div class="adm-toolbar">
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
      </div>
      ${list.length ? `
      <div class="adm-table-wrap">
        <table class="adm-table adm-table--orders">
          <thead><tr><th>注文番号</th><th>日時</th><th>お客様</th><th>商品</th><th class="adm-num">合計</th><th>お支払い</th><th>状態</th></tr></thead>
          <tbody>
            ${list.map((o) => { const cu = o.customer || {}; const items = Array.isArray(o.items) ? o.items : []; const vtxt = (it) => (it.variant && it.variant !== '通常' && !String(it.name).includes(it.variant) ? ` ${esc(it.variant)}` : ''); return `
              <tr>
                <td class="nowrap"><button class="adm-toggle" type="button" data-open="${esc(o.no)}" aria-expanded="${orderState.open === o.no}" aria-controls="od-${esc(o.no)}">${esc(o.no)}</button></td>
                <td class="nowrap" data-label="日時">${fmtDate(o.at)}</td>
                <td data-label="お客様">${esc(cu.name || '')}${o.shipTo ? '<br><span class="adm-faint">別住所へお届け</span>' : ''}${o.source ? '<br><span class="pill pill--event">イベント</span>' : ''}</td>
                <td data-label="商品">${items.map((it) => `${esc(it.name)}${vtxt(it)} ×${esc(it.qty)}`).join('<br>')}</td>
                <td class="adm-num" data-label="合計">¥${yen(o.total)}</td>
                <td class="nowrap" data-label="お支払い">${esc(o.pay)}</td>
                <td data-label="状態">
                  <label class="visually-hidden" for="os-${esc(o.no)}">${esc(o.no)}の状態</label>
                  <select class="select adm-status-select" id="os-${esc(o.no)}" data-order="${esc(o.no)}" data-status="${esc(o.status)}">
                    ${Object.entries(ORDER_STATUS).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}
                  </select>
                </td>
              </tr>
              <tr class="adm-order-detail" id="od-${esc(o.no)}" ${orderState.open === o.no ? '' : 'hidden'}>
                <td colspan="7">
                  <div class="adm-order-grid">
                    <div><h3>ご注文者さま</h3><ul><li>${esc(cu.name)}（${esc(cu.kana)}）</li><li>〒${esc(cu.zip)} ${esc(cu.address)}</li><li>${esc(cu.tel)}</li><li>${esc(cu.email)}</li></ul></div>
                    <div><h3>お届け先</h3><ul>${o.shipTo ? `<li>${esc(o.shipTo.name)} さま</li><li>〒${esc(o.shipTo.zip)} ${esc(o.shipTo.address)}</li><li>${esc(o.shipTo.tel)}</li>` : '<li>ご注文者さまと同じ</li>'}<li>希望日：${esc(o.date || (o.preorder ? '予約商品の発送にあわせる' : o.source ? 'イベント注文（日付指定なし）' : '最短'))}／時間帯：${esc(o.time || '指定なし')}</li>${o.noshi ? `<li>のし名入れ：${esc(o.noshi)}</li>` : ''}</ul></div>
                    <div><h3>内訳</h3><ul>${items.map((it) => `<li>${esc(it.name)}${vtxt(it)}${it.gift ? `（${esc(it.gift)}）` : ''} ×${esc(it.qty)}　¥${yen(it.total)}</li>`).join('')}<li>送料 ¥${yen(o.ship)}</li><li><b>合計 ¥${yen(o.total)}</b></li>${o.memo ? `<li>備考：${esc(o.memo)}</li>` : ''}</ul></div>
                  </div>
                </td>
              </tr>`; }).join('')}
          </tbody>
        </table>
      </div>` : `<div class="adm-card adm-empty"><span class="empty__moon" aria-hidden="true"></span><p>${all.length ? 'この条件の注文はありません。' : 'まだ注文はありません。ショップで試しに注文すると、ここに表示されます。'}</p><a class="adm-btn" href="../shop.html" target="_blank" rel="noopener">ショップを開く${ICON.ext}</a></div>`}`;
    $('#oStatus').addEventListener('change', (e) => { orderState.status = e.target.value; renderOrders(); $('#oStatus').focus(); });
    if ($('#oSrc')) $('#oSrc').addEventListener('change', (e) => { orderState.src = e.target.value; renderOrders(); $('#oSrc').focus(); });
  }
  function orderAction(e) {
    const t = e.target.closest('[data-open]');
    if (!t) return;
    const no = t.dataset.open;
    orderState.open = orderState.open === no ? null : no;
    const row = document.getElementById(`od-${no}`);
    $$('.adm-order-detail').forEach((r) => { r.hidden = r !== row || orderState.open !== no; });
    $$('[data-open]').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.open === orderState.open)));
  }
  function orderChange(e) {
    const sel = e.target.closest('[data-order]');
    if (!sel) return;
    const r = S.updateOrder(sel.dataset.order, { status: sel.value });
    if (!r.ok) { toast(r.error, { error: true }); return; }
    sel.dataset.status = sel.value;
    updateNavCounts();
    toast(`${sel.dataset.order} を「${ORDER_STATUS[sel.value]}」にしました`);
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
  function renderEventAdmin() {
    const c = S.catalog();
    const e = c.settings.event;
    const active = S.eventActive(e);
    const state = !e.enabled ? '非公開' : active ? '公開中' : (e.start && S.today() < e.start ? '公開前' : '公開終了');
    const url = eventURL(e);
    const previewURL = eventURL(e, true);
    const cv = qrCanvas(url, 720);
    const n = S.orders().filter((o) => o.source === e.slug).length;
    const fmt = (d) => (d ? d.replace(/-/g, '/') : '指定なし');
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
                  <label class="adm-check"><input type="checkbox" name="ev-prod" value="${esc(p.id)}" ${e.products.includes(p.id) ? 'checked' : ''}><span>${esc(p.name)}${p.status === 'draft' ? '<small>非公開の商品です（ページには表示されません）</small>' : ''}</span></label>`).join('')}
              </div>
            </fieldset>
          </section>
          <div><button class="btn btn--gold btn--sm" type="submit">イベントページを保存する</button></div>
        </form>
        <div>
          <section class="adm-card adm-qr">
            <h2>会場用のQRコード</h2>
            <p class="adm-muted">いまの状態：<span class="pill pill--${active ? 'published' : 'draft'}">${state}</span>（${fmt(e.start)}〜${fmt(e.end)}）</p>
            ${cv ? `<img class="adm-qr__img" src="${cv.toDataURL('image/png')}" alt="イベントページのQRコード" width="240" height="240">` : '<p class="adm-error">QRコードを作れませんでした（ネットワークにつながっているか確認してください）。</p>'}
            <p class="adm-qr__url"><code id="evUrl">${esc(url)}</code></p>
            <div class="adm-row-actions" style="justify-content:flex-start">
              ${cv ? '<button class="adm-btn" type="button" id="qrSave">QRコードを画像で保存</button>' : ''}
              <button class="adm-btn" type="button" id="urlCopy">URLをコピー</button>
            </div>
            <p class="adm-hint" style="margin-top:10px">チラシやPOPに印刷するときは、画像で保存したQRコードを使ってください。デモ版のURLなので、本番の公開後に作り直します。</p>
          </section>
          <section class="adm-card">
            <h2>イベントからの注文</h2>
            <p><b style="font-size:28px;color:var(--gold-300);font-family:var(--font-display)">${n}</b> 件</p>
            ${n ? `<p><a class="link" href="#orders" data-src-filter="${esc(e.slug)}">注文一覧で見る</a></p>` : ''}
          </section>
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
    $('#evForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const start = $('#ev-start').value, end = $('#ev-end').value;
      if (start && end && start > end) { showErr('ev-err', '表示の終了日は、開始日より後の日付にしてください。', '#ev-end'); $('#ev-end').focus(); return; }
      showErr('ev-err', '', '#ev-end');
      const cat = clone(S.catalog());
      cat.settings.event = {
        ...cat.settings.event,
        enabled: $('#ev-enabled').checked,
        date: $('#ev-date').value, start, end,
        title: $('#ev-title').value.trim() || S.DEFAULT_EVENT.title,
        lead: $('#ev-lead').value.trim(),
        shipNote: $('#ev-ship').value.trim() || S.DEFAULT_EVENT.shipNote,
        products: $$('input[name="ev-prod"]:checked').map((x) => x.value),
      };
      if (save(cat, 'イベントページを保存しました', { href: previewURL, text: 'ページで確認' })) { formDirty = false; renderEventAdmin(); focusAfter('#evForm [type=submit]'); }
    });
  }

  /* =========================================================
     Settings
     ========================================================= */
  function renderSettings() {
    const c = S.catalog();
    const s = c.settings;
    const num = (id, label, val, hint = '') => `
      <div class="adm-field"><label for="${id}">${label}</label><input class="input input--num" id="${id}" type="number" min="0" step="1" inputmode="numeric" value="${val}">${hint ? `<p class="adm-hint">${hint}</p>` : ''}</div>`;
    main.innerHTML = `
      ${head('ショップ設定')}
      <form class="adm-form" id="setForm" novalidate>
        <section class="adm-sec" aria-labelledby="ss1">
          <h2 id="ss1">送料<small>金額はすべて税込・円</small></h2>
          <div class="adm-fields adm-fields--3">
            ${num('s-ship', '送料', s.shipFee)}
            ${num('s-free', '送料無料になるご注文金額', s.freeShipOver, '0 にすると、常に送料無料になります')}
            ${num('s-max', '同じ商品を1回で買える上限（点）', s.maxQty, '1〜99')}
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
    $('#setForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const ids = ['#s-ship', '#s-free', '#s-max'];
      ids.forEach((id) => $(id).removeAttribute('aria-invalid'));
      const bad = ids.filter((id) => !/^\d{1,7}$/.test($(id).value.trim()) || (id === '#s-max' && (Number($(id).value) < 1 || Number($(id).value) > 99)));
      if (bad.length) {
        bad.forEach((id) => $(id).setAttribute('aria-invalid', 'true'));
        $(bad[0]).focus();
        toast('金額・数量は0以上の整数で入力してください（1回で買える上限は1〜99）。', { error: true });
        return;
      }
      const cat = clone(S.catalog());
      const n = (id) => Math.max(0, Math.floor(Number($(id).value) || 0));
      cat.settings.shipFee = n('#s-ship');
      cat.settings.freeShipOver = n('#s-free');
      cat.settings.maxQty = Math.min(99, Math.max(1, n('#s-max') || 1));
      cat.settings.news = { show: $('#s-news-show').checked, text: $('#s-news-text').value.trim(), link: $('#s-news-link').value };
      if (save(cat, '設定を保存しました')) { formDirty = false; renderSettings(); focusAfter('#setForm [type=submit]'); }
    });
  }

  /* =========================================================
     Data
     ========================================================= */
  function renderData() {
    const custom = S.isCustomized();
    let bytes = 0;
    try { for (const k of Object.values(S.KEYS)) bytes += (localStorage.getItem(k) || '').length * 2; } catch { /* ignore */ }
    const limit = 5 * 1024 * 1024;
    const pct = Math.min(100, Math.round((bytes / limit) * 100));
    main.innerHTML = `
      ${head('データ管理')}
      <section class="adm-card">
        <h2>いまの状態</h2>
        <p>${custom ? '商品や設定が編集されています。' : '最初に用意した商品データのままです。'}　注文データ：${S.orders().length}件</p>
        <div class="adm-meter" aria-hidden="true"><i style="width:${pct}%"></i></div>
        <p class="adm-faint">ブラウザの保存領域の使用量：約${(bytes / 1024 / 1024).toFixed(2)}MB（目安の上限 5MB）。写真をたくさんアップロードすると増えます。</p>
      </section>
      <section class="adm-card">
        <h2>バックアップと復元</h2>
        <div class="adm-actions-list">
          <div class="adm-action"><div><h3>データを書き出す</h3><p>商品・カテゴリ・設定をファイル（JSON）に保存します。別のパソコンやブラウザに移すときに使います。</p></div><button class="adm-btn" type="button" id="exportBtn">書き出す</button></div>
          <div class="adm-action"><div><h3>データを読み込む</h3><p>書き出したファイルを読み込んで、いまの商品・カテゴリ・設定と置き換えます。</p></div><span class="adm-upload"><input type="file" accept="application/json,.json" id="importFile" aria-label="書き出したデータファイルを選んで読み込む"><span class="adm-btn">ファイルを選ぶ</span></span></div>
        </div>
      </section>
      <section class="adm-card">
        <h2>リセット</h2>
        <div class="adm-actions-list">
          <div class="adm-action"><div><h3>商品データを最初の状態に戻す</h3><p>追加・編集した商品、カテゴリ、設定をすべて取り消して、最初に用意した商品データに戻します。</p></div><button class="adm-btn adm-btn--danger" type="button" id="resetBtn">最初の状態に戻す</button></div>
          <div class="adm-action"><div><h3>注文データを消す</h3><p>注文一覧に表示されている試しの注文をすべて消します。</p></div><button class="adm-btn adm-btn--danger" type="button" id="clearOrdersBtn" ${S.orders().length ? '' : 'disabled'}>注文データを消す</button></div>
        </div>
      </section>
      <section class="adm-card">
        <h2>本番運用にするには</h2>
        <p class="adm-muted">このデモでは、データの保存先がこのブラウザの中です。本番では保存先をサーバーのデータベースにつなぎ替えることで、管理画面で保存した内容が、すべてのお客さまのショップに反映されるようになります（ログイン機能、決済サービスとの連携もあわせて追加します）。</p>
      </section>`;
    $('#exportBtn').addEventListener('click', () => {
      const d = new Date();
      const name = `mangetsu-catalog-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
      const blob = new Blob([JSON.stringify(S.catalog(), null, 2)], { type: 'application/json' });
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
      const ok = await confirmDialog({ title: 'データを読み込みますか？', body: `商品${data.products.length}件・カテゴリ${data.categories.length}件のデータで、いまの内容を置き換えます。`, ok: '読み込む' });
      if (!ok) return;
      if (save(S.normalize(data), 'データを読み込みました')) { renderData(); focusAfter('#importFile'); }
    });
    $('#resetBtn').addEventListener('click', async () => {
      const ok = await confirmDialog({ title: '最初の状態に戻しますか？', body: '追加・編集した商品、カテゴリ、設定がすべて消えます。必要なら先に「書き出す」で保存してください。', ok: '最初の状態に戻す', danger: true });
      if (!ok) return;
      S.resetCatalog();
      toast('最初の状態に戻しました');
      renderData(); focusAfter('#resetBtn');
    });
    $('#clearOrdersBtn').addEventListener('click', async () => {
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
  }
  const confirmLeave = () => confirmDialog({ title: '保存していない変更があります', body: 'このまま移動すると、変更は失われます。', ok: '保存せずに移動する', cancel: '編集を続ける' });
  const hasUnsaved = () => (dirty && draft) || formDirty;
  // ask before the URL changes for in-app links
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || !hasUnsaved() || a.classList.contains('skip-link') || a.closest('#admModal') || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    if (await confirmLeave()) { dirty = false; formDirty = false; location.hash = a.getAttribute('href'); }
  }, true);
  let skipHash = false;
  async function onHashChange() {
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
    if (sf) { e.preventDefault(); orderState.src = sf.dataset.srcFilter; orderState.status = ''; location.hash = 'orders'; return; }
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
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && draft && $('#edForm') && $('#admModal').hidden) { e.preventDefault(); $('#edForm').requestSubmit(); }
  });
  window.addEventListener('beforeunload', (e) => { if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; } });
  main.addEventListener('input', (e) => { if (e.target.closest('#setForm, #catAdd, #evForm')) formDirty = true; });
  main.addEventListener('change', (e) => { if (e.target.closest('#setForm, #catAdd, #evForm')) formDirty = true; });
  $('.skip-link').addEventListener('click', (e) => { e.preventDefault(); main.focus(); });
  window.addEventListener('hashchange', onHashChange);

  // orders placed / catalog edited in another tab
  S.onChange((key) => {
    updateNavCounts();
    if (key === S.KEYS.cart) return;   // the shop's cart never changes admin screens
    if (draft || formDirty) return;    // never re-render over unsaved input
    const y = window.scrollY;
    renderRoute();
    window.scrollTo({ top: y, behavior: 'instant' });
  });

  updateNavCounts();
  renderRoute();
})();
