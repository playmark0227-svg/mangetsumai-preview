/* =========================================================
   満月米 — api.js
   本番モードで使う API（server/）との通信。デモモード（apiBase が空）では enabled: false。
   エラーは MangetsuAPI.APIError（message は日本語、status / code / details つき）。
   ========================================================= */
(() => {
  'use strict';

  const cfg = window.MANGETSU_CONFIG || {};
  const base = String(cfg.apiBase || '').trim().replace(/\/+$/, '');
  const TOKEN_KEY = 'mangetsu.admin.token';

  class APIError extends Error {
    constructor(message, { status = 0, code = '', details = null } = {}) {
      super(message);
      this.name = 'APIError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  // admin password (Bearer token). kept only for this tab
  const token = () => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const setToken = (t) => { try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } };
  const clearToken = () => { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

  async function call(method, path, { body, admin = false, raw = null, contentType = '' } = {}) {
    const headers = { Accept: 'application/json' };
    if (raw) headers['Content-Type'] = contentType || 'application/octet-stream';
    else if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (admin) { const t = token(); if (t) headers.Authorization = `Bearer ${t}`; }
    let res;
    try {
      res = await fetch(base + path, {
        method, headers, credentials: 'omit', cache: 'no-store',
        body: raw || (body === undefined ? undefined : JSON.stringify(body)),
      });
    } catch {
      throw new APIError('通信できませんでした。インターネットの接続を確かめて、もう一度お試しください。', { code: 'network' });
    }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      throw new APIError((data && data.error) || `エラーが発生しました（${res.status}）。時間をおいて、もう一度お試しください。`,
        { status: res.status, code: (data && data.code) || '', details: (data && data.details) || null });
    }
    return data || {};
  }

  window.MangetsuAPI = {
    enabled: !!base,
    base,
    APIError,

    /* ---------- shop ---------- */
    // → { catalog, rev }  (公開中・売り切れの商品だけ。非公開の商品は含まない)
    getCatalog: () => call('GET', '/api/catalog'),
    // payload: { items:[{pid,vid,qty}], customer:{...}, shipTo:null|{...}, date, time, memo, source, expectedTotal, confirmDuplicate? }
    //   expectedTotal: 画面に表示したお支払い合計。請求には使わず、サーバーの計算と違えば 409（code: 'price_changed'、details に { total }）
    //   confirmDuplicate: true のときだけ、同じ内容（メールアドレス・商品・お届け先）の注文が直前（60分以内）に支払い済みでも受け付ける。
    //     ないときは 409（code: 'duplicate_paid'、details に { orderNo, paidAt }）で、何も作らない。
    //     ショップはお客さまに確かめてから（「もう一度注文する」）、confirmDuplicate: true で送り直す
    //   409 duplicate_pending: 同じ内容（メールアドレス・商品・お届け先）の注文が、ほかの画面（別のブラウザ・端末）で
    //     ほぼ同時に始まっていて、そちらのほうが新しい（お支払いはそちらの画面で）。この注文は作らない。
    //     ショップは error（日本語）をボタンの近くに出し、カートと入力内容はそのまま、ボタンはもう一度押せる状態に戻す
    //   409 cart_changed の details: [{ pid, vid, code, name, max? }]。code は 'sold_out' | 'stock' | 'qty' | …、
    //     'held' は在庫はあるが、ほかのお客さまがお支払い手続き中。max はいまご購入いただける数：
    //       1 以上 … その数までなら買える（残りは、ほかのお客さまの決済画面が取り置き中。サーバーで HOLD_PER_CLIENT を
    //               設定したときは、同じ接続元（会場の Wi-Fi など）が取り置ける数の残りのことも）。
    //               ショップはその商品をカートに残したまま、数量を max にする
    //       0      … いまは買えない（カートから外さず、時間をおいて再度）
    // → { orderNo, url, total, sessionId }  url は Stripe の決済画面、sessionId はその決済画面の ID（cancelCheckout で無効にする）
    createCheckout: (payload) => call('POST', '/api/checkout', { body: payload }),
    // → { orderNo, payment:'paid'|'pending'|'expired', name, total, preorder, mixed, preorderShip, eventNote }
    checkoutStatus: (sessionId) => call('GET', `/api/checkout/status?session_id=${encodeURIComponent(sessionId)}`),
    // 支払わずに戻ったとき・次の決済画面を開く前に、前の決済画面を Stripe で無効にする（二重の支払いを防ぐ）
    // → checkoutStatus と同じ形。payment は通常 'expired'。すでに支払い済みなら 'paid'（注文はそのまま確定）、
    //   Stripe に確かめられなかったときは 'pending' のまま。未知の ID は 404、Stripe に届かないときは 502、多すぎると 429
    cancelCheckout: (sessionId) => call('POST', '/api/checkout/cancel', { body: { session_id: sessionId } }),

    /* ---------- admin（Authorization: Bearer <管理用パスワード>） ---------- */
    admin: {
      token, setToken, clearToken,
      // → { ok: true }  パスワードの確認
      check: () => call('GET', '/api/admin/session', { admin: true }),
      // → { catalog, rev }  (非公開の商品も含む)
      getCatalog: () => call('GET', '/api/admin/catalog', { admin: true }),
      // → { catalog, rev }  rev が古いと 409（code: 'conflict'、details に最新の { catalog, rev }）
      saveCatalog: (catalog, rev) => call('PUT', '/api/admin/catalog', { admin: true, body: { catalog, rev } }),
      // payment: 'paid'（既定）| 'pending' | 'all' → { orders }
      listOrders: ({ payment = 'paid' } = {}) => call('GET', `/api/admin/orders?payment=${encodeURIComponent(payment)}`, { admin: true }),
      // patch: { status } → { order }
      updateOrder: (no, patch) => call('PATCH', `/api/admin/orders/${encodeURIComponent(no)}`, { admin: true, body: patch }),
      // blob: image/webp | image/jpeg | image/png（2MB まで）→ { url }
      uploadImage: (blob) => call('POST', '/api/admin/images', { admin: true, raw: blob, contentType: blob.type }),
    },
  };
})();
