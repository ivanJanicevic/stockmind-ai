import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Product {
  code: string;
  name: string;
  group: string;
  salePrice: number;
  vatRate: number;
  deliveryName: string | null;
}

export interface RecipeComponent {
  ingredientKey?: string;
  deliveryName?: string;
  quantity: number;
}

export interface Recipe {
  productCode: string;
  components: RecipeComponent[];
}

export interface Ingredient {
  key: string;
  deliveryName: string;
  factor: number;
  supplierCodes: string[];
}

export interface SalesRow {
  date: string;
  receipt: string;
  receiptType: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  amount: number;
  row: number;
  quote: string;
}

export interface PurchaseRow {
  date: string;
  invoice: string;
  deliveryNote: string;
  supplierCode: string;
  productName: string;
  quantity: number;
  unitCost: number;
  row: number;
  quote: string;
}

export interface ExpenseRow {
  month: string;
  category: string;
  description: string;
  amount: number;
  row: number;
  quote: string;
}

export interface DeliveryLot {
  deliveryNote: string;
  deliveryDate: string;
  itemCode: string;
  productName: string;
  unit: string;
  quantity: number;
  expiryDate: string;
  file: string;
  quote: string;
}

export interface InvoiceDocument {
  file: string;
  text: string;
}

export interface InvoicePair {
  invoice: InvoiceDocument;
  deliveryNote?: InvoiceDocument;
}

export interface RetailDataset {
  products: Product[];
  recipes: Recipe[];
  ingredients: Ingredient[];
  sales: SalesRow[];
  purchases: PurchaseRow[];
  expenses: ExpenseRow[];
  deliveryLots: DeliveryLot[];
  invoicePairs: InvoicePair[];
}

export interface DailySales {
  date: string;
  units: number;
  grossRevenue: number;
  netRevenue: number;
  receipts: number;
  sourceRows: number[];
}

export interface WeeklySales {
  week: number;
  start: string;
  end: string;
  units: number;
  grossRevenue: number;
  netRevenue: number;
  sourceRows: number[];
}

export interface ProductSales {
  code: string;
  name: string;
  group: string;
  units: number;
  grossRevenue: number;
  netRevenue: number;
  weeks: WeeklySales[];
  trendPercent: number | null;
  sourceRows: number[];
}

export interface InventoryFinding {
  deliveryName: string;
  received: number;
  consumed: number;
  recordedShortfall: number;
  remaining: number;
  expired: number;
  nextExpiry: string | null;
  sourceRows: number[];
  lots: Array<{
    file: string;
    deliveryNote: string;
    quantity: number;
    expiryDate: string;
    remaining: number;
    expired: number;
    quote: string;
  }>;
}

export interface PurchasePriceChange {
  productName: string;
  supplierCode: string;
  previousPrice: number;
  previousDate: string;
  previousSource: string;
  latestPrice: number;
  latestDate: string;
  latestSource: string;
  changePercent: number;
}

export interface ProductMargin {
  code: string;
  name: string;
  unitsSold: number;
  netRevenue: number;
  pricedNetRevenue: number;
  costOfGoods: number;
  grossMargin: number;
  pricedUnits: number;
  sourceRows: number[];
  purchaseRows: number[];
}

export interface MonthlyFinance {
  month: string;
  salesDays: number;
  netRevenue: number;
  pricedNetRevenue: number;
  costOfGoods: number;
  grossMargin: number;
  costCoveragePercent: number;
  estimatedMonthlyRunRate: number | null;
  operatingCosts: number;
  sourceRows: number[];
  purchaseRows: number[];
  expenseRows: number[];
}

export interface RetailAnalysis {
  periodStart: string;
  periodEnd: string;
  sourceRowCount: number;
  dailySales: DailySales[];
  weeklySales: WeeklySales[];
  products: ProductSales[];
  inventory: InventoryFinding[];
  purchasePriceChanges: PurchasePriceChange[];
  productMargins: ProductMargin[];
  monthlyFinance: MonthlyFinance[];
  notes: string[];
}

type JsonRecord = Record<string, unknown>;

interface CsvRecord {
  values: Map<string, string>;
  row: number;
  quote: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: JsonRecord, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${context}.${key} must be a non-empty string.`);
  }
  return value;
}

function requiredNumber(record: JsonRecord, key: string, context: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${context}.${key} must be a finite number.`);
  }
  return value;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function parseDelimitedLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === ';' && !quoted) {
      fields.push(field);
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('CSV row contains an unclosed quoted field.');
  fields.push(field);
  return fields;
}

function readCsv(path: string): CsvRecord[] {
  const lines = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const headerLine = lines.shift();
  if (!headerLine) throw new Error(`${path} is empty.`);

  const headers = parseDelimitedLine(headerLine);
  return lines.flatMap((line, index) => {
    if (!line.trim()) return [];
    const cells = parseDelimitedLine(line);
    if (cells.length !== headers.length) {
      throw new Error(`${path}:${index + 2} has ${cells.length} cells; expected ${headers.length}.`);
    }
    return [{
      values: new Map(headers.map((header, cell) => [header, cells[cell] ?? ''])),
      row: index + 2,
      quote: line,
    }];
  });
}

