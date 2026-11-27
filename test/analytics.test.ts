import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadDataset } from '../src/data/load.js';
import {
  periodResult,
  priceChanges,
  splitDate,
  stockCheck,
  unitMargins,
  weeklyTrend,
} from '../src/analytics.js';

// These run on the committed dataset: they prove every headline figure in the
// report is computed from data/, not written by a model.
const ds = loadDataset();

test('dataset loads with source line numbers', () => {
  assert.equal(ds.sales.length, 2000);
  assert.equal(ds.purchases.length, 51);
  assert.equal(ds.costs.length, 31);
  assert.equal(ds.sales[0]!.line, 2);
});

test('stock check: only Schweppes Tonic is sold beyond deliveries', () => {
  const oversold = stockCheck(ds).filter((r) => r.oversold);
  assert.equal(oversold.length, 1);
  const tonic = oversold[0]!;
  assert.equal(tonic.item, 'Schweppes Tonic Water 0,25 l');
  assert.equal(tonic.delivered, 24);
  assert.equal(tonic.used, 28);
  assert.deepEqual(tonic.firstOversell, {
    line: 1905,
    receipt: 'AB12CD34-EF56GH78-2193',
    date: '2026-12-24',
    time: '13:41:04',
    used: 25,
    delivered: 24,
  });
  assert.ok(tonic.sources.includes('promet_2026-11-26_do_2026-12-25.csv:1905'));
});

test('weekly trend flags only Karamel latte', () => {
  const flagged = weeklyTrend(ds).filter((r) => r.flagged);
  assert.deepEqual(flagged.map((r) => [r.name, r.weeks, r.changePct]), [['Karamel latte', [39, 27, 22, 7], -82.05]]);
});

test('supplier price rises are compared per supplier and set the split date', () => {
  assert.deepEqual(
    priceChanges(ds).map((r) => [r.item, r.date, r.from, r.to]),
    [
      ['Espresso kafa u zrnu 1 kg', '2026-12-10', 2450, 3480],
      ['Domaća kafa mlevena 200 g', '2026-12-10', 290, 380],
      ['Mleko trajno 2,8% m.m. 1 l', '2026-12-12', 138, 179],
      ['Mleko za barista 3,5% 1 l', '2026-12-12', 175, 230],
    ]
  );
  assert.equal(splitDate(ds), '2026-12-10');
});

test('unit margins before and after the price rise', () => {
  const byName = new Map(unitMargins(ds).map((r) => [r.name, r]));
  const espresso = byName.get('Espresso')!;
  assert.deepEqual([espresso.costBefore, espresso.costAfter, espresso.marginBeforePct, espresso.marginAfterPct], [18.75, 25.96, 88.75, 84.42]);
  const latte = byName.get('Kafa latte')!;
  assert.deepEqual([latte.marginBeforePct, latte.marginAfterPct], [76.31, 68.32]);
  assert.equal(byName.get('Coca-Cola 0,25')!.flagged, false); // bottled, price unchanged
});

test('period result turns from profit to loss', () => {
  const { pnl, costChanges } = periodResult(ds);
  assert.deepEqual(
    pnl.map((r) => [r.id, r.days, r.netSales, r.cogs, r.fixedCosts, r.monthlyResult]),
    [
      ['PNL-BEFORE', 14, 204099.24, 50575.39, 298900, 30079.68],
      ['PNL-AFTER', 16, 240394.7, 63087.35, 349450, -16998.72],
    ]
  );
  assert.deepEqual(
    costChanges.map((r) => [r.category, r.delta]),
    [['Kirija', 14250], ['Struja', 18000], ['Provizija kartice', 300], ['Održavanje', 18000]]
  );
});
