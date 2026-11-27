// Inventory planning: sales and profit by product, expiry risk by delivered
// lot, promotion candidates and replenishment. Pure, deterministic code; every
// row carries its sources, and anything the data can't support is reported as
// missing instead of being estimated.

import { FILES, ref, type Dataset, type Material, type Purchase } from './data/load.js';
import { round2, unitCost } from './analytics.js';

const dayMs = 86_400_000;
const addDays = (date: string, days: number) => new Date(Date.parse(date) + days * dayMs).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / dayMs);
const netOf = (gross: number, vatRate: number) => gross / (1 + vatRate / 100);
// Row ids must be plain tokens: bottled items' material key is their name.
export const materialId = (m: Material) => (m.supplierCodes[0] ?? m.key).replace(/[^A-Za-z0-9_-]+/g, '_');
const matches = (m: Material, p: Purchase) => (m.supplierCodes.length ? m.supplierCodes.includes(p.supplierCode) : p.name === m.noteName);

// Thresholds are stated in the report next to every flag they produce.
export const PLANNING_RULES = {
  trendMinUnits: 10, // equivalent-period comparison needs at least this many units in the earlier period
  trendChangePct: 25, // |change| at or above this flags rising / falling
  demandWindowDays: 14, // trailing window for average daily demand
  forecastHorizonDays: 60, // lots expiring later are outside the forecast
  overstockCoverDays: 60, // stock lasting longer than this at current demand is overstock
};

export type Kind = 'fact' | 'forecast' | 'recommendation';
export type Confidence = 'high' | 'medium' | 'low';

// ---------------------------------------------------------------------------
// 1. Sales and profit by product

export interface SalesPeriodRow {
  period: 'day' | 'week' | 'month';
  key: string; // 2026-12-24 · W1 2026-11-26..2026-12-02 · 2026-12
  days: number; // days of data the period covers
  code: number;
  name: string;
  units: number;
  grossRevenue: number; // incl. VAT
  netRevenue: number; // excl. VAT
  source: string;
}

// Units and revenue per product for every day, 7-day week and calendar month
// in the data (for out/sales-by-product.csv).
export function salesByPeriod(ds: Dataset): SalesPeriodRow[] {
  const first = ds.sales[0]!.date;
  const last = ds.sales.at(-1)!.date;
  const weekOf = (date: string) => Math.floor(daysBetween(first, date) / 7);
  const weekKey = (w: number) => `W${w + 1} ${addDays(first, w * 7)}..${[addDays(first, w * 7 + 6), last].sort()[0]}`;
  const weekDays = (w: number) => Math.min(7, daysBetween(addDays(first, w * 7), last) + 1);
  const monthDays = (m: string) => new Set(ds.sales.filter((s) => s.date.startsWith(m)).map((s) => s.date)).size;

  const groups = new Map<string, SalesPeriodRow & { lines: number[] }>();
  for (const s of ds.sales) {
    for (const [period, key, days] of [
      ['day', s.date, 1],
      ['week', weekKey(weekOf(s.date)), weekDays(weekOf(s.date))],
      ['month', s.date.slice(0, 7), monthDays(s.date.slice(0, 7))],
    ] as const) {
      const id = `${period}|${key}|${s.code}`;
      let g = groups.get(id);
      if (!g) {
        g = { period, key, days, code: s.code, name: s.name, units: 0, grossRevenue: 0, netRevenue: 0, source: '', lines: [] };
        groups.set(id, g);
      }
      g.units += s.qty;
      g.grossRevenue += s.amount;
      g.netRevenue += netOf(s.amount, s.vatRate);
      g.lines.push(s.line);
    }
  }
  return [...groups.values()].map(({ lines, ...g }) => ({
    ...g,
    grossRevenue: round2(g.grossRevenue),
    netRevenue: round2(g.netRevenue),
    source: `${FILES.sales}:${Math.min(...lines)}..${Math.max(...lines)} (${lines.length} rows)`,
  }));
}

