import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { AgreedPrice } from './purchase-prices.js';
import { PRICE_FILE_NAME } from './procurement.js';
import type { Recipes } from './recipes.js';
import { SALES_FILE_NAME, type SaleRow } from './sales.js';

export const ARTICLES_FILE_NAME = 'data/artikli.json';
export const RECIPES_FILE_NAME = 'data/normativi.json';

/** A supplier price rise above this many percent counts as a price increase. */
export const PRICE_INCREASE_MIN_PERCENT = 5;
/** A margin falling by at least this many percentage points is a finding. */
export const MARGIN_DROP_MIN_POINTS = 3;
/** Sales falling by at least this many percent from the first to the last full week are a finding... */
export const SALES_DROP_MIN_PERCENT = 50;
/** ...when the first week sold at least this many: fewer is too few to call it a trend. */
export const SALES_DROP_MIN_FIRST_WEEK = 20;

const round2 = (n: number) => Math.round(n * 100) / 100;
const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** One sold article from data/artikli.json. */
export interface Article {
  code: number;
  name: string;
  /** Selling price with VAT, RSD. */
  price: number;
  vatRate: number;
}

export function readArticles(dataDir: string): Article[] {
  const file = JSON.parse(readFileSync(path.join(dataDir, 'artikli.json'), 'utf8')) as {
    artikli: { sifra: number; naziv: string; prodajna_cena: number; pdv_stopa: number }[];
  };
  return file.artikli.map((a) => ({ code: a.sifra, name: a.naziv, price: a.prodajna_cena, vatRate: a.pdv_stopa }));
}

/** The agreed price of a stock item valid on a date: the latest row for one of its codes up to that date. */
function priceOn(prices: readonly AgreedPrice[], codes: readonly string[], date: string): AgreedPrice | undefined {
  return prices
    .filter((p) => p.supplierCode !== null && codes.includes(p.supplierCode) && p.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row)
    .at(-1);
}

export interface PriceIncrease {
  key: string;
  name: string;
  from: AgreedPrice;
  to: AgreedPrice;
  percent: number;
}

/** Supplier price increases of stock items used in recipes, from data/nabavne_cene.csv, up to a date. */
export function priceIncreases(prices: readonly AgreedPrice[], recipes: Recipes, asOf: string): PriceIncrease[] {
  const increases: PriceIncrease[] = [];
  for (const item of recipes.items.values()) {
    const rows = prices
      .filter((p) => p.supplierCode !== null && item.codes.includes(p.supplierCode) && p.date <= asOf)
      .sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row);
    for (let i = 1; i < rows.length; i++) {
      const from = rows[i - 1]!;
      const to = rows[i]!;
      const percent = round2(((to.price - from.price) / from.price) * 100);
      if (percent >= PRICE_INCREASE_MIN_PERCENT) increases.push({ key: item.key, name: item.name, from, to, percent });
    }
  }
  return increases.sort((a, b) => a.to.date.localeCompare(b.to.date) || a.name.localeCompare(b.name));
}

export interface UnitCost {
  /** Purchase cost of one sold article, RSD without VAT. */
  cost: number;
  parts: { name: string; perUnit: number; price: number; row: number }[];
  /** Stock items with no agreed price on that date: the cost leaves them out. */
  missing: string[];
}

export function unitCost(articleCode: number, date: string, recipes: Recipes, prices: readonly AgreedPrice[]): UnitCost | undefined {
  const components = recipes.componentsOf(articleCode);
  if (!components) return undefined;
  const parts: UnitCost['parts'] = [];
  const missing: string[] = [];
  for (const { key, perUnit } of components) {
    const item = recipes.items.get(key);
    const price = item ? priceOn(prices, item.codes, date) : undefined;
    if (!item || !price) {
      missing.push(item?.name ?? key);
      continue;
    }
    parts.push({ name: item.name, perUnit, price: price.price, row: price.row });
  }
  return { cost: round2(parts.reduce((sum, p) => sum + p.perUnit * p.price, 0)), parts, missing };
}

export interface MarginDrop {
  key: string;
  articleCode: number;
  name: string;
  /** Selling price without VAT. */
  netPrice: number;
  before: { date: string; cost: number; margin: number; marginPercent: number };
  after: { date: string; cost: number; margin: number; marginPercent: number };
  /** Percentage points lost. */
  drop: number;
  /** Sold since the first price increase, up to the stock date. */
  soldSince: number;
  /** Margin lost on those sales: (cost after - cost before) x sold since, RSD without VAT. */
  lostMargin: number;
  increases: { name: string; from: number; to: number; percent: number }[];
  sources: string[];
}

/**
 * Margins of sold articles before the first supplier price increase and on the stock date, from
 * the recipes, the agreed purchase prices and the selling prices. Selling prices do not change.
 */
