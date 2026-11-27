import type { Recipes } from './recipes.js';
import { SALES_FILE_NAME, type SaleRow } from './sales.js';

/** Expiring within this many days of the stock date raises the "expiring soon" alarm. */
export const EXPIRY_ALARM_DAYS = 60;
/** Average daily use is taken over this many days before the stock date (the sales export covers 30 days). */
export const USAGE_WINDOW_DAYS = 14;

/** One confirmed receipt line: goods that came in. */
export interface Lot {
  itemId: number;
  receiptId: number;
  receipt: string;
  deliveryNote: string;
  /** Delivery date: the delivery note's date. */
  receivedOn: string;
  supplierCode: string | null;
  name: string;
  unit: string | null;
  quantity: number;
  expiry: string | null;
  /** Where the delivered quantity was read, e.g. "otpremnice/otpremnica-04-sokovi.pdf:16". */
  source: string;
}

export type IssueKind = 'shortage' | 'expired_on_receipt' | 'expired_with_stock' | 'expiring_soon';

export interface StockIssue {
  /** Stable key, used so the same issue is not recorded twice. */
  key: string;
  kind: IssueKind;
  name: string;
  unit: string | null;
  /** shortage: total received up to the stock date; otherwise the lot's received quantity. */
  received: number;
  /** shortage: net quantity sold up to the stock date. */
  sold?: number;
  /** shortage: sold beyond the valid stock. */
  over?: number;
  /** shortage: the first sale that went beyond the stock. */
  firstSaleOverStock?: { row: number; date: string; time: string; receiptNumber: string };
  /** Lot issues: the quantity still on stock (at expiry for expired lots). */
  remaining?: number;
  expiry?: string;
  receivedOn?: string;
  daysLeft?: number;
  /** expiring_soon: average daily use over the last USAGE_WINDOW_DAYS days, and an estimate of what will be left. */
  dailyUse?: number;
  projectedLeftover?: number;
  projectionFormula?: string;
  receiptId: number;
  itemId: number;
  sources: string[];
}

export type LotStatus = 'OK' | 'ISTICE_USKORO' | 'ISTEKLO' | 'ISTEKLO_PRI_PRIJEMU' | 'BEZ_ROKA';

/** One received lot in the stock overview: what came in, what is left and how its expiry stands. */
export interface LotOverview {
  /** The article's name as delivered. */
  name: string;
  unit: string | null;
  receipt: string;
  receivedOn: string;
  received: number;
  /** Still on stock as of the stock date (FIFO by expiry over the sales; unsold goods keep the full quantity). */
  remaining: number;
  expiry: string | null;
  /** Days from the stock date to expiry; negative once expired, null without an expiry date. */
  daysLeft: number | null;
  status: LotStatus;
  /** False when no sold article uses this item (no recipe), so sales never reduce it. */
  usedBySales: boolean;
  source: string;
}