export interface ProfitRow {
  id: string; // PROFIT-<code>
  rank: number; // by total gross profit
  code: number;
  name: string;
  units: number;
  netRevenue: number; // excl. VAT, refunds included
  costOfGoods: number; // recipe cost at the purchase price in force on each sale date
  grossProfit: number; // total, over the whole period
  marginPct: number;
  avgProfitPerUnit: number; // realised: total gross profit ÷ units
  currentProfitPerUnit: number; // today: current price excl. VAT − current recipe cost
  costMissing: string[]; // ingredients without a purchase price (then cost is incomplete)
  sources: string[];
}

// Profit per unit and total profit per product, ranked by total gross profit.
export function productProfit(ds: Dataset): ProfitRow[] {
  const end = ds.sales.at(-1)!.date;
  const cache = new Map<string, ReturnType<typeof unitCost>>();
  const cost = (code: number, date: string) => {
    const key = `${code}|${date}`;
    if (!cache.has(key)) cache.set(key, unitCost(ds, code, date));
    return cache.get(key)!;
  };
  const rows = ds.products
    .map((p) => {
      const sales = ds.sales.filter((s) => s.code === p.code);
      const units = sales.reduce((s, x) => s + x.qty, 0);
      const netRevenue = sales.reduce((s, x) => s + netOf(x.amount, x.vatRate), 0);
      const costOfGoods = sales.reduce((s, x) => s + x.qty * cost(x.code, x.date).cost, 0);
      const now = cost(p.code, end);
      const missing = [...new Set(sales.flatMap((x) => cost(x.code, x.date).missing))];
      const grossProfit = netRevenue - costOfGoods;
      return {
        id: `PROFIT-${p.code}`,
        rank: 0,
        code: p.code,
        name: p.name,
        units,
        netRevenue: round2(netRevenue),
        costOfGoods: round2(costOfGoods),
        grossProfit: round2(grossProfit),
        marginPct: netRevenue ? round2((grossProfit / netRevenue) * 100) : 0,
        avgProfitPerUnit: units ? round2(grossProfit / units) : 0,
        currentProfitPerUnit: round2(netOf(p.price, p.vatRate) - now.cost),
        costMissing: missing,
        sources: [
          ...(sales.length ? [`${FILES.sales}:${sales[0]!.line}..${sales.at(-1)!.line} (${sales.length} rows)`] : []),
          ...now.sources,
        ],
      };
    })
    .filter((r) => r.units !== 0)
    .sort((a, b) => b.grossProfit - a.grossProfit);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export interface ComparisonRow {
  id: string; // CMP-<code>
  code: number;
  name: string;
  basis: string; // which equivalent periods are compared
  previous: number;
  latest: number;
  changePct: number | null;
  flag: 'rising' | 'falling' | 'stable' | 'too few sales';
  sources: string[];
}

// Last full 7-day week vs the week before (equivalent periods). Months are not
// compared: the data has 5 days of November and 25 of December.
export function periodComparison(ds: Dataset): { rows: ComparisonRow[]; monthly: { comparable: boolean; reason: string } } {
  const periods = salesByPeriod(ds);
  const weeks = [...new Set(periods.filter((p) => p.period === 'week' && p.days === 7).map((p) => p.key))].sort(
    (a, b) => Number(a.slice(1).split(' ')[0]) - Number(b.slice(1).split(' ')[0])
  );
  const months = [...new Set(periods.filter((p) => p.period === 'month').map((p) => `${p.key} (${p.days} days)`))];
  const monthDays = new Set(periods.filter((p) => p.period === 'month').map((p) => p.days));
  const monthly = monthDays.size <= 1 && months.length > 1
    ? { comparable: true, reason: `months cover the same number of days: ${months.join(', ')}` }
    : { comparable: false, reason: `months are not equivalent periods: ${months.join(', ')}` };

  if (weeks.length < 2) return { rows: [], monthly };
  const [prevKey, lastKey] = weeks.slice(-2) as [string, string];
  const rows = ds.products.map((p) => {
    const prev = periods.find((x) => x.period === 'week' && x.key === prevKey && x.code === p.code);
    const last = periods.find((x) => x.period === 'week' && x.key === lastKey && x.code === p.code);
    const previous = prev?.units ?? 0;
    const latest = last?.units ?? 0;
    const changePct = previous ? round2(((latest - previous) / previous) * 100) : null;
    const flag: ComparisonRow['flag'] =
      previous < PLANNING_RULES.trendMinUnits
        ? 'too few sales'
        : changePct! >= PLANNING_RULES.trendChangePct
          ? 'rising'
          : changePct! <= -PLANNING_RULES.trendChangePct
            ? 'falling'
            : 'stable';
    return {
      id: `CMP-${p.code}`,
      code: p.code,
      name: p.name,
      basis: `${lastKey} vs ${prevKey}`,
      previous,
      latest,
      changePct,
      flag,
      sources: [prev?.source, last?.source].filter((s): s is string => !!s),
    };
  });
  return { rows, monthly };
}

// ---------------------------------------------------------------------------
// 2. Lots, expiry risk and promotion candidates

// A delivered lot: from a verified delivery-note line, or a purchase-register
// row with no delivery note (expiry then unknown).
export interface Lot {
  material: string;
  noteNo: string;
  deliveryDate: string;
  expiryDate: string | null;
  quantity: number; // in recipe units (g, l, kom)
  source: string;
}

export interface NoteLot {
  noteNo: string;
  deliveryDate: string;
  code: string;
  quantity: number;
  expiryDate: string; // '' if not printed
  source: string;
}

// Lots per material from verified delivery-note lines, plus register deliveries
// whose delivery note isn't available (expiry unknown).
export function buildLots(ds: Dataset, noteLots: NoteLot[]): { lots: Lot[]; unmatched: NoteLot[] } {
  const lots: Lot[] = [];
  const unmatched: NoteLot[] = [];
  const notes = new Set(noteLots.map((l) => l.noteNo));
  for (const nl of noteLots) {
    const m = [...ds.materials.values()].find((x) => x.supplierCodes.includes(nl.code));
    if (!m) {
      unmatched.push(nl); // bought but not used by any recipe (e.g. butter)
      continue;
    }
    lots.push({ material: m.key, noteNo: nl.noteNo, deliveryDate: nl.deliveryDate, expiryDate: nl.expiryDate || null, quantity: nl.quantity * m.factor, source: nl.source });
  }
  for (const p of ds.purchases) {
    if (notes.has(p.noteNo)) continue;
    const m = [...ds.materials.values()].find((x) => matches(x, p));
    if (!m) continue;
    lots.push({ material: m.key, noteNo: p.noteNo || p.invoiceNo, deliveryDate: p.date, expiryDate: null, quantity: p.qty * m.factor, source: ref(FILES.purchases, p.line) });
  }
  return { lots, unmatched };
}

// Recipe consumption per material and day (refunds net out within the day).
export function dailyDemand(ds: Dataset): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const s of ds.sales) {
    for (const part of ds.recipes.get(s.code) ?? []) {
      const byDay = out.get(part.material) ?? new Map<string, number>();
      byDay.set(s.date, (byDay.get(s.date) ?? 0) + s.qty * part.qty);
      out.set(part.material, byDay);
    }
  }
  return out;
}

