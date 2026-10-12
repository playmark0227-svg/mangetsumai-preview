/* Server-side validation of the checkout form (mirrors the shop's form in js/app.js). */
import Core from './core.js';
import { prefsForZip } from './zip.js';

export const TIMES = ['指定なし', '午前中', '14〜16時', '16〜18時', '18〜20時', '19〜21時'];
export const MAX_LINES = 30;

// C0/C1 controls, line / paragraph separators, bidi overrides / isolates, BOM
const BAD_ONE_LINE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/;
const BAD_MULTI_LINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/;

// the same input clean-up the shop does: full-width digits → half-width, hiragana → katakana
const toHalf = (s) => s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)).replace(/[－ー―‐−]/g, '-').replace(/\s/g, '');
const toKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

const KANA_RE = /^[ァ-ヶー　 ]+$/;
const ZIP_RE = /^\d{3}-?\d{4}$/;
const TEL_RE = /^0\d{1,4}-?\d{1,4}-?\d{3,4}$/;
// the HTML "email" input rule, plus a dot in the domain (Stripe needs a deliverable address)
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
// Stripe refuses a local part (before @) that starts or ends with '.' or has '..' in it — some
// older Japanese mobile addresses look like that. Refused here, before an order number is used.
const EMAIL_DOTS_RE = /^\.|\.\.|\.@/;

const LABELS = {
  name1: '姓', name2: '名', kana1: 'セイ', kana2: 'メイ', zip: '郵便番号', pref: '都道府県',
  addr1: '市区町村・番地', addr2: '建物名・部屋番号', tel: '電話番号', email: 'メールアドレス',
};
const SHIP_LABELS = {
  name: 'お届け先のお名前', zip: 'お届け先の郵便番号', pref: 'お届け先の都道府県',
  addr1: 'お届け先の市区町村・番地', addr2: 'お届け先の建物名・部屋番号', tel: 'お届け先の電話番号',
};

const ITEMS_UNREADABLE = 'カートの内容を読み取れませんでした。カートを開き直して、もう一度お試しください。';

// 市区町村 that starts with ANOTHER prefecture's full name (e.g. 都道府県 北海道, 市区町村
// 沖縄県那覇市…) → that prefecture's name, else ''. Only whole names (with 都・道・府・県) at the very
// start count, so it cannot misfire: no full name is the start of another one, the chosen one
// repeated (東京都港区… with 東京都) is fine, and a place name is never the start of a prefecture's
// full name (京都市 is not 京都府, 東京都 does not start with 京都府, 愛知郡 in 滋賀県 is not 愛知県).
export function otherPrefAtStart(addr1, pref) {
  if (!addr1 || !Core.PREFS.includes(pref)) return '';
  return Core.PREFS.find((p) => p !== pref && addr1.startsWith(p)) || '';
}

function makeChecker() {
  const errors = [];
  const warnings = [];
  const add = (field, message) => { if (!errors.some((e) => e.field === field)) errors.push({ field, message }); };
  const warn = (w) => { warnings.push(w); };

  // one-line text: trimmed, required unless min is 0, at most `max` characters (UTF-16 units, like maxlength)
  function text(field, label, raw, { min = 1, max, clean } = {}) {
    if (raw !== undefined && raw !== null && typeof raw !== 'string') { add(field, `${label}を入力してください。`); return ''; }
    let v = (raw || '').trim();
    if (clean) v = clean(v);
    if (!v) { if (min > 0) add(field, `${label}を入力してください。`); return ''; }
    if (BAD_ONE_LINE.test(v)) { add(field, `${label}に使用できない文字が含まれています。`); return v; }
    if (max && v.length > max) add(field, `${label}は${max}文字以内で入力してください。`);
    return v;
  }
  return { errors, warnings, add, warn, text };
}

function personFields(ck, prefix, src, labels, { nameMax }) {
  const L = (k) => labels[k];
  const f = (k) => `${prefix}.${k}`;
  const out = {};
  if (prefix === 'customer') {
    out.name1 = ck.text(f('name1'), L('name1'), src.name1, { max: 20 });
    out.name2 = ck.text(f('name2'), L('name2'), src.name2, { max: 20 });
    out.kana1 = ck.text(f('kana1'), L('kana1'), src.kana1, { max: 30, clean: toKata });
    out.kana2 = ck.text(f('kana2'), L('kana2'), src.kana2, { max: 30, clean: toKata });
    for (const k of ['kana1', 'kana2']) if (out[k] && !KANA_RE.test(out[k])) ck.add(f(k), `${L(k)}はカタカナで入力してください。`);
  } else {
    out.name = ck.text(f('name'), L('name'), src.name, { max: nameMax });
  }
  out.zip = ck.text(f('zip'), L('zip'), src.zip, { max: 8, clean: toHalf });
  if (out.zip && !ZIP_RE.test(out.zip)) ck.add(f('zip'), `${L('zip')}は7桁の数字で入力してください（例：0950000）。`);
  const pref = typeof src.pref === 'string' ? src.pref.trim() : '';
  if (!Core.PREFS.includes(pref)) ck.add(f('pref'), `${L('pref')}を選択してください。`);
  out.pref = pref;
  // the fee is charged by the prefecture, the carrier goes by the postal code. The postal code
  // table (zip.js) is not verified, so a mismatch only leaves a warning on the order for the admin
  const zipPrefs = out.zip && ZIP_RE.test(out.zip) && Core.PREFS.includes(pref) ? prefsForZip(out.zip) : null;
  if (zipPrefs && !zipPrefs.includes(pref)) {
    ck.warn({ who: prefix, code: 'zip_pref_mismatch', zip: out.zip, pref, expected: [...zipPrefs] });
  }
  out.addr1 = ck.text(f('addr1'), L('addr1'), src.addr1, { max: 80 });
  // this one is certain, so it is refused: 市区町村 starting with another prefecture's name
  const other = otherPrefAtStart(out.addr1, pref);
  if (other) {
    ck.add(f('addr1'), `${L('addr1')}が「${other}」から始まっていますが、都道府県は「${pref}」が選ばれています。ご住所をご確認ください。`);
  }
  out.addr2 = ck.text(f('addr2'), L('addr2'), src.addr2, { min: 0, max: 80 });
  out.tel = ck.text(f('tel'), L('tel'), src.tel, { max: 13, clean: toHalf });
  if (out.tel && !TEL_RE.test(out.tel)) ck.add(f('tel'), `${L('tel')}は市外局番から数字で入力してください。`);
  return out;
}

