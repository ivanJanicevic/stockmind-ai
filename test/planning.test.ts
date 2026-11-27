import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

import { loadDataset, type Dataset, type Purchase, type Sale } from '../src/data/load.js';
import {
  buildLots,
  buildRecommendationsCsv,
  lotRisk,
  periodComparison,
  productProfit,
  promotionCandidates,
  recommendationLines,
  replenishment,
  salesByPeriod,
  type NoteLot,
  type PlanningParams,
} from '../src/planning.js';
import { idealNote, readDoc } from './ideal.js';

const ds = loadDataset();

// Delivery-note lots as the runtime builds them from verified receiving-clerk answers.
const noteLots: NoteLot[] = readdirSync(new URL('../data/text/', import.meta.url))
  .filter((f) => f.startsWith('otpremnica-'))
  .flatMap((f) => {
    const n = idealNote(readDoc(f));
    return n.lines.map((l) => ({ noteNo: n.noteNumber.value, deliveryDate: n.deliveryDate.value, code: l.code, quantity: l.quantity, expiryDate: l.expiryDate, source: `text/${f}: "${l.quote}"` }));
  });

test('profit by product: total profit and profit per unit are different rankings', () => {
  const rows = productProfit(ds);
  const byName = new Map(rows.map((r) => [r.name, r]));
  const espresso = byName.get('Espresso')!;
  assert.deepEqual([espresso.rank, espresso.units, espresso.grossProfit, espresso.avgProfitPerUnit, espresso.currentProfitPerUnit], [1, 339, 48701.75, 143.66, 140.71]);
  const beer = byName.get('Točeno pivo 0,5')!;
  assert.ok(beer.avgProfitPerUnit > espresso.avgProfitPerUnit, 'draught beer earns more per glass');
  assert.ok(beer.grossProfit < espresso.grossProfit, 'but espresso earns more in total');
  assert.ok(rows.every((r) => r.costMissing.length === 0));
  // Net revenue excludes VAT: espresso 200 RSD incl. 20 % → 166,67 per cup.
  assert.ok(Math.abs(espresso.netRevenue / 339 - 200 / 1.2) < 1);
});

test('sales by period add up and show what each period covers', () => {
  const rows = salesByPeriod(ds);
  const sum = (period: string) => Math.round(rows.filter((r) => r.period === period).reduce((s, r) => s + r.grossRevenue, 0) * 100) / 100;
  assert.equal(sum('day'), 533120); // = net POS turnover incl. VAT (sales − refunds)
  assert.equal(sum('week'), 533120);
  assert.equal(sum('month'), 533120);
  assert.deepEqual([...new Set(rows.filter((r) => r.period === 'month').map((r) => `${r.key}:${r.days}`))], ['2026-11:5', '2026-12:25']);
  assert.ok(rows.filter((r) => r.period === 'week').some((r) => r.days === 2)); // partial last week is labelled
});

test('equivalent periods: weeks compared, unequal months refused', () => {
  const { rows, monthly } = periodComparison(ds);
  assert.equal(monthly.comparable, false);
  assert.match(monthly.reason, /5 days.*25 days/);
  const byName = new Map(rows.map((r) => [r.name, r]));
  assert.deepEqual([byName.get('Karamel latte')!.flag, byName.get('Karamel latte')!.changePct], ['falling', -68.18]);
  assert.equal(byName.get('Coca-Cola 0,25')!.flag, 'rising');
  assert.equal(byName.get('Jogurt 180 g')!.flag, 'too few sales'); // no basis to call a trend
});

test('lots: expiry facts from verified delivery notes, never stock = delivered', () => {
  const { lots, unmatched } = buildLots(ds, noteLots);
  const { rows, uncovered } = lotRisk(ds, lots);
  const find = (item: string, noteNo: string) => rows.find((r) => r.item === item && r.noteNo === noteNo)!;
  const oat = find('Biljni napitak ovas 1 l', 'MD-OTP-55271');
  assert.deepEqual([oat.status, oat.remainingAsOf, oat.costAtRisk], ['expired_on_arrival', 12, 3120]);
  const water = find('Kisela voda 0,25 l staklo', 'OPT-2026-11-0931');
  assert.equal(water.status, 'expired_unsold');
  assert.equal(water.remainingAsOf, water.delivered - water.usedByAsOf); // remaining is delivered minus recipe use
  assert.ok(water.remainingAsOf < water.delivered);
  assert.equal(uncovered.get('Schweppes Tonic Water 0,25 l'), 4); // sold without a recorded delivery
  // December deliveries have an invoice line but no delivery note: expiry unknown, not invented.
  assert.ok(rows.some((r) => r.item === 'Espresso kafa u zrnu 1 kg' && r.status === 'unknown_expiry'));
  assert.ok(unmatched.some((u) => u.code === 'MD-MS-0250')); // butter: bought, used by no recipe
});