export function marginDrops(
  articles: readonly Article[],
  sales: readonly SaleRow[],
  recipes: Recipes,
  prices: readonly AgreedPrice[],
  asOf: string,
): { increases: PriceIncrease[]; drops: MarginDrop[] } {
  const increases = priceIncreases(prices, recipes, asOf);
  if (increases.length === 0) return { increases, drops: [] };
  const firstIncrease = increases[0]!.to.date;
  const before = addDays(firstIncrease, -1);

  const drops: MarginDrop[] = [];
  for (const article of articles) {
    const components = recipes.componentsOf(article.code);
    const hit = increases.filter((i) => components?.some((c) => c.key === i.key));
    if (hit.length === 0) continue;
    const costBefore = unitCost(article.code, before, recipes, prices);
    const costAfter = unitCost(article.code, asOf, recipes, prices);
    if (!costBefore || !costAfter) continue;

    const netPrice = round2(article.price / (1 + article.vatRate / 100));
    const side = (date: string, cost: number) => ({
      date,
      cost,
      margin: round2(netPrice - cost),
      marginPercent: round2(((netPrice - cost) / netPrice) * 100),
    });
    const b = side(before, costBefore.cost);
    const a = side(asOf, costAfter.cost);
    const drop = round2(b.marginPercent - a.marginPercent);
    if (drop < MARGIN_DROP_MIN_POINTS) continue;

    const soldSince = round2(
      sales.filter((s) => s.articleCode === article.code && s.date >= firstIncrease && s.date <= asOf).reduce((sum, s) => sum + s.quantity, 0),
    );
    drops.push({
      key: `PAD_MARZE|${article.code}|${asOf}`,
      articleCode: article.code,
      name: article.name,
      netPrice,
      before: b,
      after: a,
      drop,
      soldSince,
      lostMargin: round2((a.cost - b.cost) * soldSince),
      increases: hit.map((i) => ({ name: i.name, from: i.from.price, to: i.to.price, percent: i.percent })),
      sources: [
        `${ARTICLES_FILE_NAME} artikal ${article.code}: prodajna cena ${article.price} sa PDV ${article.vatRate}%`,
        `${RECIPES_FILE_NAME} artikal ${article.code}`,
        ...hit.map((i) => `${i.name}: ${PRICE_FILE_NAME}:${i.from.row} -> ${PRICE_FILE_NAME}:${i.to.row} (${i.to.invoiceNumber}, ${i.to.date})`),
        `prodato od ${firstIncrease} do ${asOf}: ${soldSince} (${SALES_FILE_NAME})`,
      ],
    });
  }
  return { increases, drops: drops.sort((x, y) => y.drop - x.drop) };
}

export interface SalesDrop {
  key: string;
  articleCode: number;
  name: string;
  weeks: { from: string; to: string; quantity: number; firstRow: number | null; lastRow: number | null }[];
  firstWeek: number;
  lastWeek: number;
  percent: number;
  /** The selling price is the same over the whole period (from artikli.json), so demand fell, not price. */
  price: number | null;
  lastSale: { row: number; date: string } | null;
  sources: string[];
}

/** Articles whose net sales fell from the first to the last full week up to the stock date. */
export function salesDrops(sales: readonly SaleRow[], articles: readonly Article[], asOf: string): SalesDrop[] {
  const start = sales.reduce((min, s) => (min === '' || s.date < min ? s.date : min), '');
  if (start === '') return [];
  const weeks: { from: string; to: string }[] = [];
  for (let from = start; addDays(from, 6) <= asOf; from = addDays(from, 7)) weeks.push({ from, to: addDays(from, 6) });
  if (weeks.length < 2) return [];

  const drops: SalesDrop[] = [];
  const codes = [...new Set(sales.map((s) => s.articleCode))];
  for (const code of codes) {
    const rows = sales.filter((s) => s.articleCode === code && s.date <= asOf);
    const perWeek = weeks.map((w) => {
      const inWeek = rows.filter((s) => s.date >= w.from && s.date <= w.to);
      return {
        ...w,
        quantity: round2(inWeek.reduce((sum, s) => sum + s.quantity, 0)),
        firstRow: inWeek[0]?.row ?? null,
        lastRow: inWeek.at(-1)?.row ?? null,
      };
    });
    const first = perWeek[0]!.quantity;
    const last = perWeek.at(-1)!.quantity;
    if (first < SALES_DROP_MIN_FIRST_WEEK) continue;
    const percent = round2(((last - first) / first) * 100);
    if (percent > -SALES_DROP_MIN_PERCENT) continue;

    const article = articles.find((a) => a.code === code);
    const lastSaleRow = rows.filter((s) => s.quantity > 0).at(-1);
    drops.push({
      key: `PAD_PRODAJE|${code}|${asOf}`,
      articleCode: code,
      name: article?.name ?? rows[0]?.name ?? String(code),
      weeks: perWeek,
      firstWeek: first,
      lastWeek: last,
      percent,
      price: article?.price ?? null,
      lastSale: lastSaleRow ? { row: lastSaleRow.row, date: lastSaleRow.date } : null,
      sources: [
        ...perWeek.map(
          (w) =>
            `${w.from} do ${w.to}: ${w.quantity}` +
            (w.firstRow !== null ? ` (${SALES_FILE_NAME}:${w.firstRow} do ${SALES_FILE_NAME}:${w.lastRow})` : ''),
        ),
        ...(lastSaleRow ? [`poslednja prodaja: ${SALES_FILE_NAME}:${lastSaleRow.row} (${lastSaleRow.date})`] : []),
        `${ARTICLES_FILE_NAME} artikal ${code}: cena ${article?.price ?? '?'} ceo period`,
      ],
    });
  }
  return drops;
}