export interface DemandStats {
  avgDaily: number;
  cv: number | null; // coefficient of variation of daily demand
  days: number;
}

// Average daily demand over the trailing window ending at `asOf`.
export function demandStats(byDay: Map<string, number> | undefined, asOf: string, windowDays = PLANNING_RULES.demandWindowDays): DemandStats {
  const values = Array.from({ length: windowDays }, (_, i) => Math.max(0, byDay?.get(addDays(asOf, -i)) ?? 0));
  const avg = values.reduce((s, v) => s + v, 0) / windowDays;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / windowDays);
  return { avgDaily: avg, cv: avg > 0 ? sd / avg : null, days: windowDays };
}

export type LotStatus = 'used_up' | 'expired_on_arrival' | 'expired_unsold' | 'at_risk' | 'ok' | 'beyond_horizon' | 'unknown_expiry';

export interface LotRow {
  id: string; // LOT-<note>-<material>
  item: string;
  unit: string;
  noteNo: string;
  deliveryDate: string;
  expiryDate: string | null;
  delivered: number;
  usedByAsOf: number; // book estimate (recipes × sales, earliest expiry first)
  remainingAsOf: number; // book estimate, no physical count
  status: LotStatus;
  daysToExpiry: number | null;
  avgDailyDemand: number; // forecast basis
  projectedSold: number | null; // forecast
  projectedLeftover: number | null; // forecast: book stock left when the lot expires
  costAtRisk: number | null; // projected or actual leftover × purchase cost (excl. VAT)
  kind: Kind;
  sources: string[];
}

