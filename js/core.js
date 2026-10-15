/* =========================================================
   満月米 — core.js
   ブラウザ（ショップ・管理画面）とサーバー（Stripe 連携の API）で共有する部分。
   DOM や保存先には触れない：初期の商品データ、データの検証、送料と合計金額の計算。

   ブラウザでは window.MangetsuCore、Node / Cloudflare Workers では
   import Core from '.../js/core.js'（または globalThis.MangetsuCore）で使う。
   ========================================================= */
(function (root) {
  'use strict';

  /* ---------- shipping (K NEXT株式会社 送料表 2026-10) ---------- */
  const PREFS = '北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県'.split(' ');
  const SHIP_REGIONS = [
    { id: 'hokkaido', name: '北海道', prefs: ['北海道'] },
    { id: 'kitatohoku', name: '北東北', prefs: ['青森県', '岩手県', '秋田県'] },
    { id: 'minamitohoku', name: '南東北', prefs: ['宮城県', '山形県', '福島県'] },
    // 山梨県は送料表に載っていなかったため、仮に関東に入れている（要確認）
    { id: 'kanto', name: '関東', prefs: ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '山梨県'] },
    { id: 'shinetsu', name: '信越', prefs: ['新潟県', '長野県'] },
    { id: 'chubu', name: '中部', prefs: ['岐阜県', '静岡県', '愛知県', '三重県'] },
    { id: 'hokuriku', name: '北陸', prefs: ['富山県', '石川県', '福井県'] },
    { id: 'kansai', name: '関西', prefs: ['滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'] },
    { id: 'chugoku', name: '中国', prefs: ['鳥取県', '島根県', '岡山県', '広島県', '山口県'] },
    { id: 'shikoku', name: '四国', prefs: ['徳島県', '香川県', '愛媛県', '高知県'] },
    { id: 'kitakyushu', name: '北九州', prefs: ['福岡県', '佐賀県', '長崎県', '大分県'] },
    { id: 'minamikyushu', name: '南九州', prefs: ['熊本県', '宮崎県', '鹿児島県'] },
    { id: 'okinawa', name: '沖縄', prefs: ['沖縄県'] },
  ];
  // one parcel is charged by the smallest class it fits in (kg, inclusive)
  const SHIP_CLASSES = [5, 10, 15, 20, 30];
  const MAX_PARCEL_KG = 30;
  // 円。列は SHIP_CLASSES の順（5kg / 10kg / 15kg / 20kg / 30kg）
  // 税込として扱っているが、送料表（KNEXT㈱送料.pdf）には税込・税抜の記載がない（要確認）。
  // 税抜と分かったら各金額を Math.round(x * 1.1) にする。保存済みの settings.ship.rates は
  // 変わらないので、管理画面の「送料表を最初の金額に戻す」も必要。税込と確認できたらこの注記を確認済みに書き換える
  // 中国〜南九州の 20kg（1,550円）は 15kg より安い。送料表のとおりに入れている（要確認）
  const DEFAULT_SHIP_RATES = {
    hokkaido: [670, 880, 980, 1100, 1270],
    kitatohoku: [840, 950, 1120, 1310, 1560],
    minamitohoku: [840, 970, 1120, 1310, 1560],
    kanto: [840, 970, 1120, 1310, 1560],
    shinetsu: [840, 970, 1120, 1310, 1560],
    chubu: [860, 1010, 1190, 1430, 1750],
    hokuriku: [860, 1010, 1190, 1430, 1750],
    kansai: [890, 1070, 1280, 1550, 1910],
    chugoku: [1560, 1750, 2090, 1550, 2870],
    shikoku: [1560, 1750, 2090, 1550, 2870],
    kitakyushu: [1560, 1750, 2090, 1550, 2870],
    minamikyushu: [1560, 1750, 2090, 1550, 2870],
    okinawa: [1780, 2040, 2400, 2750, 3210],
  };

  /* ---------- catalog data ---------- */
  const RICE_STORE = '高温多湿・直射日光を避け、涼しい場所で保存してください';
  const PRODUCER = '満月農園（北海道士別市上士別町）';
  const SELLER = 'K NEXT株式会社';
  const G = {
    bowl: { src: 'assets/img/bowl.webp', alt: '茶碗に盛った炊きたての満月米', fit: 'contain' },
    hand: { src: 'assets/img/rice-hand-sm.webp', alt: '手のひらにすくった満月米の精米', fit: 'cover' },
    grains: { src: 'assets/img/photo/grains.webp', alt: '枡からこぼれる精米（イメージ）', fit: 'cover' },
    onigiri: { src: 'assets/img/photo/onigiri.webp', alt: 'おにぎり（イメージ）', fit: 'cover' },
    teishoku: { src: 'assets/img/photo/teishoku.webp', alt: '和食の食卓（イメージ）', fit: 'cover' },
    gohan: { src: 'assets/img/photo/gohan.webp', alt: '土鍋で炊いたごはん（イメージ）', fit: 'cover' },
    ears: { src: 'assets/img/photo/ears-moon.webp', alt: '月あかりに実る稲穂（イメージ）', fit: 'cover' },
    paddy: { src: 'assets/img/photo/moon-paddy.webp', alt: '満月と実りの田んぼ（イメージ）', fit: 'cover' },
    summer: { src: 'assets/img/photo/summer.webp', alt: '夏の夕暮れの田んぼ（イメージ）', fit: 'cover' },
    // 実際の袋の写真（2026-10 先方提供。背景を切り抜き）
    bag: { src: 'assets/img/products/shinmai-5kg.webp', alt: '満月米 ななつぼし 5kgの袋', fit: 'contain' },
    bag2: { src: 'assets/img/products/shinmai-10kg.webp', alt: '満月米 ななつぼし 5kgの袋を2つ（10kg）', fit: 'contain' },
  };
  const RICE_GALLERY = [G.bowl, G.grains, G.onigiri, G.hand];

  const DEFAULT_EVENT = {
    enabled: true,
    slug: 'takanawa',
    title: '高輪のイベントにご来場の皆さまへ',
    date: '2026-10-25',
    start: '2026-10-01',
    end: '2026-11-01', // 北海道満喫セットの販売期間（11月1日（日）まで、2026-10-15 先方指定）
    lead: 'ご来場ありがとうございます。北海道満喫セットは、このページからスマートフォンでそのままご注文いただけます。重たいお米は、ご自宅まで直接お届けします。',
    shipNote: 'イベントでのご注文は、1か月後をめどに順次お届けします。',
    products: ['hokkaido-set', 'shinmai-r8', 'genmai-30kg'],
    // イベントページの上に大きく出す画像（先方のチラシ）
    banner: {
      src: 'assets/img/event/hokkaido-set.webp',
      alt: '北海道から、届くごちそう。北海道満喫セット（満月米 ななつぼし 5kgと北海道の海鮮珍味セット）9,800円、税込・送料込み。イベント限定特別価格。',
    },
  };

  const DEFAULT_CATALOG = {
    version: 3,
    settings: {
      ship: { rates: DEFAULT_SHIP_RATES, freeOver: 0 },
      giftFee: 220,
      maxQty: 20,
      news: { show: true, text: '令和8年産の新米、販売中です', link: 'shinmai-r8' },
      event: DEFAULT_EVENT,
    },
    categories: [
      { id: 'shinmai', name: '新米' },
      { id: 'genmai', name: '玄米' },
      { id: 'teiki', name: '定期便' },
      { id: 'set', name: 'セット' },
    ],
    products: [
      {
        id: 'shinmai-r8',
        name: '満月米 ななつぼし 新米 令和8年産',
        category: 'shinmai',
        status: 'published',
        featured: true,
        meta: '令和8年産・精米',
        badge: { text: '新米', line: false },
        card: 'この秋に実った新米を、ご購入いただいた順にお届けします。',
        when: 'ご購入順に順次発送',
        lead: 'この秋に実った、令和8年産の新米です。北海道士別市上士別町の山奥で、天塩川最上流の水と大きな寒暖差のなかで育ったななつぼしです。冷めてもおいしく、お弁当やおにぎりにも向いています。',
        ship: 'ご購入いただいた順に、順次発送します',
        visual: { kind: 'image', src: 'assets/img/products/shinmai-5kg.webp', fit: 'contain' },
        gallery: [G.bag2, G.ears, G.gohan, G.bowl],
        variants: [
          { id: '5kg', label: '5kg', price: 3600, stock: null, weight: 5 },
          { id: '10kg', label: '10kg（5kg×2袋）', price: 6900, stock: null, weight: 10 },
        ],
        options: { gift: false, award: false, preorder: false, subscription: false, traits: true },
        specs: [
          ['名称', '精米'], ['原料玄米', '北海道産 ななつぼし 令和8年産'], ['内容量', '5kg／10kg（5kg×2袋）'], ['精米年月日', '袋に記載'],
          ['賞味期限', '精米日より1ヵ月（目安）'], ['保存方法', RICE_STORE], ['配送方法', 'ヤマト運輸または佐川急便（常温便）'], ['生産者', PRODUCER], ['販売者', SELLER],
          ['発送時期', 'ご購入いただいた順に、順次発送します'],
        ],
      },
      {
        id: 'genmai-30kg',
        name: '満月米 ななつぼし 玄米 令和8年産 30kg',
        category: 'genmai',
        status: 'published',
        featured: true,
        meta: '令和8年産・玄米',
        badge: { text: '玄米', line: true },
        card: '精米する前の玄米を、30kgの紙袋でお届けします。',
        when: 'ご購入順に順次発送',
        lead: '精米する前の玄米を、30kgの紙袋でお届けします。ご自宅の精米機や近くの精米所で、食べる分だけ精米してお召し上がりください。',
        ship: 'ご購入いただいた順に、順次発送します',
        visual: { kind: 'bag', style: 'plain', label: '30kg' },
        gallery: [G.paddy, G.ears, G.summer],
        variants: [{ id: '30kg', label: '30kg', price: 16500, stock: null, weight: 30 }],
        options: { gift: false, award: false, preorder: false, subscription: false, traits: true },
        specs: [
          ['名称', '玄米'], ['原料玄米', '北海道産 ななつぼし 令和8年産'], ['内容量', '30kg'], ['調製年月日', '袋に記載'], ['包装', '紙袋'],
          ['保存方法', RICE_STORE], ['配送方法', 'ヤマト運輸または佐川急便（常温便）'], ['生産者', PRODUCER], ['販売者', SELLER],
        ],
      },
      {
        // 高輪イベント限定。イベントページだけで販売し、送料は価格に含む
        id: 'hokkaido-set',
        name: '北海道満喫セット',
        category: 'set',
        status: 'published',
        featured: false,
        meta: '北海道のお米と海の幸',
        badge: { text: 'イベント限定', line: false },
        card: '満月米 ななつぼし 5kgに、ほたてエレガンス（マスタード味・わさび味）とたこ燻製を合わせたセットです。',
        when: '', // イベントページのカードには出さないので空（管理画面のプレビューも同じ見え方にする）
        lead: '大地と海が育てた、北海道のおいしさをご自宅へお届けします。満月米 ななつぼし 5kgに、北海道北見市常呂町の株式会社しんやの珍味を3品合わせました。ほたて貝柱をたっぷり使い、マヨネーズと合わせた瓶詰め「ほたてエレガンス」のマスタード味とわさび味、水だこを燻製にした「たこ燻製」です。高輪のイベント限定の特別価格です。',
        ship: 'イベント期間中にご注文いただいた順に、順次発送します',
        visual: { kind: 'image', src: 'assets/img/event/hokkaido-set.webp', fit: 'contain' },
        gallery: [{ ...G.bag, alt: '満月米 ななつぼし 5kgの袋（イメージ）' }],
        variants: [{ id: 'set', label: '1セット', price: 9800, stock: null, weight: 6 }],
        options: { gift: false, award: false, preorder: false, subscription: false, traits: true, eventOnly: true, shipIncluded: true },
        specs: [
          // 珍味の内容は 2026-10-15 先方指定。説明は株式会社しんやの商品ページ（hotate-shop.shinya.ne.jp
          // item 000000000308 / 309 / 375）に書かれていることだけ。原材料・アレルギー・賞味期限は記載がなかった
          ['セット内容', '満月米 ななつぼし 5kg（北海道士別市上士別町産）／ほたてエレガンス 120g瓶 マスタード味／ほたてエレガンス 120g瓶 わさび味／たこ燻製 30g'],
          ['ほたてエレガンス', 'ほたて貝柱をたっぷり使い、マヨネーズと合わせた瓶詰めです。マスタード味とわさび味の2種類（各120g瓶）。冷凍はできません'],
          ['たこ燻製', '水だこを燻製にしました（30g）。やわらかく、噛むほどにうまみが出ます'],
          ['珍味の販売元', '株式会社しんや（北海道北見市常呂町）'],
          ['原材料・アレルギー', '（準備中）'],
          ['賞味期限', 'お米：精米日より1ヵ月（目安）／珍味：（準備中）'],
          ['保存方法', 'お米：' + RICE_STORE + '／珍味：（準備中）※ほたてエレガンスは冷凍できません'],
          ['配送方法', 'ヤマト運輸または佐川急便（お届けの温度帯は準備中）'],
          ['送料', '価格に含まれます'], ['販売期間', '2026年11月1日（日）まで'],
          ['生産者（お米）', PRODUCER], ['販売者', SELLER],
        ],
      },
      {
        id: 'teiki',
        name: '満月米 定期便',
        category: 'teiki',
        status: 'draft',
        featured: false,
        meta: '精米・毎月／隔月',
        badge: { text: '5%お得', line: true },
        card: 'お米を切らさない暮らしに。通常価格より5%お得です。',
        when: '毎月・隔月でお届け',
        lead: 'お届けの周期と量を選べる定期便です。お米を切らさないよう、通常価格より5%お得に満月米をお届けします。',
        ship: '初回はご購入いただいた順に、順次発送します',
        visual: { kind: 'bag', style: 'phases', label: '5kg' },
        gallery: [G.teishoku, G.bowl, G.onigiri, G.grains],
        variants: [
          { id: 'm5', label: '毎月 5kg', price: 3420, stock: null, weight: 5 },
          { id: 'b5', label: '隔月 5kg', price: 3420, stock: null, weight: 5 },
          { id: 'm10', label: '毎月 10kg', price: 6555, stock: null, weight: 10 },
        ],
        options: { gift: false, award: false, preorder: false, subscription: true, traits: true },
        specs: [
          ['名称', '精米'], ['原料玄米', '北海道産 ななつぼし 令和8年産'], ['内容量', '5kg／10kg（5kg×2袋）'],
          ['精米年月日', '袋に記載'], ['賞味期限', '精米日より1ヵ月（目安）'], ['保存方法', RICE_STORE], ['配送方法', 'ヤマト運輸または佐川急便（常温便）'], ['生産者', PRODUCER], ['販売者', SELLER],
          ['お届け周期', '毎月／隔月からお選びいただけます'], ['休止・解約・お約束回数', '（準備中）'],
        ],
      },
    ],
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------- normalisation (keeps old or hand-edited data safe) ---------- */
  const int = (v, d = 0) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : d; };
  const str = (v, d = '') => (typeof v === 'string' ? v : d);
  // ids are used in URLs and HTML attributes, so only a safe alphabet is accepted
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const idOr = (v, d) => (typeof v === 'string' && ID_RE.test(v) ? v : d);
  // weight of one unit in kg (0.1 steps, up to one 30kg parcel); used for shipping
  const kgOr = (v, d) => { const n = Math.round(Number(v) * 10) / 10; return v !== null && v !== '' && Number.isFinite(n) && n > 0 ? Math.min(MAX_PARCEL_KG, n) : d; };
  const kgFromLabel = (label) => kgOr((/(\d+(?:\.\d+)?)\s*kg/i.exec(str(label)) || [])[1], 5);
  function normShip(sh) {
    const src = sh && typeof sh === 'object' ? sh : {};
    const rates = {};
    for (const r of SHIP_REGIONS) {
      const row = src.rates && Array.isArray(src.rates[r.id]) ? src.rates[r.id] : [];
      rates[r.id] = SHIP_CLASSES.map((_, i) => Math.max(0, int(row[i], DEFAULT_SHIP_RATES[r.id][i])));
    }
    return { rates, freeOver: Math.max(0, int(src.freeOver, 0)) };
  }
  function normProduct(p, i) {
    const vSeen = new Set();
    const variants = (Array.isArray(p.variants) ? p.variants : []).filter((v) => v && typeof v === 'object').map((v, j) => ({
      id: (() => { let id = idOr(v.id, `v${j + 1}`); while (vSeen.has(id)) id = `v${j + 1}-${vSeen.size}`; vSeen.add(id); return id; })(),
      label: str(v && v.label) || '通常',
      price: Math.max(0, int(v && v.price)),
      stock: v && v.stock !== null && v.stock !== '' && v.stock !== undefined ? Math.max(0, int(v.stock)) : null,
      weight: kgOr(v.weight, kgFromLabel(v.label)),
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
        : { kind: 'bag', style: ['single', 'double', 'seal', 'phases', 'plain'].includes(p.visual && p.visual.style) ? p.visual.style : 'single', label: str(p.visual && p.visual.label, '5kg') },
      gallery: (Array.isArray(p.gallery) ? p.gallery : []).filter((g) => g && str(g.src)).map((g) => ({ src: g.src, alt: str(g.alt), fit: g.fit === 'contain' ? 'contain' : 'cover' })),
      variants: variants.length ? variants : [{ id: 'v1', label: '通常', price: 0, stock: null }],
      options: {
        gift: false, // ギフト包装・のしは取り扱わない
        award: !!(p.options && p.options.award),
        preorder: !!(p.options && p.options.preorder),
        subscription: !!(p.options && p.options.subscription),
        traits: !!(p.options && p.options.traits),
        eventOnly: !!(p.options && p.options.eventOnly),       // イベントページだけで販売
        shipIncluded: !!(p.options && p.options.shipIncluded), // 送料は価格に含む（送料計算から外す）
      },
      specs: (Array.isArray(p.specs) ? p.specs : []).filter((r) => Array.isArray(r) && (r[0] || r[1])).map((r) => [str(r[0]), str(r[1])]),
    };
  }
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const dateOr = (v, d) => (typeof v === 'string' && DATE_RE.test(v) ? v : d);
  function normEvent(e) {
    const d = DEFAULT_EVENT;
    if (!e || typeof e !== 'object') return clone(d);
    return {
      enabled: e.enabled !== false,
      slug: idOr(e.slug, d.slug),
      title: str(e.title, d.title),
      date: dateOr(e.date, ''),
      start: dateOr(e.start, ''),
      end: dateOr(e.end, ''),
      lead: str(e.lead, d.lead),
      shipNote: str(e.shipNote).trim() || d.shipNote,
      products: (Array.isArray(e.products) ? e.products : []).filter((x) => typeof x === 'string' && ID_RE.test(x)),
      banner: e.banner && typeof e.banner === 'object' && str(e.banner.src) ? { src: e.banner.src, alt: str(e.banner.alt) } : null,
    };
  }
  function normalize(c) {
    if (!c || !Array.isArray(c.products) || !Array.isArray(c.categories)) return clone(DEFAULT_CATALOG);
    const d = DEFAULT_CATALOG.settings;
    const s = c.settings || {};
    const news = s.news || {};
    const cSeen = new Set(), pSeen = new Set();
    return {
      version: 3,
      settings: {
        ship: normShip(s.ship),
        giftFee: Math.max(0, int(s.giftFee, d.giftFee)),
        maxQty: Math.min(99, Math.max(1, int(s.maxQty, d.maxQty))),
        news: { show: news.show !== false, text: str(news.text, d.news.text), link: str(news.link) },
        event: normEvent(s.event),
      },
      categories: c.categories.filter((k) => k && ID_RE.test(str(k.id)) && !cSeen.has(k.id) && cSeen.add(k.id)).map((k) => ({ id: k.id, name: str(k.name) || k.id })),
      products: c.products.filter((p) => p && typeof p === 'object').map(normProduct).map((p) => { let id = p.id, n = 2; while (pSeen.has(id)) id = `${p.id.slice(0, 36)}-${n++}`; pSeen.add(id); return { ...p, id }; }),
    };
  }

  /* ---------- product helpers ---------- */
  const isVisible = (p) => !!p && p.status !== 'draft';
  // shown in the shop list, categories, home and related products (event-only items live on the event page)
  const isListed = (p) => isVisible(p) && !p.options.eventOnly;
  const variantSoldOut = (p, v) => p.status === 'soldout' || (v.stock !== null && v.stock <= 0);
  const productSoldOut = (p) => p.variants.every((v) => variantSoldOut(p, v));
  const minPrice = (p) => {
    const avail = p.variants.filter((v) => !variantSoldOut(p, v));
    return Math.min(...(avail.length ? avail : p.variants).map((v) => v.price));
  };
  // how many of this variant can be in one order
  const maxFor = (settings, p, v) => Math.min(settings.maxQty, v.stock === null ? Infinity : v.stock);

  /* ---------- event page (期間限定) ---------- */
  // today: 'YYYY-MM-DD' (the shop passes the shopper's date, the server passes Japan time)
  const eventActive = (e, today) => !!e && e.enabled && (!e.start || today >= e.start) && (!e.end || today <= e.end);
  const japanToday = (now = Date.now()) => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  // an event-only product can be bought while the event is on and the product is on its page
  const eventSellable = (settings, p, today) => !p.options.eventOnly
    || (eventActive(settings.event, today) && settings.event.products.includes(p.id));

  /* ---------- shipping ---------- */
  const regionOf = (pref) => SHIP_REGIONS.find((r) => r.prefs.includes(pref)) || null;
  const classIndex = (kg) => SHIP_CLASSES.findIndex((c) => kg <= c + 1e-9);
  // pack units into as few parcels (≤ 30kg) as possible: first-fit decreasing.
  // lines: [{ weight, qty }] → parcel weights in kg, heaviest first
  function packParcels(lines) {
    const units = [];
    for (const l of lines) for (let i = 0; i < l.qty; i++) units.push(Math.round(l.weight * 10));
    units.sort((a, b) => b - a);
    const cap = MAX_PARCEL_KG * 10;
    const boxes = [];
    for (const u of units) {
      const i = boxes.findIndex((b) => b + u <= cap);
      if (i === -1) boxes.push(u); else boxes[i] += u;
    }
    return boxes.map((b) => b / 10);
  }
  // shipping for one order.
  // fee is null while the prefecture is unknown (cart before the address is entered)
  // lines with shipIncluded (送料込みの商品) are left out: they ship at the shop's cost.
  // sub is the 商品小計 of the lines that do pay shipping (for the free-shipping line)
  function shippingQuote({ lines, pref = '', sub = 0, ship }) {
    const region = regionOf(pref);
    const rates = ship.rates;
    const charged = lines.filter((l) => l.qty > 0 && !l.shipIncluded);
    const parcels = packParcels(charged).map((kg) => {
      const i = classIndex(kg);
      return { kg, cls: SHIP_CLASSES[i], fee: region ? rates[region.id][i] : null };
    });
    const free = parcels.length > 0 && ship.freeOver > 0 && sub >= ship.freeOver;
    const raw = region ? parcels.reduce((s, p) => s + p.fee, 0) : null;
    return {
      region: region ? { id: region.id, name: region.name } : null,
      parcels,
      free,
      included: lines.some((l) => l.qty > 0 && l.shipIncluded),
      fee: !parcels.length || free ? 0 : raw,
    };
  }
  // cheapest / dearest fee for the given lines across all regions (for "送料 670円〜" style hints)
  function shippingRange(lines, ship) {
    const fees = SHIP_REGIONS.map((r) => shippingQuote({ lines, pref: r.prefs[0], ship }).fee);
    return { min: Math.min(...fees), max: Math.max(...fees) };
  }

  /* ---------- order pricing (the server recomputes everything with this) ---------- */
  // items: [{ pid, vid, qty }] → priced lines, problems that stop checkout, and totals
  // today: 'YYYY-MM-DD' in Japan time (decides whether event-only products can be bought)
  function priceCart(catalog, items, { pref = '', today = japanToday() } = {}) {
    const lines = [];
    const problems = [];
    for (const it of Array.isArray(items) ? items : []) {
      const p = catalog.products.find((x) => x.id === (it && it.pid));
      const v = p && p.variants.find((x) => x.id === it.vid);
      if (!isVisible(p) || !v) { problems.push({ pid: str(it && it.pid), vid: str(it && it.vid), code: 'not_found', name: p ? p.name : '' }); continue; }
      const name = p.variants.length > 1 ? `${p.name} ${v.label}` : p.name;
      if (variantSoldOut(p, v)) { problems.push({ pid: p.id, vid: v.id, code: 'sold_out', name }); continue; }
      if (!eventSellable(catalog.settings, p, today)) { problems.push({ pid: p.id, vid: v.id, code: 'event_only', name }); continue; }
      const qty = int(it.qty, 0);
      const max = maxFor(catalog.settings, p, v);
      if (qty < 1 || qty > max) { problems.push({ pid: p.id, vid: v.id, code: v.stock !== null && qty > v.stock ? 'stock' : 'qty', name, max }); continue; }
      lines.push({
        pid: p.id, vid: v.id, name: p.name, variant: p.variants.length > 1 ? v.label : '',
        qty, unit: v.price, total: v.price * qty, weight: v.weight,
        preorder: p.options.preorder, subscription: p.options.subscription, ship: p.ship,
        eventOnly: p.options.eventOnly, shipIncluded: p.options.shipIncluded,
      });
    }
    const sub = lines.reduce((s, l) => s + l.total, 0);
    const chargedSub = lines.reduce((s, l) => s + (l.shipIncluded ? 0 : l.total), 0);
    const shipping = shippingQuote({ lines, pref, sub: chargedSub, ship: catalog.settings.ship });
    return { lines, problems, sub, shipping, total: shipping.fee === null ? null : sub + shipping.fee };
  }

  const Core = Object.freeze({
    PREFS, SHIP_REGIONS, SHIP_CLASSES, MAX_PARCEL_KG, DEFAULT_SHIP_RATES,
    DEFAULT_CATALOG, DEFAULT_EVENT, ID_RE,
    clone, normalize, normShip,
    isVisible, isListed, variantSoldOut, productSoldOut, minPrice, maxFor,
    eventActive, eventSellable, japanToday,
    regionOf, packParcels, shippingQuote, shippingRange, priceCart,
  });
  root.MangetsuCore = Core;
  if (typeof module === 'object' && module && module.exports) module.exports = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