function csvValue(row: CsvRecord, key: string, path: string): string {
  const value = row.values.get(key);
  if (value === undefined || value.trim() === '') {
    throw new Error(`${path}:${row.row} is missing "${key}".`);
  }
  return value.trim();
}

function parseLocalNumber(value: string, context: string): number {
  const compact = value.trim().replace(/\s/g, '');
  const normalized = compact.includes(',')
    ? compact.replace(/\./g, '').replace(',', '.')
    : compact;
  const number = Number(normalized);
  if (!Number.isFinite(number)) throw new Error(`${context} is not a valid number: "${value}".`);
  return number;
}

function isoDate(value: string, context: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : (() => {
        const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
        return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
      })();
  if (!date || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`${context} is not a supported date: "${value}".`);
  }
  return date;
}

function parseProducts(path: string): Product[] {
  const root = readJson(path);
  if (!isRecord(root) || !Array.isArray(root.artikli)) {
    throw new Error(`${path} must contain an artikli array.`);
  }
  return root.artikli.map((value, index) => {
    if (!isRecord(value)) throw new Error(`${path}.artikli[${index}] must be an object.`);
    const code = value.sifra;
    if (typeof code !== 'number' && typeof code !== 'string') {
      throw new Error(`${path}.artikli[${index}].sifra must be a string or number.`);
    }
    const deliveryName = value.veza_otpremnica;
    return {
      code: String(code),
      name: requiredString(value, 'naziv', `${path}.artikli[${index}]`),
      group: requiredString(value, 'grupa', `${path}.artikli[${index}]`),
      salePrice: requiredNumber(value, 'prodajna_cena', `${path}.artikli[${index}]`),
      vatRate: requiredNumber(value, 'pdv_stopa', `${path}.artikli[${index}]`),
      deliveryName: typeof deliveryName === 'string' ? deliveryName : null,
    };
  });
}

function parseRecipes(path: string): { recipes: Recipe[]; ingredients: Ingredient[] } {
  const root = readJson(path);
  if (!isRecord(root) || !Array.isArray(root.normativi) || !isRecord(root.sirovine)) {
    throw new Error(`${path} must contain normativi and sirovine.`);
  }

  const ingredients = Object.entries(root.sirovine).map(([key, value]) => {
    if (!isRecord(value)) throw new Error(`${path}.sirovine.${key} must be an object.`);
    const codes = value.sifre_dobavljaca;
    if (!Array.isArray(codes) || !codes.every((code) => typeof code === 'string')) {
      throw new Error(`${path}.sirovine.${key}.sifre_dobavljaca must be strings.`);
    }
    return {
      key,
      deliveryName: requiredString(value, 'naziv_otpremnica', `${path}.sirovine.${key}`),
      factor: requiredNumber(value, 'faktor', `${path}.sirovine.${key}`),
      supplierCodes: codes,
    };
  });

  const ingredientKeys = new Set(ingredients.map(({ key }) => key));
  const recipes = root.normativi.map((value, index) => {
    if (!isRecord(value) || !Array.isArray(value.sastav)) {
      throw new Error(`${path}.normativi[${index}] must contain sastav.`);
    }
    const code = value.sifra_artikla;
    if (typeof code !== 'number' && typeof code !== 'string') {
      throw new Error(`${path}.normativi[${index}].sifra_artikla must be a string or number.`);
    }
    const components = value.sastav.map((component, componentIndex) => {
      if (!isRecord(component)) {
        throw new Error(`${path}.normativi[${index}].sastav[${componentIndex}] must be an object.`);
      }
      const quantity = requiredNumber(component, 'kolicina', `${path}.normativi[${index}].sastav[${componentIndex}]`);
      if (typeof component.sirovina === 'string') {
        if (!ingredientKeys.has(component.sirovina)) {
          throw new Error(`${path} references unknown ingredient "${component.sirovina}".`);
        }
        return { ingredientKey: component.sirovina, quantity };
      }
      return {
        deliveryName: requiredString(component, 'naziv_otpremnica', `${path}.normativi[${index}].sastav[${componentIndex}]`),
        quantity,
      };
    });
    return { productCode: String(code), components };
  });

  return { recipes, ingredients };
}

function parseSales(path: string): SalesRow[] {
  return readCsv(path).map((row) => ({
    date: isoDate(csvValue(row, 'datum', path), `${path}:${row.row}`),
    receipt: csvValue(row, 'pfr_broj_racuna', path),
    receiptType: csvValue(row, 'vrsta_racuna', path),
    productCode: csvValue(row, 'sifra_artikla', path),
    productName: csvValue(row, 'naziv', path),
    quantity: parseLocalNumber(csvValue(row, 'kolicina', path), `${path}:${row.row} quantity`),
    unitPrice: parseLocalNumber(csvValue(row, 'jed_cena', path), `${path}:${row.row} unit price`),
    vatRate: parseLocalNumber(csvValue(row, 'pdv_stopa', path), `${path}:${row.row} VAT`),
    amount: parseLocalNumber(csvValue(row, 'iznos', path), `${path}:${row.row} amount`),
    row: row.row,
    quote: row.quote,
  }));
}