// Allocates demand to lots earliest-expiry-first (only lots already delivered
// and not expired), first over the actual sales up to `asOf`, then forward at
// the trailing average demand to forecast what will be left at each expiry.
export function lotRisk(ds: Dataset, lots: Lot[], asOf = ds.sales.at(-1)!.date): { rows: LotRow[]; uncovered: Map<string, number> } {
  const demand = dailyDemand(ds);
  const first = ds.sales[0]!.date;
  const uncovered = new Map<string, number>();
  const rows: LotRow[] = [];
  const priceOf = (m: Material, date: string) =>
    ds.purchases.filter((p) => matches(m, p) && p.date <= date).sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line).at(-1);

  for (const material of new Set(lots.map((l) => l.material))) {
    const m = ds.materials.get(material)!;
    const own = lots.filter((l) => l.material === material).map((l) => ({ ...l, left: l.quantity, usedByAsOf: 0, projectedSold: 0 }));
    const order = () => own.slice().sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999') || a.deliveryDate.localeCompare(b.deliveryDate));
    const take = (date: string, qty: number, actual: boolean) => {
      let need = qty;
      for (const l of order()) {
        if (need <= 1e-9) break;
        if (l.deliveryDate > date || (l.expiryDate !== null && l.expiryDate < date) || l.left <= 1e-9) continue;
        const used = Math.min(l.left, need);
        l.left -= used;
        need -= used;
        if (actual) l.usedByAsOf += used;
        else l.projectedSold += used;
      }
      return need;
    };

    for (let d = first; d <= asOf; d = addDays(d, 1)) {
      const short = take(d, Math.max(0, demand.get(material)?.get(d) ?? 0), true);
      if (short > 1e-9) uncovered.set(material, (uncovered.get(material) ?? 0) + short);
    }
    const stats = demandStats(demand.get(material), asOf);
    const remaining = new Map(own.map((l) => [l, l.left]));
    for (let i = 1; i <= PLANNING_RULES.forecastHorizonDays; i++) take(addDays(asOf, i), stats.avgDaily, false);

    for (const l of own) {
      const rem = remaining.get(l)!;
      const unitCostNow = (priceOf(m, l.deliveryDate)?.price ?? 0) / m.factor;
      const days = l.expiryDate ? daysBetween(asOf, l.expiryDate) : null;
      let status: LotStatus;
      if (l.expiryDate && l.expiryDate < l.deliveryDate) status = 'expired_on_arrival';
      else if (rem <= 1e-9) status = 'used_up';
      else if (l.expiryDate === null) status = 'unknown_expiry';
      else if (l.expiryDate <= asOf) status = 'expired_unsold';
      else if (days! > PLANNING_RULES.forecastHorizonDays) status = 'beyond_horizon';
      else status = l.left > 1e-9 ? 'at_risk' : 'ok';
      const forecast = status === 'at_risk' || status === 'ok';
      const leftover = status === 'expired_on_arrival' || status === 'expired_unsold' ? rem : forecast ? l.left : null;
      rows.push({
        id: `LOT-${l.noteNo.replace(/[^A-Za-z0-9_-]+/g, '_')}-${materialId(m)}`,
        item: m.noteName,
        unit: m.unit,
        noteNo: l.noteNo,
        deliveryDate: l.deliveryDate,
        expiryDate: l.expiryDate,
        delivered: round2(l.quantity),
        usedByAsOf: round2(l.usedByAsOf),
        remainingAsOf: round2(rem),
        status,
        daysToExpiry: days,
        avgDailyDemand: round2(stats.avgDaily),
        projectedSold: forecast ? round2(l.projectedSold) : null,
        projectedLeftover: leftover === null ? null : round2(leftover),
        costAtRisk: leftover ? round2(leftover * unitCostNow) : null,
        kind: forecast ? 'forecast' : 'fact',
        sources: [l.source, `${FILES.sales} (recipe use, ${FILES.recipes})`],
      });
    }
  }
  return { rows, uncovered };
}

