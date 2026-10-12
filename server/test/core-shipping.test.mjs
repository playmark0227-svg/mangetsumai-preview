/* js/core.js shipping and pricing, as the server uses them. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Core from '../src/core.js';

const ship = () => Core.normalize(Core.clone(Core.DEFAULT_CATALOG)).settings.ship;
const R = Core.DEFAULT_SHIP_RATES;
const quote = (lines, pref, sub = 0, s = ship()) => Core.shippingQuote({ lines, pref, sub, ship: s });

test('core loads through src/core.js (side-effect import + global)', () => {
  assert.equal(typeof Core.priceCart, 'function');
  assert.equal(globalThis.MangetsuCore, Core);
});

test('every prefecture belongs to exactly one shipping region', () => {
  assert.equal(Core.PREFS.length, 47);
  for (const pref of Core.PREFS) {
    const n = Core.SHIP_REGIONS.filter((r) => r.prefs.includes(pref)).length;
    assert.equal(n, 1, pref);
  }
  assert.equal(Core.SHIP_REGIONS.length, 13);
  assert.equal(Core.regionOf('山梨県').id, 'kanto'); // provisional (missing from the client's table)
  assert.equal(Core.regionOf('どこか'), null);
});

test('one parcel: every region × weight class uses the table rate', () => {
  for (const region of Core.SHIP_REGIONS) {
    for (const [i, cls] of Core.SHIP_CLASSES.entries()) {
      for (const pref of region.prefs) {
        const q = quote([{ weight: cls, qty: 1 }], pref);
        assert.equal(q.region.id, region.id);
        assert.deepEqual(q.parcels, [{ kg: cls, cls, fee: R[region.id][i] }], `${pref} ${cls}kg`);
        assert.equal(q.fee, R[region.id][i]);
        assert.equal(q.free, false);
      }
    }
  }
});

test('a parcel is charged by the smallest class it fits in (inclusive)', () => {
  const k = R.kanto;
  assert.equal(quote([{ weight: 0.5, qty: 1 }], '東京都').fee, k[0]);
  assert.equal(quote([{ weight: 5, qty: 1 }], '東京都').fee, k[0]);
  assert.equal(quote([{ weight: 5.1, qty: 1 }], '東京都').fee, k[1]);
  assert.equal(quote([{ weight: 10.1, qty: 1 }], '東京都').fee, k[2]);
  assert.equal(quote([{ weight: 15.5, qty: 1 }], '東京都').fee, k[3]);
  assert.equal(quote([{ weight: 20.1, qty: 1 }], '東京都').fee, k[4]);
  // 中国〜南九州: 20kg is cheaper than 15kg in the client's table — kept as given
  assert.equal(quote([{ weight: 20, qty: 1 }], '広島県').fee, 1550);
  assert.equal(quote([{ weight: 15, qty: 1 }], '広島県').fee, 2090);
});

test('several parcels: first-fit decreasing into 30kg boxes, fees added up', () => {
  const k = R.kanto;
  // 玄米30kg × 2 → two 30kg parcels
  let q = quote([{ weight: 30, qty: 2 }], '東京都');
  assert.deepEqual(q.parcels.map((p) => p.kg), [30, 30]);
  assert.equal(q.fee, k[4] * 2);
  // 5kg × 7 = 35kg → 30 + 5
  q = quote([{ weight: 5, qty: 7 }], '東京都');
  assert.deepEqual(q.parcels.map((p) => p.kg), [30, 5]);
  assert.equal(q.fee, k[4] + k[0]);
  // 10kg × 4 = 40kg → 30 + 10
  q = quote([{ weight: 10, qty: 4 }], '沖縄県');
  assert.deepEqual(q.parcels.map((p) => p.kg), [30, 10]);
  assert.equal(q.fee, R.okinawa[4] + R.okinawa[1]);
  // 30kg + 10kg + 5kg × 2 → [30], [20]
  q = quote([{ weight: 30, qty: 1 }, { weight: 10, qty: 1 }, { weight: 5, qty: 2 }], '北海道');
  assert.deepEqual(q.parcels.map((p) => p.kg), [30, 20]);
  assert.equal(q.fee, R.hokkaido[4] + R.hokkaido[3]);
  // 10kg + 5kg → one 15kg parcel
  q = quote([{ weight: 10, qty: 1 }, { weight: 5, qty: 1 }], '大阪府');
  assert.deepEqual(q.parcels, [{ kg: 15, cls: 15, fee: R.kansai[2] }]);
});

test('fee is null until the prefecture is known; free shipping over the threshold', () => {
  const q = quote([{ weight: 5, qty: 1 }], '');
  assert.equal(q.fee, null);
  assert.equal(q.region, null);
  const s = { ...ship(), freeOver: 10000 };
  assert.equal(quote([{ weight: 5, qty: 1 }], '東京都', 9999, s).fee, R.kanto[0]);
  const free = quote([{ weight: 5, qty: 1 }], '東京都', 10000, s);
  assert.equal(free.fee, 0);
  assert.equal(free.free, true);
  assert.equal(quote([], '東京都').fee, 0);
});

test('priceCart: lines, totals and problems', () => {
  const c = Core.normalize(Core.clone(Core.DEFAULT_CATALOG));
  const r = Core.priceCart(c, [{ pid: 'shinmai-r8', vid: '10kg', qty: 2 }, { pid: 'genmai-30kg', vid: '30kg', qty: 1 }], { pref: '東京都' });
  assert.equal(r.problems.length, 0);
  assert.equal(r.sub, 6900 * 2 + 16500);
  // 10kg × 2 + 30kg → [30], [20]
  assert.equal(r.shipping.fee, R.kanto[4] + R.kanto[3]);
  assert.equal(r.total, r.sub + r.shipping.fee);
  assert.equal(r.lines[0].variant, '10kg（5kg×2袋）');
  assert.equal(r.lines[1].variant, '');

  const bad = Core.priceCart(c, [
    { pid: 'teiki', vid: 'm5', qty: 1 }, // draft
    { pid: 'nope', vid: 'x', qty: 1 },
    { pid: 'shinmai-r8', vid: '5kg', qty: 21 }, // over maxQty 20
  ], { pref: '東京都' });
  assert.deepEqual(bad.problems.map((p) => p.code), ['not_found', 'not_found', 'qty']);
  assert.equal(bad.problems[2].max, 20);
});