function parsePurchases(path: string): PurchaseRow[] {
  return readCsv(path).map((row) => ({
    date: isoDate(csvValue(row, 'datum', path), `${path}:${row.row}`),
    invoice: csvValue(row, 'broj_fakture', path),
    deliveryNote: csvValue(row, 'veza_otpremnica', path),
    supplierCode: csvValue(row, 'sifra_dobavljaca', path),
    productName: csvValue(row, 'naziv', path),
    quantity: parseLocalNumber(csvValue(row, 'kolicina', path), `${path}:${row.row} quantity`),
    unitCost: parseLocalNumber(csvValue(row, 'nabavna_cena_bez_pdv', path), `${path}:${row.row} unit cost`),
    row: row.row,
    quote: row.quote,
  }));
}

function parseExpenses(path: string): ExpenseRow[] {
  return readCsv(path).map((row) => ({
    month: csvValue(row, 'mesec', path),
    category: csvValue(row, 'kategorija', path),
    description: csvValue(row, 'opis', path),
    amount: parseLocalNumber(csvValue(row, 'iznos_bez_pdv', path), `${path}:${row.row} amount`),
    row: row.row,
    quote: row.quote,
  }));
}

function readPdfText(path: string): string {
  try {
    return execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error('pdftotext was not found. Install Poppler (for example: sudo apt install poppler-utils).');
    }
    throw new Error(`Could not extract text from ${path}: ${(error as Error).message}`);
  }
}

function loadPdfDocuments(directory: string, prefix: string): InvoiceDocument[] {
  return readdirSync(directory)
    .filter((name) => name.toLowerCase().endsWith('.pdf') && name.startsWith(prefix))
    .sort()
    .map((name) => {
      const path = join(directory, name);
      return { file: path.replaceAll('\\', '/'), text: readPdfText(path) };
    });
}

function pairDocuments(invoices: InvoiceDocument[], deliveryNotes: InvoiceDocument[]): InvoicePair[] {
  const bySequence = new Map(
    deliveryNotes.flatMap((document) => {
      const match = /otpremnica-(\d+)/i.exec(document.file);
      return match ? [[match[1]!, document] as const] : [];
    })
  );
  return invoices.map((invoice) => {
    const match = /faktura-(\d+)/i.exec(invoice.file);
    const deliveryNote = match ? bySequence.get(match[1]!) : undefined;
    return deliveryNote ? { invoice, deliveryNote } : { invoice };
  });
}

export function parseDeliveryLots(documents: InvoiceDocument[]): DeliveryLot[] {
  const lots: DeliveryLot[] = [];
  const rowPattern =
    /^\s*(\d+)\s+([A-Z0-9-]+)\s+(.+?)\s+([A-Za-zČĆŽŠĐčćžšđ]+)\s+([\d.,]+)\s+(\d{2}\.\d{2}\.\d{4})(?:\s+.*)?\s*$/;

  for (const document of documents) {
    const deliveryNumber = /OTPREMNICA\s+br\.\s*([^\s]+)/i.exec(document.text)?.[1];
    const rawDate = /\b\d{2}\.\d{2}\.\d{4}\b/.exec(document.text)?.[0];
    if (!deliveryNumber || !rawDate) {
      throw new Error(`${document.file} is missing its dispatch number or delivery date.`);
    }
    const deliveryDate = isoDate(rawDate, document.file);
    for (const line of document.text.split(/\r?\n/)) {
      const match = rowPattern.exec(line);
      if (!match) continue;
      lots.push({
        deliveryNote: deliveryNumber,
        deliveryDate,
        itemCode: match[2]!,
        productName: match[3]!.trim(),
        unit: match[4]!,
        quantity: parseLocalNumber(match[5]!, `${document.file} quantity`),
        expiryDate: isoDate(match[6]!, document.file),
        file: document.file,
        quote: line.trim(),
      });
    }
  }
  if (documents.length > 0 && lots.length === 0) {
    throw new Error('No dispatch-note item rows could be read from the supplied PDFs.');
  }
  return lots;
}

export function loadRetailDataset(root = process.cwd()): RetailDataset {
  const data = join(root, 'data');
  const products = parseProducts(join(data, 'artikli.json'));
  const { recipes, ingredients } = parseRecipes(join(data, 'normativi.json'));
  const sales = parseSales(join(data, 'promet_2026-11-26_do_2026-12-25.csv'));
  const purchases = parsePurchases(join(data, 'nabavne_cene.csv'));
  const expenses = parseExpenses(join(data, 'troskovi.csv'));
  const invoiceDocuments = loadPdfDocuments(join(data, 'fakture'), 'faktura-');
  const deliveryDocuments = loadPdfDocuments(join(data, 'otpremnice'), 'otpremnica-');

  return {
    products,
    recipes,
    ingredients,
    sales,
    purchases,
    expenses,
    deliveryLots: parseDeliveryLots(deliveryDocuments),
    invoicePairs: pairDocuments(invoiceDocuments, deliveryDocuments),
  };
}

const dayMs = 24 * 60 * 60 * 1000;
const dayIndex = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / dayMs);
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function weekStartDate(start: string, week: number): string {
  return new Date((dayIndex(start) + (week - 1) * 7) * dayMs).toISOString().slice(0, 10);
}

function weekEndDate(start: string, week: number, periodEnd: string): string {
  const planned = new Date((dayIndex(start) + week * 7 - 1) * dayMs).toISOString().slice(0, 10);
  return planned < periodEnd ? planned : periodEnd;
}

