/* =========================================================
   満月米 — ui.js
   ショップと管理画面で共有する表示部品
   （価格・バッジ・米袋イラスト・商品画像・商品カード）
   ========================================================= */
(() => {
  'use strict';
  const S = window.MangetsuStore;

  // pages below the site root (admin/) set <html data-base="../">
  const BASE = document.documentElement.dataset.base || '';
  const asset = (src) => (!src ? '' : /^(data:|blob:|https?:|\/)/.test(src) ? src : BASE + src);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = (n) => Number(n || 0).toLocaleString('ja-JP');
  const priceHTML = (n, { tax = true, from = false, per = '' } = {}) =>
    `<span class="price"><span class="price__yen">¥</span>${yen(n)}${from ? '<span class="price__from">〜</span>' : ''}${tax ? '<span class="price__tax">税込</span>' : ''}${per ? `<span class="price__tax">／${per}</span>` : ''}</span>`;

  const ICON_BAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 8.5h11l-1 11.2a1.5 1.5 0 0 1-1.5 1.3H9a1.5 1.5 0 0 1-1.5-1.3z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9.3 8.5V7a2.7 2.7 0 0 1 5.4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

  /* moon phase glyph for the steps bar: 1 crescent … 4 full */
  const phaseSVG = (n) => {
    const lit = ['', 'M8 1.5A6.5 6.5 0 0 1 8 14.5A4.2 6.5 0 0 0 8 1.5Z', 'M8 1.5A6.5 6.5 0 0 1 8 14.5Z', 'M8 1.5A6.5 6.5 0 0 1 8 14.5A4.2 6.5 0 0 1 8 1.5Z', ''][n];
    return `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" class="${n === 4 ? 'full' : ''}"/>${lit ? `<path class="lit" d="${lit}"/>` : ''}</svg>`;
  };

  /* ---------- rice-bag illustration ---------- */
  let uid = 0;
  function bagSVG(style = 'single', weightLabel = '5kg', { title = '' } = {}) {
    const u = 'm' + ++uid;
    const weight = esc(weightLabel || '');
    const zig = (() => {
      let d = 'M18 50 L18 17';
      const n = 20, w = (182 - 18) / n;
      for (let i = 0; i < n; i++) d += ` L${(18 + w * i + w / 2).toFixed(1)} 11.5 L${(18 + w * (i + 1)).toFixed(1)} 17`;
      return d + ' L182 50 Z';
    })();
    const body = 'M20 44 C18 120 13 214 9 282 C8.5 292 14 297 24 297 L176 297 C186 297 191.5 292 191 282 C187 214 182 120 180 44 Z';
    const tick = (x, y, dx, dy) => `<path d="M${x} ${y + dy * 7} V${y} H${x + dx * 7}" fill="none" stroke="#d0ad6d" stroke-width=".8"/>`;
    const label = `
      <rect x="50" y="78" width="100" height="170" fill="#232b36"/>
      <rect x="55" y="83" width="90" height="160" fill="none" stroke="#d0ad6d" stroke-width=".5" stroke-opacity=".7"/>
      ${tick(59, 87, 1, 1)}${tick(141, 87, -1, 1)}${tick(59, 239, 1, -1)}${tick(141, 239, -1, -1)}
      <circle cx="100" cy="112" r="19" fill="#f1d17d" opacity=".16"/>
      <image href="${asset('assets/img/moon-sm.webp')}" x="84" y="96" width="32" height="32"/>
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
    // 無地の紙袋（玄米30kgなど）: no designed label, just the sack's own print
    const plainPrint = `
      <g font-family="Shippori Mincho B1, serif" font-weight="700" fill="#5b3f22" fill-opacity=".82" text-anchor="middle">
        <text x="100" y="138" font-size="30">玄</text><text x="100" y="174" font-size="30">米</text>
      </g>
      <rect x="62" y="196" width="76" height="30" fill="none" stroke="#5b3f22" stroke-opacity=".7" stroke-width="1.2"/>
      <text x="100" y="217" text-anchor="middle" font-family="Josefin Sans, sans-serif" font-size="15" letter-spacing="2" fill="#5b3f22" fill-opacity=".85">${weight}</text>
      <text x="100" y="246" text-anchor="middle" font-family="Zen Maru Gothic, sans-serif" font-size="7.5" letter-spacing="1.4" fill="#5b3f22" fill-opacity=".7">北海道士別市産 ななつぼし</text>`;
    const bag = (extra = '', plain = false) => `
      <path d="${body}" fill="url(#${u}k)"/>
      <path d="${body}" fill="url(#${u}sd)"/>
      <path d="M40 64 C44 130 40 210 33 284" stroke="#fff" stroke-opacity=".10" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M163 66 C165 140 168 214 172 284" stroke="#4a3216" stroke-opacity=".10" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M28 272 C70 280 130 281 174 272" stroke="#4a3216" stroke-opacity=".12" stroke-width="3" fill="none"/>
      <rect x="19" y="48" width="162" height="10" fill="url(#${u}cs)"/>
      <path d="${zig}" fill="url(#${u}tp)"/>
      <path d="M20 33 H180" stroke="#7d6040" stroke-width="1" stroke-dasharray="3 2.4" opacity=".75"/>
      ${plain ? plainPrint : label}
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
        const lit = ['', `M${top} A${r} ${r} 0 0 1 ${bot} A${r * 0.55} ${r} 0 0 0 ${top}Z`, `M${top} A${r} ${r} 0 0 1 ${bot}Z`, `M${top} A${r} ${r} 0 0 1 ${bot} A${r * 0.55} ${r} 0 0 1 ${top}Z`, ''][i];
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
    if (style === 'double') {
      inner = `${shadow(170, 132)}
        <g transform="translate(116 12) scale(.9)">${bag()}<path d="${body}" fill="#0d121a" opacity=".22"/></g>
        <g transform="translate(24 26) scale(.95)">${bag()}</g>`;
    } else if (style === 'plain') {
      inner = `${shadow(160, 112)}<g transform="translate(55 6) scale(1.05)">${bag('', true)}</g>`;
    } else if (style === 'phases') {
      inner = `${shadow(160, 98)}${phases}<g transform="translate(66 40) scale(.94)">${bag()}</g>`;
    } else {
      inner = `${shadow(160, 104)}<g transform="translate(60 20)">${bag(style === 'seal' ? seal : '')}</g>`;
    }
    const a11y = title ? `role="img" aria-label="${esc(title)}"` : 'aria-hidden="true"';
    return `<svg class="bag-art" viewBox="0 0 320 340" ${a11y} focusable="false">${defs}${inner}</svg>`;
  }

  /* main visual of a product: rice-bag illustration or an image */
  function visualHTML(p, { title = '', alt = '' } = {}) {
    const v = p.visual || {};
    if (v.kind === 'image' && v.src) {
      return `<img class="visual-img is-${v.fit === 'contain' ? 'contain' : 'cover'}" src="${esc(asset(v.src))}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
    }
    return bagSVG(v.style, v.label, { title });
  }
  const imageHTML = (g, alt = g.alt) => `<img class="visual-img is-${g.fit === 'contain' ? 'contain' : 'cover'}" src="${esc(asset(g.src))}" alt="${esc(alt || '')}" loading="lazy" decoding="async">`;

  /* stock wording for cards and product pages */
  function stockNote(p) {
    if (S.productSoldOut(p)) return '';
    const managed = p.variants.filter((v) => v.stock !== null && v.stock > 0);
    if (!managed.length) return '';
    const least = Math.min(...managed.map((v) => v.stock));
    if (least > 5) return '';
    return p.variants.length === 1 ? `残り${least}点` : '残りわずか';
  }

  /* product card (home featured grid, shop list, related products, admin preview) */
  function cardHTML(p, { href = (id) => `#item-${id}`, preview = false } = {}) {
    const multi = p.variants.length > 1;
    const soldOut = S.productSoldOut(p);
    const link = preview ? '#' : href(p.id);
    const note = stockNote(p);
    const when = [p.when, note].filter(Boolean).join('・');
    const badge = soldOut
      ? '<span class="badge badge--soldout">売り切れ</span>'
      : p.badge && p.badge.text ? `<span class="badge${p.badge.line ? ' badge--line' : ''}">${esc(p.badge.text)}</span>` : '';
    let action;
    if (soldOut) action = '<button class="add-btn" type="button" disabled>売り切れ</button>';
    else if (multi) action = `<a class="add-btn" href="${esc(link)}" ${preview ? 'tabindex="-1"' : ''} aria-label="${esc(p.name)}の内容を選んで購入">選んで購入</a>`;
    else action = `<button class="add-btn" type="button" ${preview ? 'tabindex="-1"' : `data-add="${esc(p.id)}" data-variant="${esc(p.variants[0].id)}"`} aria-label="${esc(p.name)}をカートに入れる">${ICON_BAG}カートに入れる</button>`;
    return `
      <article class="p-card${soldOut ? ' is-soldout' : ''}">
        ${badge}
        <a class="p-card__visual" href="${esc(link)}" tabindex="-1" aria-hidden="true">${visualHTML(p)}</a>
        <div class="p-card__body">
          <p class="p-card__meta">${esc(p.meta)}</p>
          <h3 class="p-card__name"><a href="${esc(link)}" ${preview ? 'tabindex="-1"' : ''}>${esc(p.name)}</a></h3>
          <p class="p-card__desc">${esc(p.card)}</p>
          <p class="p-card__when${when ? '' : ' is-empty'}">${esc(when) || '&nbsp;'}</p>
          <div class="p-card__foot">
            ${S.productSoldOut(p) && !p.variants.length ? '' : priceHTML(S.minPrice(p), { from: multi, per: p.options.subscription ? '1回' : '' })}
            ${action}
          </div>
        </div>
      </article>`;
  }

  window.MangetsuUI = { asset, esc, yen, priceHTML, ICON_BAG, phaseSVG, bagSVG, visualHTML, imageHTML, cardHTML, stockNote };
})();
