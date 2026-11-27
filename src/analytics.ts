// Deterministic business analytics on the café dataset. The LLM analysts only
// interpret these rows; every figure they may mention comes from here, and
// every row lists the source lines it was computed from.

import { FILES, ref, type Dataset, type Material, type Purchase } from './data/load.js';

export const round2 = (n: number) => Math.round(n * 100) / 100;
const dayMs = 86_400_000;
const addDays = (date: string, days: number) => new Date(Date.parse(date) + days * dayMs).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / dayMs) + 1;
const netOf = (gross: number, vatRate: number) => gross / (1 + vatRate / 100);

const matches = (m: Material, p: Purchase) =>
  m.supplierCodes.length ? m.supplierCodes.includes(p.supplierCode) : p.name === m.noteName;

// Latest purchase of a material on or before `date` (the price in force then).
function priceRow(ds: Dataset, m: Material, date: string): Purchase | undefined {
  return ds.purchases.filter((p) => matches(m, p) && p.date <= date).sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line).at(-1);
}

// Recipe cost of one unit sold, excl. VAT: Σ recipe qty × purchase price ÷ factor.
export function unitCost(ds: Dataset, code: number, date: string): { cost: number; sources: string[]; missing: string[] } {
  let cost = 0;
  const sources: string[] = [];
  const missing: string[] = [];
  for (const part of ds.recipes.get(code) ?? []) {
    const m = ds.materials.get(part.material);
    const row = m && priceRow(ds, m, date);
    if (!m || !row) {
      missing.push(part.material);
      continue;
    }
    cost += (part.qty * row.price) / m.factor;
    sources.push(ref(FILES.purchases, row.line));
  }
  return { cost, sources, missing };
}

export interface StockRow {
  id: string;
  item: string;
  unit: string;
  delivered: number;
  used: number;
  remaining: number;
  oversold: boolean;
  firstOversell?: { line: number; receipt: string; date: string; time: string; used: number; delivered: number };
  sources: string[];
}

// Recipe consumption vs deliveries received so far (the purchase register
// carries the delivered quantities). Selling more than was delivered means
// stock is missing from the books.
export function stockCheck(ds: Dataset): StockRow[] {
  const used = new Map<string, number>();
  const firstOversell = new Map<string, StockRow['firstOversell']>();
  const deliveredBy = (m: Material, date: string) =>
    ds.purchases.filter((p) => matches(m, p) && p.date <= date).reduce((sum, p) => sum + p.qty * m.factor, 0);

  for (const sale of ds.sales) {
    for (const part of ds.recipes.get(sale.code) ?? []) {
      const total = (used.get(part.material) ?? 0) + sale.qty * part.qty;
      used.set(part.material, total);
      const m = ds.materials.get(part.material);
      if (!m || firstOversell.has(part.material)) continue;
      const delivered = deliveredBy(m, sale.date);
      if (total > delivered + 1e-9) {
        firstOversell.set(part.material, { line: sale.line, receipt: sale.receipt, date: sale.date, time: sale.time, used: round2(total), delivered: round2(delivered) });
      }
    }
  }

  return [...used.entries()].map(([key, usedQty]) => {
    const m = ds.materials.get(key)!;
    const deliveries = ds.purchases.filter((p) => matches(m, p));
    const delivered = deliveries.reduce((sum, p) => sum + p.qty * m.factor, 0);
    const first = firstOversell.get(key);
    return {
      // Raw materials by key (STOCK-kafa_espresso), bottled items by supplier code (STOCK-OPT-STW-025).
      id: `STOCK-${m.key === m.noteName ? (m.supplierCodes[0] ?? m.key) : m.key}`,
      item: m.noteName,
      unit: m.unit,
      delivered: round2(delivered),
      used: round2(usedQty),
      remaining: round2(delivered - usedQty),
      oversold: first !== undefined,
      ...(first ? { firstOversell: first } : {}),
      sources: [...deliveries.map((p) => ref(FILES.purchases, p.line)), ...(first ? [ref(FILES.sales, first.line)] : [])],
    };
  });
}