function buildConsumption(
  dataset: RetailDataset
): Map<string, { quantities: Map<string, number>; sourceRows: Map<string, number[]> }> {
  const ingredientByKey = new Map(dataset.ingredients.map((ingredient) => [ingredient.key, ingredient]));
  const consumptionPerUnit = new Map<string, Map<string, number>>();

  for (const recipe of dataset.recipes) {
    const components = new Map<string, number>();
    for (const component of recipe.components) {
      if (component.ingredientKey) {
        const ingredient = ingredientByKey.get(component.ingredientKey)!;
        components.set(
          ingredient.deliveryName,
          (components.get(ingredient.deliveryName) ?? 0) + component.quantity / ingredient.factor
        );
      } else if (component.deliveryName) {
        components.set(component.deliveryName, (components.get(component.deliveryName) ?? 0) + component.quantity);
      }
    }
    consumptionPerUnit.set(recipe.productCode, components);
  }

  const demand = new Map<string, { quantities: Map<string, number>; sourceRows: Map<string, number[]> }>();
  for (const sale of dataset.sales) {
    const components = consumptionPerUnit.get(sale.productCode);
    if (!components) continue;
    for (const [deliveryName, perUnit] of components) {
      let itemDemand = demand.get(deliveryName);
      if (!itemDemand) {
        itemDemand = { quantities: new Map(), sourceRows: new Map() };
        demand.set(deliveryName, itemDemand);
      }
      itemDemand.quantities.set(
        sale.date,
        (itemDemand.quantities.get(sale.date) ?? 0) + sale.quantity * perUnit
      );
      const rows = itemDemand.sourceRows.get(sale.date) ?? [];
      rows.push(sale.row);
      itemDemand.sourceRows.set(sale.date, rows);
    }
  }
  return demand;
}

function inventoryAnalysis(
  dataset: RetailDataset,
  start: string,
  end: string
): InventoryFinding[] {
  const demand = buildConsumption(dataset);
  const names = new Set([
    ...dataset.deliveryLots.map((lot) => lot.productName),
    ...demand.keys(),
  ]);
  const findings: InventoryFinding[] = [];

  for (const deliveryName of names) {
    const lots = dataset.deliveryLots
      .filter((lot) => lot.productName === deliveryName)
      .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate) || a.expiryDate.localeCompare(b.expiryDate))
      .map((lot) => ({ ...lot, remaining: lot.quantity, expired: 0 }));
    if (lots.length === 0) continue;

    const itemDemand = demand.get(deliveryName);
    const dailyDemand = itemDemand?.quantities ?? new Map<string, number>();
    const demandRows = [...dailyDemand.entries()]
      .filter(([date]) => date >= start && date <= end)
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [date, quantity] of demandRows) {
      let remainingDemand = Math.max(0, quantity);
      const eligible = lots
        .filter((lot) => lot.deliveryDate <= date && lot.expiryDate >= date && lot.remaining > 0)
        .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.deliveryDate.localeCompare(b.deliveryDate));
      for (const lot of eligible) {
        const consumed = Math.min(lot.remaining, remainingDemand);
        lot.remaining -= consumed;
        remainingDemand -= consumed;
        if (remainingDemand <= 0) break;
      }
    }

    for (const lot of lots) {
      if (lot.expiryDate < start) {
        lot.expired = lot.quantity;
        lot.remaining = 0;
      } else if (lot.expiryDate <= end) {
        lot.expired = lot.remaining;
        lot.remaining = 0;
      }
    }

    const received = lots.reduce((sum, lot) => sum + lot.quantity, 0);
    const consumed = demandRows.reduce((sum, [, quantity]) => sum + Math.max(0, quantity), 0);
    const remaining = lots.reduce((sum, lot) => sum + lot.remaining, 0);
    const expired = lots.reduce((sum, lot) => sum + lot.expired, 0);
    findings.push({
      deliveryName,
      received: round2(received),
      consumed: round2(consumed),
      recordedShortfall: round2(Math.max(0, consumed - received)),
      remaining: round2(remaining),
      expired: round2(expired),
      nextExpiry: lots
        .filter((lot) => lot.expiryDate >= start && lot.remaining > 0)
        .map((lot) => lot.expiryDate)
        .sort()[0] ?? null,
      sourceRows: demandRows.flatMap(([date]) => itemDemand?.sourceRows.get(date) ?? []),
      lots: lots.map((lot) => ({
        file: lot.file,
        deliveryNote: lot.deliveryNote,
        quantity: round2(lot.quantity),
        expiryDate: lot.expiryDate,
        remaining: round2(lot.remaining),
        expired: round2(lot.expired),
        quote: lot.quote,
      })),
    });
  }
  return findings.sort((a, b) => b.recordedShortfall - a.recordedShortfall || b.expired - a.expired);
}