export interface StockCheck {
  asOf: string;
  issues: StockIssue[];
  /** Every lot received up to the stock date, first-expiring first. */
  overview: LotOverview[];
  /** Stock items that were sold but have no confirmed receipt at all: their stock is unknown. */
  soldWithoutReceipt: { name: string; sold: number }[];
  /** Sold articles with no recipe in normativi.json. */
  articlesWithoutRecipe: { articleCode: number; name: string }[];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const EPSILON = 0.0005;

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The numbers a stock issue is recorded with as a finding (nalaz): what was expected and what was found. */
export function stockFindingValues(issue: StockIssue): {
  type: 'MANJAK' | 'ROK';
  expected: number | null;
  actual: number | null;
} {
  if (issue.kind === 'shortage') return { type: 'MANJAK', expected: issue.received, actual: issue.sold ?? null };
  return { type: 'ROK', expected: issue.kind === 'expired_on_receipt' ? null : 0, actual: issue.remaining ?? null };
}

/** The stock date a finding's key carries ("ROK|expiring_soon|13|2026-12-25"), if any. */
export function stockDateOfKey(key: string): string | undefined {
  const last = key.split('|').at(-1) ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(last) ? last : undefined;
}

/** How a lot's expiry stands on the stock date, by dates only (the quantity left is shown next to it). */
function lotStatus(lot: Lot, asOf: string): LotStatus {
  if (lot.expiry === null) return 'BEZ_ROKA';
  if (lot.expiry < lot.receivedOn) return 'ISTEKLO_PRI_PRIJEMU';
  if (lot.expiry < asOf) return 'ISTEKLO';
  if (lot.expiry <= addDays(asOf, EXPIRY_ALARM_DAYS)) return 'ISTICE_USKORO';
  return 'OK';
}

const lotSource = (lot: Lot) => `${lot.receipt}, primljeno ${lot.quantity} (${lot.source})`;
const saleSource = (row: number) => `${SALES_FILE_NAME}:${row}`;

/**
 * The stock of every item with a confirmed receipt, as of `asOf` (inclusive), and what is wrong with it.
 *
 * Goods go out first-expiring-first, and only while not expired. A sale that finds no valid goods
 * left is a shortage. Whatever a lot still holds when it expires has to be written off.
 */
export function checkStock(lots: readonly Lot[], sales: readonly SaleRow[], recipes: Recipes, asOf: string): StockCheck {
  // Sales up to the stock date, turned into stock item use.
  const useByItem = new Map<string, { sale: SaleRow; quantity: number }[]>();
  const articlesWithoutRecipe = new Map<number, string>();
  for (const sale of sales) {
    if (sale.date > asOf) continue;
    const components = recipes.componentsOf(sale.articleCode);
    if (!components) {
      articlesWithoutRecipe.set(sale.articleCode, sale.name);
      continue;
    }
    for (const { key, perUnit } of components) {
      const list = useByItem.get(key) ?? [];
      list.push({ sale, quantity: sale.quantity * perUnit });
      useByItem.set(key, list);
    }
  }

  // Lots received up to the stock date, by stock item. What is left of each lot starts at its received quantity.
  const receivedLots = lots.filter((lot) => lot.receivedOn <= asOf);
  const remaining = new Map<Lot, number>(receivedLots.map((lot) => [lot, lot.quantity]));
  const lotsByItem = new Map<string, Lot[]>();
  const usedBySales = new Set<Lot>();
  for (const lot of receivedLots) {
    const item = recipes.stockItemFor(lot.supplierCode, lot.name);
    if (!item) continue; // received but never used by any sold article (e.g. butter)
    usedBySales.add(lot);
    const list = lotsByItem.get(item.key) ?? [];
    list.push(lot);
    lotsByItem.set(item.key, list);
  }

  const issues: StockIssue[] = [];
  const soldWithoutReceipt: { name: string; sold: number }[] = [];

  for (const [key, uses] of useByItem) {
    const itemLots = lotsByItem.get(key);
    const sold = round3(uses.reduce((sum, u) => sum + u.quantity, 0));
    if (!itemLots) {
      soldWithoutReceipt.push({ name: recipes.items.get(key)?.name ?? key, sold });
      continue;
    }

    const usable = (lot: Lot, date: string) =>
      lot.receivedOn <= date && (lot.expiry === null || (lot.expiry >= lot.receivedOn && lot.expiry >= date));
    const byExpiry = (a: Lot, b: Lot) =>
      (a.expiry ?? '9999-12-31').localeCompare(b.expiry ?? '9999-12-31') || a.receivedOn.localeCompare(b.receivedOn);

    let deficit = 0;
    let firstOver: SaleRow | undefined;
    const ordered = [...uses].sort(
      (a, b) => a.sale.date.localeCompare(b.sale.date) || a.sale.time.localeCompare(b.sale.time) || a.sale.row - b.sale.row,
    );
    for (const { sale, quantity } of ordered) {
      const available = itemLots.filter((lot) => usable(lot, sale.date)).sort(byExpiry);
      if (quantity < 0) {
        // A refund: the goods come back, first against an earlier shortage.
        let back = -quantity;
        const fromDeficit = Math.min(deficit, back);
        deficit -= fromDeficit;
        back -= fromDeficit;
        const lot = available[0];
        if (lot && back > 0) remaining.set(lot, remaining.get(lot)! + back);
        continue;
      }
      let need = quantity;
      for (const lot of available) {
        const take = Math.min(remaining.get(lot)!, need);
        remaining.set(lot, remaining.get(lot)! - take);
        need -= take;
        if (need <= EPSILON) break;
      }
      if (need > EPSILON) {
        deficit += need;
        firstOver ??= sale;
      }
    }

    const name = recipes.items.get(key)?.name ?? key;
    const first = itemLots[0]!;
    if (deficit > EPSILON && firstOver) {
      const received = round3(itemLots.reduce((sum, lot) => sum + lot.quantity, 0));
      issues.push({
        key: `MANJAK|${key}|${asOf}`,
        kind: 'shortage',
        name,
        unit: first.unit,
        received,
        sold,
        over: round3(deficit),
        firstSaleOverStock: {
          row: firstOver.row,
          date: firstOver.date,
          time: firstOver.time,
          receiptNumber: firstOver.receiptNumber,
        },
        receiptId: first.receiptId,
        itemId: first.itemId,
        sources: [
          ...itemLots.map(lotSource),
          `prodaja ${sold} do ${asOf} (${SALES_FILE_NAME}, ${uses.length} redova)`,
          `prva prodaja preko stanja: ${saleSource(firstOver.row)}`,
        ],
      });
    }

    for (const lot of itemLots) {
      const left = round3(remaining.get(lot)!);
      const base = {
        name,
        unit: lot.unit,
        received: lot.quantity,
        receiptId: lot.receiptId,
        itemId: lot.itemId,
        receivedOn: lot.receivedOn,
        sources: [lotSource(lot)],
      };
      if (lot.expiry === null) continue;

      if (lot.expiry < lot.receivedOn) {
        issues.push({
          ...base,
          key: `ROK|expired_on_receipt|${lot.itemId}`,
          kind: 'expired_on_receipt',
          expiry: lot.expiry,
          remaining: left,
        });
      } else if (lot.expiry < asOf && left > EPSILON) {
        issues.push({
          ...base,
          key: `ROK|expired_with_stock|${lot.itemId}`,
          kind: 'expired_with_stock',
          expiry: lot.expiry,
          remaining: left,
        });
      } else if (lot.expiry >= asOf && lot.expiry <= addDays(asOf, EXPIRY_ALARM_DAYS) && left > EPSILON) {
        const from = addDays(asOf, -(USAGE_WINDOW_DAYS - 1));
        const recentUse = uses.filter((u) => u.sale.date >= from).reduce((sum, u) => sum + u.quantity, 0);
        const dailyUse = round3(recentUse / USAGE_WINDOW_DAYS);
        const daysLeft = daysBetween(asOf, lot.expiry);
        issues.push({
          ...base,
          key: `ROK|expiring_soon|${lot.itemId}|${asOf}`,
          kind: 'expiring_soon',
          expiry: lot.expiry,
          remaining: left,
          daysLeft,
          dailyUse,
          projectedLeftover: round3(Math.max(0, left - dailyUse * daysLeft)),
          projectionFormula: `procena: na stanju ${left} - prosečna dnevna potrošnja ${dailyUse} (poslednjih ${USAGE_WINDOW_DAYS} dana) x ${daysLeft} dana do isteka`,
        });
      }
    }
  }

  const overview = receivedLots
    .map((lot): LotOverview => ({
      name: lot.name,
      unit: lot.unit,
      receipt: lot.receipt,
      receivedOn: lot.receivedOn,
      received: lot.quantity,
      remaining: round3(remaining.get(lot)!),
      expiry: lot.expiry,
      daysLeft: lot.expiry === null ? null : daysBetween(asOf, lot.expiry),
      status: lotStatus(lot, asOf),
      usedBySales: usedBySales.has(lot),
      source: lot.source,
    }))
    .sort((a, b) => (a.expiry ?? '9999-12-31').localeCompare(b.expiry ?? '9999-12-31') || a.name.localeCompare(b.name));

  return {
    asOf,
    issues,
    overview,
    soldWithoutReceipt,
    articlesWithoutRecipe: [...articlesWithoutRecipe].map(([articleCode, name]) => ({ articleCode, name })),
  };
}