export interface TrendRow {
  id: string;
  code: number;
  name: string;
  weeks: number[]; // full 7-day weeks from the first sales day
  partialWeek: number;
  changePct: number | null; // last full week vs first
  priceUnchanged: boolean;
  flagged: boolean;
  sources: string[];
}

// Flag: ≥ 20 sold in week 1, last full week down ≥ 50 %, price never changed.
export function weeklyTrend(ds: Dataset): TrendRow[] {
  const start = ds.sales[0]!.date;
  const fullWeeks = Math.floor(daysBetween(start, ds.sales.at(-1)!.date) / 7);
  return ds.products.map((p) => {
    const rows = ds.sales.filter((s) => s.code === p.code);
    const weeks = Array<number>(fullWeeks).fill(0);
    let partialWeek = 0;
    for (const s of rows) {
      const week = Math.floor((daysBetween(start, s.date) - 1) / 7);
      if (week < fullWeeks) weeks[week] = (weeks[week] ?? 0) + s.qty;
      else partialWeek += s.qty;
    }
    const first = weeks[0]!;
    const last = weeks.at(-1)!;
    const changePct = first ? round2(((last - first) / first) * 100) : null;
    const priceUnchanged = new Set(rows.map((s) => s.unitPrice)).size <= 1;
    return {
      id: `TREND-${p.code}`,
      code: p.code,
      name: p.name,
      weeks,
      partialWeek,
      changePct,
      priceUnchanged,
      flagged: first >= 20 && changePct !== null && changePct <= -50 && priceUnchanged,
      sources: rows.length ? [`${FILES.sales}:${rows[0]!.line}..${rows.at(-1)!.line} (${rows.length} rows, code ${p.code})`] : [],
    };
  });
}

export interface PriceChangeRow {
  id: string;
  item: string;
  date: string;
  invoiceNo: string;
  from: number;
  to: number;
  changePct: number;
  sources: string[];
}