function salesAnalysis(dataset: RetailDataset, start: string, end: string) {
  const dailyMap = new Map<string, DailySales>();
  const productMap = new Map<string, SalesRow[]>();
  const weekCount = Math.ceil((dayIndex(end) - dayIndex(start) + 1) / 7);
  const weekly = Array.from({ length: weekCount }, (_, index): WeeklySales => ({
    week: index + 1,
    start: weekStartDate(start, index + 1),
    end: weekEndDate(start, index + 1, end),
    units: 0,
    grossRevenue: 0,
    netRevenue: 0,
    sourceRows: [],
  }));
  const productByCode = new Map(dataset.products.map((product) => [product.code, product]));

  for (const sale of dataset.sales) {
    const netRevenue = sale.amount / (1 + sale.vatRate / 100);
    let daily = dailyMap.get(sale.date);
    if (!daily) {
      daily = { date: sale.date, units: 0, grossRevenue: 0, netRevenue: 0, receipts: 0, sourceRows: [] };
      dailyMap.set(sale.date, daily);
    }
    daily.units += sale.quantity;
    daily.grossRevenue += sale.amount;
    daily.netRevenue += netRevenue;
    daily.sourceRows.push(sale.row);
    if (!sale.receiptType.toLowerCase().includes('refund')) daily.receipts++;

    const weekIndex = Math.floor((dayIndex(sale.date) - dayIndex(start)) / 7);
    const week = weekly[weekIndex];
    if (week) {
      week.units += sale.quantity;
      week.grossRevenue += sale.amount;
      week.netRevenue += netRevenue;
      week.sourceRows.push(sale.row);
    }

    const rows = productMap.get(sale.productCode) ?? [];
    rows.push(sale);
    productMap.set(sale.productCode, rows);
  }

  const products = [...productMap.entries()].map(([code, rows]): ProductSales => {
    const product = productByCode.get(code);
    const weeks = weekly.map((week) => {
      const bucket = rows.filter((sale) => {
        const weekIndex = Math.floor((dayIndex(sale.date) - dayIndex(start)) / 7);
        return weekIndex === week.week - 1;
      });
      return {
        ...week,
        units: round2(bucket.reduce((sum, sale) => sum + sale.quantity, 0)),
        grossRevenue: round2(bucket.reduce((sum, sale) => sum + sale.amount, 0)),
        netRevenue: round2(bucket.reduce((sum, sale) => sum + sale.amount / (1 + sale.vatRate / 100), 0)),
        sourceRows: bucket.map((sale) => sale.row),
      };
    });
    const completeWeeks = weeks.filter((week) => dayIndex(week.end) - dayIndex(week.start) === 6);
    const first = completeWeeks[0]?.units;
    const last = completeWeeks.at(-1)?.units;
    const trendPercent = first !== undefined && first !== 0 && last !== undefined
      ? round2(((last - first) / Math.abs(first)) * 100)
      : null;
    return {
      code,
      name: product?.name ?? rows[0]?.productName ?? code,
      group: product?.group ?? 'unknown',
      units: round2(rows.reduce((sum, sale) => sum + sale.quantity, 0)),
      grossRevenue: round2(rows.reduce((sum, sale) => sum + sale.amount, 0)),
      netRevenue: round2(rows.reduce((sum, sale) => sum + sale.amount / (1 + sale.vatRate / 100), 0)),
      weeks,
      trendPercent,
      sourceRows: rows.map((sale) => sale.row),
    };
  });

  const dailySales = [...dailyMap.values()]
    .map((day) => ({
      ...day,
      units: round2(day.units),
      grossRevenue: round2(day.grossRevenue),
      netRevenue: round2(day.netRevenue),
      receipts: new Set(dataset.sales.filter((sale) => sale.date === day.date).map((sale) => sale.receipt)).size,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  weekly.forEach((week) => {
    week.units = round2(week.units);
    week.grossRevenue = round2(week.grossRevenue);
    week.netRevenue = round2(week.netRevenue);
  });

  return {
    dailySales,
    weeklySales: weekly,
    products: products.sort((a, b) => b.netRevenue - a.netRevenue),
  };
}

function purchaseAnalysis(dataset: RetailDataset): PurchasePriceChange[] {
  const byCode = new Map<string, PurchaseRow[]>();
  for (const row of dataset.purchases) {
    const matches = byCode.get(row.supplierCode) ?? [];
    matches.push(row);
    byCode.set(row.supplierCode, matches);
  }
  const changes: PurchasePriceChange[] = [];
  for (const [supplierCode, rows] of byCode) {
    const ordered = rows.sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row);
    if (ordered.length < 2) continue;
    const previous = ordered.at(-2)!;
    const latest = ordered.at(-1)!;
    if (previous.unitCost === 0 || previous.unitCost === latest.unitCost) continue;
    changes.push({
      productName: latest.productName,
      supplierCode,
      previousPrice: previous.unitCost,
      previousDate: previous.date,
      previousSource: `data/nabavne_cene.csv:${previous.row} (${previous.invoice})`,
      latestPrice: latest.unitCost,
      latestDate: latest.date,
      latestSource: `data/nabavne_cene.csv:${latest.row} (${latest.invoice})`,
      changePercent: round2(((latest.unitCost - previous.unitCost) / previous.unitCost) * 100),
    });
  }
  return changes.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
}

function productMargins(dataset: RetailDataset): ProductMargin[] {
  const ingredientByKey = new Map(dataset.ingredients.map((ingredient) => [ingredient.key, ingredient]));
  const recipeByCode = new Map(dataset.recipes.map((recipe) => [recipe.productCode, recipe]));
  const priceRows = [...dataset.purchases].sort((a, b) => a.date.localeCompare(b.date));
  const purchaseFor = (name: string, date: string, codes: string[] = []) =>
    priceRows
      .filter((row) => row.date <= date && (codes.length ? codes.includes(row.supplierCode) : row.productName === name))
      .at(-1);
  const totals = new Map<string, ProductMargin>();
  const products = new Map(dataset.products.map((product) => [product.code, product]));

  for (const sale of dataset.sales) {
    const product = products.get(sale.productCode);
    const recipe = recipeByCode.get(sale.productCode);
    if (!product || !recipe) continue;
    let costPerUnit = 0;
    let priced = true;
    const purchaseRows: number[] = [];
    for (const component of recipe.components) {
      const ingredient = component.ingredientKey
        ? ingredientByKey.get(component.ingredientKey)
        : undefined;
      const purchase = ingredient
        ? purchaseFor(ingredient.deliveryName, sale.date, ingredient.supplierCodes)
        : component.deliveryName
          ? purchaseFor(component.deliveryName, sale.date)
          : undefined;
      if (!purchase) {
        priced = false;
        break;
      }
      costPerUnit += component.quantity * purchase.unitCost / (ingredient?.factor ?? 1);
      purchaseRows.push(purchase.row);
    }

    const current = totals.get(sale.productCode) ?? {
      code: sale.productCode,
      name: product.name,
      unitsSold: 0,
      netRevenue: 0,
      pricedNetRevenue: 0,
      costOfGoods: 0,
      grossMargin: 0,
      pricedUnits: 0,
      sourceRows: [],
      purchaseRows: [],
    };
    current.unitsSold += sale.quantity;
    const netRevenue = sale.amount / (1 + sale.vatRate / 100);
    current.netRevenue += netRevenue;
    if (priced) {
      current.pricedNetRevenue += netRevenue;
      current.costOfGoods += sale.quantity * costPerUnit;
      current.pricedUnits += sale.quantity;
      current.purchaseRows.push(...purchaseRows);
    }
    current.sourceRows.push(sale.row);
    totals.set(sale.productCode, current);
  }

  return [...totals.values()]
    .map((item) => ({
      ...item,
      unitsSold: round2(item.unitsSold),
      netRevenue: round2(item.netRevenue),
      pricedNetRevenue: round2(item.pricedNetRevenue),
      costOfGoods: round2(item.costOfGoods),
      grossMargin: round2(item.pricedNetRevenue - item.costOfGoods),
      purchaseRows: [...new Set(item.purchaseRows)].sort((a, b) => a - b),
    }))
    .sort((a, b) => b.grossMargin - a.grossMargin);
}

function monthlyFinance(
  dataset: RetailDataset,
  dailySales: DailySales[]
): MonthlyFinance[] {
  const months = new Map<string, { rows: DailySales[]; expenses: ExpenseRow[] }>();
  for (const day of dailySales) {
    const month = day.date.slice(0, 7);
    const bucket = months.get(month) ?? { rows: [], expenses: [] };
    bucket.rows.push(day);
    months.set(month, bucket);
  }
  for (const expense of dataset.expenses) {
    const bucket = months.get(expense.month) ?? { rows: [], expenses: [] };
    bucket.expenses.push(expense);
    months.set(expense.month, bucket);
  }

  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, bucket]) => {
    const sources = bucket.rows.flatMap((day) => day.sourceRows);
    const netRevenue = round2(bucket.rows.reduce((sum, day) => sum + day.netRevenue, 0));
    const monthlySales = dataset.sales.filter((sale) => sale.date.startsWith(month));
    let costOfGoods = 0;
    let pricedNetRevenue = 0;
    const purchaseRows: number[] = [];
    for (const sale of monthlySales) {
      const product = dataset.products.find((item) => item.code === sale.productCode);
      const recipe = dataset.recipes.find((item) => item.productCode === sale.productCode);
      if (!product || !recipe) continue;
      let saleCost = 0;
      let priced = true;
      for (const component of recipe.components) {
        const ingredient = component.ingredientKey
          ? dataset.ingredients.find((item) => item.key === component.ingredientKey)
          : undefined;
        const purchase = dataset.purchases
          .filter((row) =>
            row.date <= sale.date &&
            (ingredient
              ? ingredient.supplierCodes.includes(row.supplierCode)
              : row.productName === component.deliveryName)
          )
          .sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row)
          .at(-1);
        if (!purchase) {
          priced = false;
          break;
        }
        saleCost += component.quantity * purchase.unitCost / (ingredient?.factor ?? 1);
        purchaseRows.push(purchase.row);
      }
      if (priced) {
        costOfGoods += sale.quantity * saleCost;
        pricedNetRevenue += sale.amount / (1 + sale.vatRate / 100);
      }
    }
    costOfGoods = round2(costOfGoods);
    pricedNetRevenue = round2(pricedNetRevenue);
    const grossMargin = round2(pricedNetRevenue - costOfGoods);
    const operatingCosts = round2(bucket.expenses.reduce((sum, expense) => sum + expense.amount, 0));
    const costCoveragePercent = netRevenue === 0
      ? 100
      : round2(Math.min(100, Math.max(0, (pricedNetRevenue / netRevenue) * 100)));
    const runRate = bucket.rows.length > 0 && costCoveragePercent >= 99.99
      ? round2((grossMargin / bucket.rows.length) * 30 - operatingCosts)
      : null;
    return {
      month,
      salesDays: bucket.rows.length,
      netRevenue,
      pricedNetRevenue,
      costOfGoods,
      grossMargin,
      costCoveragePercent,
      estimatedMonthlyRunRate: runRate,
      operatingCosts,
      sourceRows: sources,
      purchaseRows: [...new Set(purchaseRows)].sort((a, b) => a - b),
      expenseRows: bucket.expenses.map((expense) => expense.row),
    };
  });
}