// items: [{ pid, vid, qty }] → merged lines, or null when unreadable
function readItems(ck, raw) {
  if (!Array.isArray(raw) || raw.length === 0) { ck.add('items', 'カートに商品がありません。'); return []; }
  if (raw.length > MAX_LINES) { ck.add('items', `一度にご注文いただける商品は${MAX_LINES}種類までです。`); return []; }
  const merged = [];
  for (const it of raw) {
    const ok = it && typeof it === 'object'
      && typeof it.pid === 'string' && it.pid.length >= 1 && it.pid.length <= 40
      && typeof it.vid === 'string' && it.vid.length >= 1 && it.vid.length <= 40
      && Number.isInteger(it.qty) && it.qty >= 1 && it.qty <= 999;
    if (!ok) { ck.add('items', ITEMS_UNREADABLE); return []; }
    const dup = merged.find((m) => m.pid === it.pid && m.vid === it.vid);
    if (dup) dup.qty += it.qty; else merged.push({ pid: it.pid, vid: it.vid, qty: it.qty });
  }
  return merged;
}

// body of POST /api/checkout → { value, errors } (errors: [{ field, message }]).
// value.addressWarnings: [{ who: 'customer' | 'shipTo', code: 'zip_pref_mismatch', zip, pref, expected }]
// (expected: the prefectures the postal code belongs to) — kept on the order, never an error
export function validateCheckout(body) {
  const ck = makeChecker();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { value: null, errors: [{ field: '', message: '送信された内容を読み取れませんでした。' }] };
  }
  const items = readItems(ck, body.items);

  const c = body.customer && typeof body.customer === 'object' ? body.customer : {};
  const customer = personFields(ck, 'customer', c, LABELS, {});
  customer.email = ck.text('customer.email', LABELS.email, c.email, { max: 120 });
  if (customer.email && !EMAIL_RE.test(customer.email)) ck.add('customer.email', 'メールアドレスの形式で入力してください（例：mail@example.com）。');
  else if (customer.email && EMAIL_DOTS_RE.test(customer.email)) {
    ck.add('customer.email', 'このメールアドレスはカード決済でご利用いただけません（「@」の前が「.」で始まる・終わる、または「.」が続くアドレス）。別のメールアドレスをご入力ください。');
  }

  let shipTo = null;
  if (body.shipTo !== null && body.shipTo !== undefined && body.shipTo !== false) {
    if (typeof body.shipTo !== 'object' || Array.isArray(body.shipTo)) ck.add('shipTo', 'お届け先を読み取れませんでした。');
    else shipTo = personFields(ck, 'shipTo', body.shipTo, SHIP_LABELS, { nameMax: 40 });
  }

  const date = ck.text('date', 'お届け希望日', body.date, { min: 0, max: 30 });
  const time = ck.text('time', 'お届け時間帯', body.time, { min: 0, max: 20 });
  if (time && !TIMES.includes(time)) ck.add('time', 'お届け時間帯を選択肢からお選びください。');

  let memo = '';
  if (body.memo !== undefined && body.memo !== null) {
    if (typeof body.memo !== 'string') ck.add('memo', 'ご要望などを読み取れませんでした。');
    else {
      memo = body.memo.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
      if (BAD_MULTI_LINE.test(memo)) ck.add('memo', 'ご要望などに使用できない文字が含まれています。');
      else if (memo.length > 400) ck.add('memo', 'ご要望などは400文字以内で入力してください。');
    }
  }

  // only a well-formed slug is kept here; whether it counts is decided against the event settings
  const source = typeof body.source === 'string' && Core.ID_RE.test(body.source) ? body.source : '';

  // true: the shopper was told that the same order was paid a moment ago (409 duplicate_paid) and
  // orders it again on purpose
  let confirmDuplicate = false;
  if (body.confirmDuplicate !== undefined && body.confirmDuplicate !== null) {
    if (typeof body.confirmDuplicate === 'boolean') confirmDuplicate = body.confirmDuplicate;
    else ck.add('confirmDuplicate', 'ご注文の確認を読み取れませんでした。ページを開き直して、もう一度お試しください。');
  }

  return { value: { items, customer, shipTo, date, time, memo, source, confirmDuplicate, addressWarnings: ck.warnings }, errors: ck.errors };
}