export interface PromotionRow {
  id: string; // PROMO-<lot>
  lotId: string;
  item: string;
  products: string[]; // menu items that use this stock
  action: string;
  unitsAtRisk: number;
  unit: string;
  costAtRisk: number; // write-off at cost if nothing changes (forecast)
  requiredDailySales: number; // to clear the lot before expiry
  currentDailySales: number;
  requiredUpliftPct: number | null;
  maxDiscountPct: number | null; // price can drop this much before a unit sells below cost (single-item products)
  netPricePerUnit: number | null;
  costPerUnit: number | null;
  kind: Kind;
  limitations: string[];
  sources: string[];
}

// Promotion candidates only for lots forecast to expire with stock left. The
// data has no promotion history, so no discount's effect on volume is
// estimated: the row gives the stock at risk, the sales rate needed to clear
// it, and how far the price can drop before a unit sells below cost.
export function promotionCandidates(ds: Dataset, lotRows: LotRow[]): PromotionRow[] {
  const end = ds.sales.at(-1)!.date;
  return lotRows
    .filter((l) => l.status === 'at_risk' && (l.projectedLeftover ?? 0) >= 1 && l.daysToExpiry !== null && l.daysToExpiry > 0)
    .map((l) => {
      const material = [...ds.materials.values()].find((m) => m.noteName === l.item)!;
      const using = ds.products.filter((p) => (ds.recipes.get(p.code) ?? []).some((c) => c.material === material.key));
      const single = using.length === 1 && (ds.recipes.get(using[0]!.code) ?? []).length === 1 ? using[0]! : undefined;
      const netPrice = single ? netOf(single.price, single.vatRate) : null;
      const cost = single ? unitCost(ds, single.code, end).cost : null;
      const requiredDaily = l.remainingAsOf / l.daysToExpiry!;
      const maxDiscount = netPrice && cost !== null && netPrice > cost ? ((netPrice - cost) / netPrice) * 100 : null;
      const action = single
        ? maxDiscount
          ? `Time-boxed promotion or bundle on ${single.name} before ${l.expiryDate}; any discount up to ${round2(maxDiscount)}% stays above cost`
          : `Sell or return before ${l.expiryDate}; no margin room for a discount`
        : `Feature drinks that use ${l.item} (${using.map((p) => p.name).join(', ')}) before ${l.expiryDate}`;
      return {
        id: `PROMO-${l.id.slice(4)}`,
        lotId: l.id,
        item: l.item,
        products: using.map((p) => p.name),
        action,
        unitsAtRisk: l.projectedLeftover!,
        unit: l.unit,
        costAtRisk: l.costAtRisk ?? 0,
        requiredDailySales: round2(requiredDaily),
        currentDailySales: l.avgDailyDemand,
        requiredUpliftPct: l.avgDailyDemand > 0 ? round2((requiredDaily / l.avgDailyDemand - 1) * 100) : null,
        maxDiscountPct: maxDiscount === null ? null : round2(maxDiscount),
        netPricePerUnit: netPrice === null ? null : round2(netPrice),
        costPerUnit: cost === null ? null : round2(cost),
        kind: 'recommendation',
        limitations: [
          'No promotion history: the effect of a discount on sales volume is not estimated.',
          'Stock is a book estimate (deliveries − recipe use); no physical count.',
        ],
        sources: l.sources,
      };
    });
}

// ---------------------------------------------------------------------------
// 3. Replenishment

export interface PlanningParams {
  synthetic: boolean;
  leadTimeDays: Record<string, number>; // per supplier name (as in the purchase register)
  safetyStockDays: number;
  reviewPeriodDays: number;
}

export interface ReplenishmentRow {
  id: string; // REPL-<material>
  item: string;
  unit: string;
  purchaseUnit: string;
  supplier: string;
  bookStock: number; // estimate, recipe units
  avgDailyDemand: number; // forecast basis (trailing window)
  daysOfCover: number | null; // forecast
  leadTimeDays: number | null;
  reorderPoint: number | null;
  orderQuantity: number | null; // in purchase units (packs), null if it can't be estimated
  flag: 'stockout_risk' | 'overstock' | 'ok' | 'no_demand' | 'insufficient_data';
  confidence: Confidence;
  missing: string[];
  kind: Kind;
  sources: string[];
}