export function analyzeRetailDataset(dataset: RetailDataset): RetailAnalysis {
  if (dataset.sales.length === 0) throw new Error('The sales file contains no data rows.');
  const dates = dataset.sales.map((sale) => sale.date).sort();
  const periodStart = dates[0]!;
  const periodEnd = dates.at(-1)!;
  const sales = salesAnalysis(dataset, periodStart, periodEnd);
  const margins = productMargins(dataset);
  const purchases = purchaseAnalysis(dataset);

  return {
    periodStart,
    periodEnd,
    sourceRowCount: dataset.sales.length,
    dailySales: sales.dailySales,
    weeklySales: sales.weeklySales,
    products: sales.products,
    inventory: inventoryAnalysis(dataset, periodStart, periodEnd),
    purchasePriceChanges: purchases,
    productMargins: margins,
    monthlyFinance: monthlyFinance(dataset, sales.dailySales),
    notes: [
      'Sales refunds reduce reported sales and revenue; physical stock return on a refund is unknown.',
      'Inventory reconciliation compares sales-derived ingredient use with recorded dispatch-note quantities; opening stock and missing delivery notes are unknown.',
      'Expiry calculations are retrospective over the supplied synthetic period and do not represent live stock.',
      'Monthly run-rate extrapolates observed gross margin per sales day to 30 days and subtracts that month’s listed operating costs; it is an estimate, not accounting profit.',
      'No promotion uplift is forecast because the input does not contain comparable promotion history.',
    ],
  };
}

