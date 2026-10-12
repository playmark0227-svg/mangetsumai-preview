/* Postal code → prefecture check (the first 3 digits of a Japanese postal code).
 * The shipping fee is decided by the prefecture the shopper picks, while the carrier routes by
 * the postal code; an order whose postal code belongs to another prefecture may have been charged
 * the wrong region's fee. Each 3-digit prefix belongs to one prefecture, except a few that span
 * two (498 愛知・三重, 618 京都・大阪, 684 鳥取・島根, 871 大分・福岡 — each pair is in one shipping
 * region, so the fee is the same either way). Prefixes not listed here are not checked.
 * The table was written from memory and has not been checked against the Japan Post data
 * (only 618 was confirmed), so a mismatch NEVER blocks an order: it is stored on the order as an
 * address warning (order.addressWarnings, see validate.js) for the shop to look at in the admin.
 * Plain data on purpose: it can move to js/core.js if the shop wants the same check. */

// [first, last, prefecture] by the first 3 digits
const RANGES = [
  [1, 9, '北海道'], [10, 19, '秋田県'], [20, 29, '岩手県'], [30, 39, '青森県'], [40, 99, '北海道'],
  [100, 198, '東京都'], [200, 208, '東京都'], [210, 259, '神奈川県'], [260, 299, '千葉県'],
  [300, 319, '茨城県'], [320, 329, '栃木県'], [330, 369, '埼玉県'], [370, 379, '群馬県'], [380, 399, '長野県'],
  [400, 409, '山梨県'], [410, 439, '静岡県'], [440, 498, '愛知県'],
  [500, 509, '岐阜県'], [510, 519, '三重県'], [520, 529, '滋賀県'], [530, 599, '大阪府'],
  [600, 629, '京都府'], [630, 639, '奈良県'], [640, 649, '和歌山県'], [650, 679, '兵庫県'],
  [680, 683, '鳥取県'], [689, 689, '鳥取県'], [690, 699, '島根県'],
  [700, 719, '岡山県'], [720, 739, '広島県'], [740, 759, '山口県'],
  [760, 769, '香川県'], [770, 779, '徳島県'], [780, 789, '高知県'], [790, 799, '愛媛県'],
  [800, 839, '福岡県'], [840, 849, '佐賀県'], [850, 859, '長崎県'], [860, 869, '熊本県'],
  [870, 879, '大分県'], [880, 889, '宮崎県'], [890, 899, '鹿児島県'], [900, 909, '沖縄県'],
  [910, 919, '福井県'], [920, 929, '石川県'], [930, 939, '富山県'], [940, 959, '新潟県'],
  [960, 979, '福島県'], [980, 989, '宮城県'], [990, 999, '山形県'],
];
// prefixes shared by two prefectures (685 隠岐 is lenient too: both are 中国)
const SHARED = {
  498: ['愛知県', '三重県'],
  618: ['京都府', '大阪府'],
  684: ['鳥取県', '島根県'],
  685: ['島根県', '鳥取県'],
  871: ['大分県', '福岡県'],
};

// '095-0000' / '0950000' → the prefectures that postal code can belong to, or null (not checked)
export function prefsForZip(zip) {
  const m = /^(\d{3})-?\d{4}$/.exec(String(zip || ''));
  if (!m) return null;
  const n = Number(m[1]);
  if (SHARED[n]) return SHARED[n];
  const r = RANGES.find(([a, b]) => n >= a && n <= b);
  return r ? [r[2]] : null;
}