// Order proposal per material:
//   reorder point = average daily demand × (lead time + safety stock days)
//   order quantity = demand × (lead time + review period + safety days) − book stock, rounded up to whole purchase units
// Only computed when lead time and safety stock are given; otherwise the row
// says what is missing.
export function replenishment(ds: Dataset, lotRows: LotRow[], params: PlanningParams | null, uncovered: Map<string, number>, asOf = ds.sales.at(-1)!.date): ReplenishmentRow[] {
  const demand = dailyDemand(ds);
  return [...ds.materials.values()]
        .filter((m) => demand.has(m.key))
        .map((m) => {
          const lots = lotRows.filter((l) => l.item === m.noteName);
          const live = lots.filter((l) => l.status !== 'expired_on_arrival' && l.status !== 'expired_unsold');
          const bookStock = live.reduce((s, l) => s + l.remainingAsOf, 0);
          const stats = demandStats(demand.get(m.key), asOf);
          const latest = ds.purchases.filter((p) => matches(m, p)).at(-1);
          const supplier = latest?.supplier ?? '?';
          const lead = params?.leadTimeDays[supplier] ?? null;
          const missing = ['physical stock count (book stock is deliveries − recipe use)'];
          if (params?.synthetic) missing.push(`real lead time and safety stock (${FILES.planning} is synthetic)`);
          if (lead === null) missing.push(`lead time for ${supplier}`);
          if (!params) missing.push('safety stock and review period');
          if (uncovered.get(m.key)) missing.push(`${m.noteName}: ${round2(uncovered.get(m.key)!)} ${m.unit} sold without a recorded delivery`);
          const cover = stats.avgDaily > 0 ? bookStock / stats.avgDaily : null;
          // Never "high": stock is a book estimate and the history is only 30 days.
          const confidence: Confidence = stats.cv === null || stats.cv > 1 || lead === null || uncovered.get(m.key) ? 'low' : 'medium';
          let flag: ReplenishmentRow['flag'];
          let reorderPoint: number | null = null;
          let orderQuantity: number | null = null;
          if (stats.avgDaily <= 0) flag = 'no_demand';
          else if (lead === null || !params) flag = 'insufficient_data';
          else {
            reorderPoint = stats.avgDaily * (lead + params.safetyStockDays);
            const target = stats.avgDaily * (lead + params.reviewPeriodDays + params.safetyStockDays);
            orderQuantity = bookStock < reorderPoint ? Math.ceil((target - bookStock) / m.factor) : 0;
            flag = bookStock < reorderPoint ? 'stockout_risk' : cover! > PLANNING_RULES.overstockCoverDays ? 'overstock' : 'ok';
          }
          if (flag === 'insufficient_data' && cover !== null && cover > PLANNING_RULES.overstockCoverDays) flag = 'overstock';
          return {
            id: `REPL-${materialId(m)}`,
            item: m.noteName,
            unit: m.unit,
            purchaseUnit: latest?.unit ?? '?',
            supplier,
            bookStock: round2(bookStock),
            avgDailyDemand: round2(stats.avgDaily),
            daysOfCover: cover === null ? null : round2(cover),
            leadTimeDays: lead,
            reorderPoint: reorderPoint === null ? null : round2(reorderPoint),
            orderQuantity,
            flag,
            confidence,
            missing,
            kind: orderQuantity === null ? 'forecast' : 'recommendation',
            sources: [...new Set([...lots.flatMap((l) => l.sources), ...(lead !== null ? [FILES.planning] : [])])].slice(0, 7),
          };
        });
}

// ---------------------------------------------------------------------------
// CSV outputs (same conventions as the payment draft: `;`, comma decimals)

const csvCell = (v: unknown) => {
  const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header: string[], rows: unknown[][], note: string) =>
  [`# ${note}`, header.join(';'), ...rows.map((r) => r.map(csvCell).join(';'))].join('\n') + '\n';