export function buildLocalRetailEvidence(dataset: RetailDataset, analysis: RetailAnalysis) {
  const rowRanges = (rows: number[]): string[] => {
    const sorted = [...new Set(rows)].sort((a, b) => a - b);
    const ranges: string[] = [];
    for (let index = 0; index < sorted.length;) {
      const start = sorted[index]!;
      let end = start;
      while (sorted[index + 1] === end + 1) {
        end = sorted[index + 1]!;
        index++;
      }
      ranges.push(start === end ? String(start) : `${start}-${end}`);
      index++;
    }
    return ranges;
  };
  const sampleQuotes = analysis.products.flatMap((product) => {
    const rows = dataset.sales.filter((sale) => sale.productCode === product.code);
    const selected = new Set<number>();
    for (const week of product.weeks) {
      const inWeek = rows.filter((sale) => sale.date >= week.start && sale.date <= week.end);
      if (inWeek.length > 0) {
        selected.add(inWeek[0]!.row);
        selected.add(inWeek.at(-1)!.row);
      }
    }
    return rows.filter((row) => selected.has(row.row)).map((row) => ({
      source: `data/promet_2026-11-26_do_2026-12-25.csv:${row.row}`,
      quote: row.quote,
    }));
  });
  const salesByRow = new Map(dataset.sales.map((sale) => [sale.row, sale]));

  return {
    sales: JSON.stringify({
      period: { start: analysis.periodStart, end: analysis.periodEnd },
      daily: analysis.dailySales.map(({ sourceRows: _rows, ...day }) => day),
      weekly: analysis.weeklySales.map(({ sourceRows: _rows, ...week }) => week),
      products: analysis.products.map(({ sourceRows, weeks, ...product }) => ({
        ...product,
        weeks: weeks.map(({ sourceRows: _weekRows, ...week }) => week),
        sourceRows: rowRanges(sourceRows),
      })),
      source: 'data/promet_2026-11-26_do_2026-12-25.csv',
      evidenceIds: [
        'sales:overview',
        ...analysis.products.map((item) => `sales:${item.code}:weekly-trend`),
      ],
      sampleQuotes,
    }),
    inventory: JSON.stringify({
      items: analysis.inventory.map(({ sourceRows, ...item }) => ({
        ...item,
        salesRows: rowRanges(sourceRows),
        salesQuotes: [...new Set([...sourceRows.slice(0, 2), ...sourceRows.slice(-2)])].map((row) => ({
          source: `data/promet_2026-11-26_do_2026-12-25.csv:${row}`,
          quote: salesByRow.get(row)?.quote ?? '',
        })),
      })),
      evidenceIds: analysis.inventory.map((item) => `inventory:${item.deliveryName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`),
    }),
    finance: JSON.stringify({
      productMargins: analysis.productMargins.map(({ sourceRows, purchaseRows, ...item }) => ({
        ...item,
        sourceRows: rowRanges(sourceRows),
        purchaseRows: rowRanges(purchaseRows),
      })),
      purchasePriceChanges: analysis.purchasePriceChanges,
      monthlyFinance: analysis.monthlyFinance.map(({ sourceRows, purchaseRows, expenseRows, ...month }) => ({
        ...month,
        sourceRows: rowRanges(sourceRows),
        purchaseRows: rowRanges(purchaseRows),
        expenseRows: rowRanges(expenseRows),
      })),
      expenseSources: dataset.expenses.map((row) => ({
        month: row.month,
        category: row.category,
        amount: row.amount,
        source: `data/troskovi.csv:${row.row}`,
        quote: row.quote,
      })),
      purchaseSources: dataset.purchases.map((row) => ({
        source: `data/nabavne_cene.csv:${row.row}`,
        quote: row.quote,
      })),
      evidenceIds: [
        ...analysis.productMargins.map((item) => `margin:${item.code}`),
        ...analysis.purchasePriceChanges.map((item) => `purchase:${item.supplierCode}`),
        ...analysis.monthlyFinance.map((item) => `finance:${item.month}`),
      ],
      sources: {
        purchases: 'data/nabavne_cene.csv',
        expenses: 'data/troskovi.csv',
        recipes: 'data/normativi.json',
        catalog: 'data/artikli.json',
      },
    }),
    invoiceAudit: JSON.stringify({
      invoicePairs: dataset.invoicePairs,
      purchaseRows: dataset.purchases.map((row) => ({
        invoice: row.invoice,
        deliveryNote: row.deliveryNote,
        supplierCode: row.supplierCode,
        productName: row.productName,
        quantity: row.quantity,
        unitCost: row.unitCost,
        source: `data/nabavne_cene.csv:${row.row}`,
        quote: row.quote,
      })),
      evidenceIds: dataset.invoicePairs.flatMap(({ invoice, deliveryNote }) => [
        `invoice:${invoice.file}`,
        ...(deliveryNote ? [`delivery:${deliveryNote.file}`] : []),
      ]),
    }),
  };
}