// A tiny synthetic dataset for edge cases: one bottled product, one lot.
function tiny(opts: { lotQty: number; expiry: string; dailySales: number; days: number; price?: number; cost?: number }): { ds: Dataset; lots: NoteLot[] } {
  const start = '2026-12-01';
  const day = (i: number) => new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10);
  const sales: Sale[] = Array.from({ length: opts.days }, (_, i) => ({
    line: i + 2, date: day(i), time: '10:00:00', receipt: `R${i}`, refund: false, code: 1, name: 'Sok', qty: opts.dailySales,
    unitPrice: opts.price ?? 120, amount: opts.dailySales * (opts.price ?? 120), vatRate: 20,
  })).filter((s) => s.qty > 0);
  if (!sales.length) sales.push({ line: 2, date: day(opts.days - 1), time: '10:00:00', receipt: 'R0', refund: false, code: 2, name: 'Other', qty: 1, unitPrice: 100, amount: 100, vatRate: 20 });
  const purchases: Purchase[] = [{ line: 2, date: start, supplier: 'Dobavljač (izmišljeno)', invoiceNo: 'F-1', noteNo: 'OT-1', supplierCode: 'S-1', name: 'Sok 0,2 l', unit: 'kom', qty: opts.lotQty, price: opts.cost ?? 50, vatRate: 20, totalInclVat: opts.lotQty * (opts.cost ?? 50) * 1.2 }];
  const ds: Dataset = {
    sales,
    purchases,
    costs: [],
    products: [{ code: 1, name: 'Sok', price: opts.price ?? 120, vatRate: 20, group: 'sok', noteName: 'Sok 0,2 l' }, { code: 2, name: 'Other', price: 100, vatRate: 20, group: 'x', noteName: null }],
    materials: new Map([['Sok 0,2 l', { key: 'Sok 0,2 l', noteName: 'Sok 0,2 l', unit: 'kom', factor: 1, supplierCodes: ['S-1'] }]]),
    recipes: new Map([[1, [{ material: 'Sok 0,2 l', qty: 1 }]], [2, []]]),
  };
  return { ds, lots: [{ noteNo: 'OT-1', deliveryDate: start, code: 'S-1', quantity: opts.lotQty, expiryDate: opts.expiry, source: 'test' }] };
}

test('at-risk lot: forecast leftover, promotion bounded by cost, no invented uplift', () => {
  // 100 delivered, 2/day for 14 days → 72 left on 12-14; expiry 12-24 → 10 more days × 2 = 20 sold → 52 left.
  const { ds: t, lots } = tiny({ lotQty: 100, expiry: '2026-12-24', dailySales: 2, days: 14 });
  const { rows } = lotRisk(t, buildLots(t, lots).lots);
  const lot = rows[0]!;
  assert.deepEqual([lot.status, lot.remainingAsOf, lot.projectedSold, lot.projectedLeftover, lot.kind], ['at_risk', 72, 20, 52, 'forecast']);
  const [promo] = promotionCandidates(t, rows);
  assert.ok(promo);
  // price 120 incl. VAT → 100 excl.; cost 50 → any discount above 50 % sells below cost.
  assert.deepEqual([promo.maxDiscountPct, promo.netPricePerUnit, promo.costPerUnit, promo.requiredDailySales], [50, 100, 50, 7.2]);
  assert.match(promo.limitations.join(' '), /No promotion history/);
});