export interface RecommendationLine {
  kind: Kind;
  type: string;
  item: string;
  action: string;
  quantity: number | '';
  unit: string;
  rationale: string;
  confidence: Confidence | '';
  source: string;
  limitations: string;
}

// One row per lot problem, promotion candidate and replenishment flag.
export function recommendationLines(lots: LotRow[], promos: PromotionRow[], repl: ReplenishmentRow[]): RecommendationLine[] {
  const lines: RecommendationLine[] = [];
  for (const l of lots.filter((x) => x.status === 'expired_on_arrival' || x.status === 'expired_unsold')) {
    lines.push({
      kind: 'fact',
      type: l.status,
      item: l.item,
      action: l.status === 'expired_on_arrival' ? `Claim credit from the supplier for lot ${l.noteNo}` : `Check shelf and write off or return lot ${l.noteNo}`,
      quantity: l.remainingAsOf,
      unit: l.unit,
      rationale: `delivered ${l.delivered} ${l.unit} on ${l.deliveryDate}, expiry ${l.expiryDate}, ${l.remainingAsOf} ${l.unit} not used by recipes (cost ${l.costAtRisk ?? 0} RSD)`,
      confidence: '',
      source: l.sources.join(' | '),
      limitations: 'Book estimate (no physical count); refunds net out within a day.',
    });
  }
  for (const p of promos) {
    lines.push({
      kind: 'recommendation',
      type: 'promotion_candidate',
      item: p.item,
      action: p.action,
      quantity: p.unitsAtRisk,
      unit: p.unit,
      rationale: `forecast ${p.unitsAtRisk} ${p.unit} unsold at expiry (cost ${p.costAtRisk} RSD); needs ${p.requiredDailySales}/day vs ${p.currentDailySales}/day now`,
      confidence: 'low',
      source: p.sources.join(' | '),
      limitations: p.limitations.join(' '),
    });
  }
  for (const r of repl.filter((x) => x.flag !== 'ok')) {
    lines.push({
      kind: r.orderQuantity === null ? 'forecast' : 'recommendation',
      type: r.flag,
      item: r.item,
      action:
        r.flag === 'stockout_risk' && r.orderQuantity
          ? `Order ${r.orderQuantity} ${r.purchaseUnit} from ${r.supplier}`
          : r.flag === 'overstock'
            ? 'Pause reordering; use existing stock first'
            : r.flag === 'no_demand'
              ? 'No recent sales: review whether to keep on the menu'
              : 'Cannot propose a quantity: data missing',
      quantity: r.orderQuantity ?? '',
      unit: r.orderQuantity === null ? '' : r.purchaseUnit,
      rationale: `book stock ${r.bookStock} ${r.unit}, average ${r.avgDailyDemand} ${r.unit}/day over ${PLANNING_RULES.demandWindowDays} days, ${r.daysOfCover ?? '–'} days of cover${r.reorderPoint !== null ? `, reorder point ${r.reorderPoint} ${r.unit}` : ''}`,
      confidence: r.confidence,
      source: r.sources.join(' | '),
      limitations: `Missing: ${r.missing.join('; ')}`,
    });
  }
  return lines;
}

export function buildRecommendationsCsv(lines: RecommendationLine[]): string {
  return csv(
    ['kind', 'type', 'item', 'action', 'quantity', 'unit', 'rationale', 'confidence', 'source', 'limitations'],
    lines.map((l) => [l.kind, l.type, l.item, l.action, l.quantity, l.unit, l.rationale, l.confidence, l.source, l.limitations]),
    'DECISION SUPPORT – NOT SENT. Synthetic data, not financial advice. kind: fact = computed from data; forecast = projection from 14-day demand; recommendation = proposed action.'
  );
}

export function buildSalesCsv(rows: SalesPeriodRow[]): string {
  return csv(
    ['period', 'key', 'days', 'code', 'product', 'units', 'gross_revenue_incl_vat', 'net_revenue_excl_vat', 'source'],
    rows.map((r) => [r.period, r.key, r.days, r.code, r.name, r.units, r.grossRevenue, r.netRevenue, r.source]),
    'Units and revenue by product per day, 7-day week and calendar month. Synthetic data.'
  );
}