export function buildRetailEvidenceFacts(
  dataset: RetailDataset,
  analysis: RetailAnalysis
): Map<string, string> {
  const facts = new Map<string, string>();
  const add = (id: string, value: unknown) => facts.set(id, JSON.stringify(value));
  const itemSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  add('sales:overview', {
    periodStart: analysis.periodStart,
    periodEnd: analysis.periodEnd,
    daily: analysis.dailySales.map(({ date, units, grossRevenue, netRevenue, receipts }) => ({
      date,
      units,
      grossRevenue,
      netRevenue,
      receipts,
    })),
    weekly: analysis.weeklySales.map(({ week, start, end, units, grossRevenue, netRevenue }) => ({
      week,
      start,
      end,
      units,
      grossRevenue,
      netRevenue,
    })),
  });

  for (const product of analysis.products) {
    add(`sales:${product.code}:weekly-trend`, {
      code: product.code,
      name: product.name,
      units: product.units,
      grossRevenue: product.grossRevenue,
      netRevenue: product.netRevenue,
      trendPercent: product.trendPercent,
      weeks: product.weeks.map(({ week, start, end, units, grossRevenue, netRevenue }) => ({
        week,
        start,
        end,
        units,
        grossRevenue,
        netRevenue,
      })),
    });
  }

  for (const item of analysis.inventory) {
    add(`inventory:${itemSlug(item.deliveryName)}`, {
      deliveryName: item.deliveryName,
      received: item.received,
      consumed: item.consumed,
      recordedShortfall: item.recordedShortfall,
      remaining: item.remaining,
      expired: item.expired,
      nextExpiry: item.nextExpiry,
      lots: item.lots.map(({ file, deliveryNote, quantity, expiryDate, remaining, expired, quote }) => ({
        file,
        deliveryNote,
        quantity,
        expiryDate,
        remaining,
        expired,
        quote,
      })),
    });
  }

  for (const margin of analysis.productMargins) {
    add(`margin:${margin.code}`, {
      code: margin.code,
      name: margin.name,
      unitsSold: margin.unitsSold,
      netRevenue: margin.netRevenue,
      pricedNetRevenue: margin.pricedNetRevenue,
      costOfGoods: margin.costOfGoods,
      grossMargin: margin.grossMargin,
      pricedUnits: margin.pricedUnits,
    });
  }

  for (const change of analysis.purchasePriceChanges) {
    add(`purchase:${change.supplierCode}`, {
      productName: change.productName,
      supplierCode: change.supplierCode,
      previousPrice: change.previousPrice,
      previousDate: change.previousDate,
      latestPrice: change.latestPrice,
      latestDate: change.latestDate,
      changePercent: change.changePercent,
    });
  }

  for (const month of analysis.monthlyFinance) {
    add(`finance:${month.month}`, {
      month: month.month,
      salesDays: month.salesDays,
      netRevenue: month.netRevenue,
      pricedNetRevenue: month.pricedNetRevenue,
      costOfGoods: month.costOfGoods,
      grossMargin: month.grossMargin,
      costCoveragePercent: month.costCoveragePercent,
      estimatedMonthlyRunRate: month.estimatedMonthlyRunRate,
      operatingCosts: month.operatingCosts,
    });
  }

  for (const { invoice, deliveryNote } of dataset.invoicePairs) {
    add(`invoice:${invoice.file}`, invoice.text);
    if (deliveryNote) add(`delivery:${deliveryNote.file}`, deliveryNote.text);
  }

  return facts;
}

export function defaultDataRoot(): string {
  return resolve(process.cwd());
}