// First purchase-price increase per material and supplier (excl. VAT).
// Compared per supplier code: two suppliers' list prices are not a price rise.
export function priceChanges(ds: Dataset): PriceChangeRow[] {
  const rows: PriceChangeRow[] = [];
  for (const m of ds.materials.values()) {
    const codes = [...new Set(ds.purchases.filter((p) => matches(m, p)).map((p) => p.supplierCode))];
    for (const code of codes) {
      const history = ds.purchases.filter((p) => matches(m, p) && p.supplierCode === code).sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line);
      for (let i = 1; i < history.length; i++) {
        const before = history[i - 1]!;
        const after = history[i]!;
        if (after.price > before.price) {
          rows.push({
            id: `PRICE-${m.key}${codes.length > 1 ? `-${code}` : ''}`,
            item: m.noteName,
            date: after.date,
            invoiceNo: after.invoiceNo,
            from: before.price,
            to: after.price,
            changePct: round2(((after.price - before.price) / before.price) * 100),
            sources: [ref(FILES.purchases, before.line), ref(FILES.purchases, after.line)],
          });
          break;
        }
      }
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

// The analysis splits the period at the first supplier price rise.
export const splitDate = (ds: Dataset) => priceChanges(ds)[0]?.date ?? ds.sales.at(-1)!.date;

export interface MarginRow {
  id: string;
  code: number;
  name: string;
  netPrice: number;
  costBefore: number;
  costAfter: number;
  marginBeforePct: number;
  marginAfterPct: number;
  flagged: boolean;
  sources: string[];
}

// Margin % = (price excl. VAT − recipe cost) ÷ price excl. VAT, before the
// split vs at the end of the period. Flag a drop of at least 1 point.
export function unitMargins(ds: Dataset, split = splitDate(ds)): MarginRow[] {
  const beforeDate = addDays(split, -1);
  const endDate = ds.sales.at(-1)!.date;
  return ds.products.map((p) => {
    const netPrice = netOf(p.price, p.vatRate);
    const before = unitCost(ds, p.code, beforeDate);
    const after = unitCost(ds, p.code, endDate);
    const marginBeforePct = ((netPrice - before.cost) / netPrice) * 100;
    const marginAfterPct = ((netPrice - after.cost) / netPrice) * 100;
    return {
      id: `MARGIN-${p.code}`,
      code: p.code,
      name: p.name,
      netPrice: round2(netPrice),
      costBefore: round2(before.cost),
      costAfter: round2(after.cost),
      marginBeforePct: round2(marginBeforePct),
      marginAfterPct: round2(marginAfterPct),
      // Only compare when every ingredient had a purchase price on both dates.
      flagged: !before.missing.length && !after.missing.length && marginBeforePct - marginAfterPct >= 1,
      sources: [...new Set([...before.sources, ...after.sources])],
    };
  });
}

export interface PnlRow {
  id: string;
  period: string;
  from: string;
  to: string;
  days: number;
  netSales: number;
  cogs: number;
  grossMargin: number;
  fixedCosts: number;
  costMonth: string;
  monthlyResult: number;
  formula: string;
  sources: string[];
}

export interface CostChangeRow {
  id: string;
  category: string;
  before: number;
  after: number;
  delta: number;
  sources: string[];
}

// Monthly result run-rate = (gross margin ÷ days) × 30 − that month's fixed
// costs (excl. VAT). Net sales include refunds; COGS uses the recipe cost in
// force on each sale date.
export function periodResult(ds: Dataset, split = splitDate(ds)): { pnl: PnlRow[]; costChanges: CostChangeRow[] } {
  const first = ds.sales[0]!.date;
  const last = ds.sales.at(-1)!.date;
  const periods = [
    { id: 'PNL-BEFORE', period: 'before price rise', from: first, to: addDays(split, -1) },
    { id: 'PNL-AFTER', period: 'after price rise', from: split, to: last },
  ];
  const costCache = new Map<string, number>();
  const costOf = (code: number, date: string) => {
    const key = `${code}|${date}`;
    if (!costCache.has(key)) costCache.set(key, unitCost(ds, code, date).cost);
    return costCache.get(key)!;
  };

  const pnl = periods.map(({ id, period, from, to }) => {
    const rows = ds.sales.filter((s) => s.date >= from && s.date <= to);
    const netSales = rows.reduce((sum, s) => sum + netOf(s.amount, s.vatRate), 0);
    const cogs = rows.reduce((sum, s) => sum + s.qty * costOf(s.code, s.date), 0);
    const days = daysBetween(from, to);
    const costMonth = from.slice(0, 7);
    const monthCosts = ds.costs.filter((c) => c.month === costMonth);
    const fixedCosts = monthCosts.reduce((sum, c) => sum + c.net, 0);
    const grossMargin = netSales - cogs;
    return {
      id,
      period,
      from,
      to,
      days,
      netSales: round2(netSales),
      cogs: round2(cogs),
      grossMargin: round2(grossMargin),
      fixedCosts: round2(fixedCosts),
      costMonth,
      monthlyResult: round2((grossMargin / days) * 30 - fixedCosts),
      formula: `(${round2(grossMargin)} / ${days}) × 30 − ${round2(fixedCosts)}`,
      sources: [
        `${FILES.sales}:${rows[0]!.line}..${rows.at(-1)!.line} (${rows.length} rows)`,
        ...monthCosts.map((c) => ref(FILES.costs, c.line)),
      ],
    };
  });

  const [before, after] = pnl.map((p) => ds.costs.filter((c) => c.month === p.costMonth));
  const categories = [...new Set([...before!, ...after!].map((c) => c.category))];
  const costChanges = categories
    .map((category) => {
      const b = before!.filter((c) => c.category === category);
      const a = after!.filter((c) => c.category === category);
      const sum = (rows: typeof b) => rows.reduce((s, c) => s + c.net, 0);
      return {
        id: `COST-${category}`,
        category,
        before: round2(sum(b)),
        after: round2(sum(a)),
        delta: round2(sum(a) - sum(b)),
        sources: [...b, ...a].map((c) => ref(FILES.costs, c.line)),
      };
    })
    .filter((c) => c.delta !== 0);

  return { pnl, costChanges };
}