test('no promotion when the lot will sell out, or there is no margin room', () => {
  const sells = tiny({ lotQty: 20, expiry: '2026-12-24', dailySales: 2, days: 14 });
  assert.equal(promotionCandidates(sells.ds, lotRisk(sells.ds, buildLots(sells.ds, sells.lots).lots).rows).length, 0);
  const noMargin = tiny({ lotQty: 100, expiry: '2026-12-24', dailySales: 2, days: 14, price: 60, cost: 50 }); // 60 incl. VAT = 50 excl.
  const [promo] = promotionCandidates(noMargin.ds, lotRisk(noMargin.ds, buildLots(noMargin.ds, noMargin.lots).lots).rows);
  assert.equal(promo!.maxDiscountPct, null);
  assert.match(promo!.action, /no margin room/);
});

test('replenishment: no quantity without lead time; quantity formula with parameters', () => {
  const { ds: t, lots } = tiny({ lotQty: 30, expiry: '2027-06-01', dailySales: 2, days: 14 }); // 2 left
  const { rows, uncovered } = lotRisk(t, buildLots(t, lots).lots);
  const [missing] = replenishment(t, rows, null, uncovered);
  assert.equal(missing!.flag, 'insufficient_data');
  assert.equal(missing!.orderQuantity, null);
  assert.match(missing!.missing.join(), /lead time.*safety stock/);
  assert.match(missing!.missing.join(), /physical stock count/);

  const params: PlanningParams = { synthetic: true, leadTimeDays: { 'Dobavljač (izmišljeno)': 2 }, safetyStockDays: 3, reviewPeriodDays: 7 };
  const [r] = replenishment(t, rows, params, uncovered);
  // reorder point 2 × (2 + 3) = 10 > stock 2 → order 2 × (2 + 7 + 3) − 2 = 22
  assert.deepEqual([r!.flag, r!.bookStock, r!.reorderPoint, r!.orderQuantity, r!.kind], ['stockout_risk', 2, 10, 22, 'recommendation']);
  assert.match(r!.missing.join(), /synthetic/);
  assert.notEqual(r!.confidence, 'high');
});

test('replenishment: zero demand and overstock', () => {
  const idle = tiny({ lotQty: 30, expiry: '2027-06-01', dailySales: 0, days: 14 });
  const idleRows = lotRisk(idle.ds, buildLots(idle.ds, idle.lots).lots);
  assert.deepEqual(replenishment(idle.ds, idleRows.rows, null, idleRows.uncovered), []); // product never sold: nothing to plan
  const big = tiny({ lotQty: 500, expiry: '2027-12-01', dailySales: 2, days: 14 });
  const bigRows = lotRisk(big.ds, buildLots(big.ds, big.lots).lots);
  assert.equal(replenishment(big.ds, bigRows.rows, null, bigRows.uncovered)[0]!.flag, 'overstock');
});

test('recommendations CSV labels facts, forecasts and recommendations with source and limits', () => {
  const { lots } = buildLots(ds, noteLots);
  const { rows, uncovered } = lotRisk(ds, lots);
  const lines = recommendationLines(rows, promotionCandidates(ds, rows), replenishment(ds, rows, null, uncovered));
  const csvText = buildRecommendationsCsv(lines);
  assert.match(csvText.split('\n')[0]!, /NOT SENT.*not financial advice/);
  assert.equal(csvText.split('\n')[1], 'kind;type;item;action;quantity;unit;rationale;confidence;source;limitations');
  assert.ok(lines.some((l) => l.kind === 'fact' && l.type === 'expired_on_arrival'));
  assert.ok(lines.every((l) => l.source && l.limitations));
  assert.ok(!lines.some((l) => l.type === 'stockout_risk' && l.quantity !== '' && l.kind !== 'recommendation'));
});

test('an unverified delivery note is not used for expiry: its deliveries get unknown expiry', () => {
  const withoutNote04 = noteLots.filter((l) => l.noteNo !== 'OPT-2026-11-0931');
  const { lots } = buildLots(ds, withoutNote04);
  const fanta = lots.filter((l) => l.material === 'Fanta pomorandža 0,25 l staklo');
  assert.equal(fanta.length, 1);
  assert.equal(fanta[0]!.expiryDate, null); // from the purchase register, not invented
  assert.match(fanta[0]!.source, /nabavne_cene\.csv:\d+/);
});
