// Supplier documents (invoice = "faktura", delivery note = "otpremnica"):
// what the clerk agents return, how their answers are parsed, and how every
// returned value is checked against the document text before it is used.

import {
  compact,
  dateInQuote,
  extractJson,
  isNumber,
  isObject,
  isString,
  quoteInSource,
  sourced,
  squash,
  type Parsed,
  type Sourced,
} from './parsing.js';

export interface InvoiceLine {
  code: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number; // excl. VAT
  vatRate: number;
  lineTotal: number; // incl. VAT
  quote: string;
}

export interface InvoiceDoc {
  invoiceNumber: Sourced<string>;
  supplierName: Sourced<string>;
  supplierPib: Sourced<string>;
  supplierAccount: Sourced<string>;
  issueDate: Sourced<string>; // YYYY-MM-DD
  dueDate: Sourced<string>;
  deliveryNote: Sourced<string>;
  totalAmount: Sourced<number>; // "Za uplatu"
  lines: InvoiceLine[];
}

export interface NoteLine {
  code: string;
  name: string;
  unit: string;
  quantity: number;
  expiryDate: string; // YYYY-MM-DD or "" when not printed
  quote: string;
}

export interface NoteDoc {
  noteNumber: Sourced<string>;
  supplierPib: Sourced<string>;
  deliveryDate: Sourced<string>;
  lines: NoteLine[];
}

// Numbers as printed in one table row or label, token by token, so adjacent
// columns ("96 kom 79,00 0% 20 9.100,80") are never merged.
export function numbersIn(quote: string): number[] {
  return quote
    .split(/\s+/)
    .map((t) => t.replace(/[%:]$/, ''))
    .filter((t) => /^\d{1,3}(\.\d{3})+(,\d+)?$|^\d+(,\d+)?$/.test(t))
    .map((t) => Number(t.replace(/\./g, '').replace(',', '.')));
}

const has = (numbers: number[], n: number) => numbers.some((x) => Math.abs(x - n) < 0.005);

// How a value must appear in a printed row: money with cents ("175,00",
// "9.240,00"), counts and rates as plain numbers ("48", "10").
const printedAs = (n: number, money: boolean) =>
  n.toLocaleString('sr-RS', money ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 3 });
const tokensOf = (quote: string) => new Set(quote.split(/\s+/).map((t) => t.replace(/[%:]$/, '')));

function lines<T>(raw: unknown, parse: (item: Record<string, unknown>, i: number) => T): T[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('lines must be a non-empty array');
  return raw.map((item: unknown, i: number) => {
    if (!isObject(item)) throw new Error(`lines[${i}] must be an object`);
    return parse(item, i);
  });
}

const field = <T>(item: Record<string, unknown>, key: string, i: number, guard: (x: unknown) => x is T): T => {
  if (!guard(item[key])) throw new Error(`lines[${i}].${key} is missing or has the wrong type`);
  return item[key] as T;
};
const anyString = (x: unknown): x is string => typeof x === 'string';

export function parseInvoice(answer: string): Parsed<InvoiceDoc> {
  try {
    const raw = extractJson(answer);
    if (!isObject(raw)) throw new Error('answer is not an object');
    return {
      ok: true,
      value: {
        invoiceNumber: sourced(raw.invoiceNumber, 'invoiceNumber', isString),
        supplierName: sourced(raw.supplierName, 'supplierName', isString),
        supplierPib: sourced(raw.supplierPib, 'supplierPib', isString),
        supplierAccount: sourced(raw.supplierAccount, 'supplierAccount', isString),
        issueDate: sourced(raw.issueDate, 'issueDate', isString),
        dueDate: sourced(raw.dueDate, 'dueDate', isString),
        deliveryNote: sourced(raw.deliveryNote, 'deliveryNote', isString),
        totalAmount: sourced(raw.totalAmount, 'totalAmount', isNumber),
        lines: lines(raw.lines, (item, i) => ({
          code: field(item, 'code', i, isString),
          name: field(item, 'name', i, isString),
          quantity: field(item, 'quantity', i, isNumber),
          unit: field(item, 'unit', i, isString),
          unitPrice: field(item, 'unitPrice', i, isNumber),
          vatRate: field(item, 'vatRate', i, isNumber),
          lineTotal: field(item, 'lineTotal', i, isNumber),
          quote: field(item, 'quote', i, isString),
        })),
      },
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export function parseNote(answer: string): Parsed<NoteDoc> {
  try {
    const raw = extractJson(answer);
    if (!isObject(raw)) throw new Error('answer is not an object');
    return {
      ok: true,
      value: {
        noteNumber: sourced(raw.noteNumber, 'noteNumber', isString),
        supplierPib: sourced(raw.supplierPib, 'supplierPib', isString),
        deliveryDate: sourced(raw.deliveryDate, 'deliveryDate', isString),
        lines: lines(raw.lines, (item, i) => ({
          code: field(item, 'code', i, isString),
          name: field(item, 'name', i, isString),
          unit: field(item, 'unit', i, isString),
          quantity: field(item, 'quantity', i, isNumber),
          expiryDate: field(item, 'expiryDate', i, anyString),
          quote: field(item, 'quote', i, isString),
        })),
      },
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

// Messages are for the person who re-checks the invoice: which field or item,
// what the clerk read, and what the document prints.
const FIELD: Record<string, string> = {
  invoiceNumber: 'Invoice number',
  supplierName: 'Supplier name',
  supplierPib: 'Supplier PIB',
  supplierAccount: 'Bank account',
  deliveryNote: 'Delivery note number',
  issueDate: 'Issue date',
  dueDate: 'Due date',
  totalAmount: 'Total to pay',
  noteNumber: 'Delivery note number',
  deliveryDate: 'Delivery date',
};
const item = (l: { code: string; name: string }) => `${l.code} ${l.name}`;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// What the row actually prints for the quantity: on an invoice the read
// quantity and the unit after it ("22 kom"); on a delivery note the read unit
// and the number after it ("kom 120").
function printedQuantity(quote: string, quantity: number, unit: string, unitFirst: boolean): string | undefined {
  const re = unitFirst
    ? new RegExp(`(?:^|\\s)(${escapeRe(unit)} \\d[\\d.,]*)(?=\\s|$)`, 'u')
    : new RegExp(`(?:^|\\s)(${escapeRe(printedAs(quantity, false))} [\\p{L}.]+)(?=\\s|$)`, 'u');
  return re.exec(quote)?.[1];
}

// Header field checks: the quote is in the document and contains the value.
function checkText(problems: string[], name: string, s: Sourced<string>, text: string): void {
  const label = FIELD[name] ?? name;
  if (!quoteInSource(s.quote, text)) problems.push(`${label}: the quoted text "${s.quote}" is not on the document`);
  else if (!compact(s.quote).includes(compact(s.value))) problems.push(`${label}: read "${s.value}", but the document says "${s.quote}"`);
}
function checkDate(problems: string[], name: string, s: Sourced<string>, text: string): void {
  const label = FIELD[name] ?? name;
  if (!quoteInSource(s.quote, text)) problems.push(`${label}: the quoted text "${s.quote}" is not on the document`);
  else if (!dateInQuote(s.value, s.quote)) problems.push(`${label}: read ${s.value}, but the document says "${s.quote}"`);
}
// A line quote must be one whole printed row: a shortened quote could hide a
// column (e.g. the expiry date), a longer one could borrow the next row's values.
const isWholeLine = (quote: string, text: string) => text.split('\n').some((line) => squash(line) === squash(quote));

function checkLine(problems: string[], name: string, quote: string, text: string, code: string, values: { n: number; money: boolean }[]): void {
  if (!isWholeLine(quote, text)) return void problems.push(`${name}: the quoted row is not a whole row of the document ("${quote}")`);
  if (!compact(quote).includes(compact(code))) return void problems.push(`${name}: the quoted row doesn't contain the code ${code} ("${quote}")`);
  const tokens = tokensOf(quote);
  const missing = values.filter(({ n, money }) => !tokens.has(printedAs(n, money))).map(({ n, money }) => printedAs(n, money));
  if (missing.length) problems.push(`${name}: read ${missing.join(', ')}, which ${missing.length > 1 ? 'are' : 'is'} not printed in the row "${quote}"`);
}

// One message per value that can't be traced to the document text.
export function verifyInvoice(doc: InvoiceDoc, text: string): string[] {
  const problems: string[] = [];
  checkText(problems, 'invoiceNumber', doc.invoiceNumber, text);
  checkText(problems, 'supplierName', doc.supplierName, text);
  checkText(problems, 'supplierPib', doc.supplierPib, text);
  checkText(problems, 'supplierAccount', doc.supplierAccount, text);
  checkText(problems, 'deliveryNote', doc.deliveryNote, text);
  checkDate(problems, 'issueDate', doc.issueDate, text);
  checkDate(problems, 'dueDate', doc.dueDate, text);
  if (!quoteInSource(doc.totalAmount.quote, text)) problems.push(`Total to pay: the quoted text "${doc.totalAmount.quote}" is not on the document`);
  else if (!has(numbersIn(doc.totalAmount.quote), doc.totalAmount.value)) problems.push(`Total to pay: read ${printedAs(doc.totalAmount.value, true)}, but the document says "${doc.totalAmount.quote}"`);
  doc.lines.forEach((l) => {
    // Quantity must be the column before the unit ("96 kom"), not any number in the row.
    if (!compact(l.quote).includes(compact(`${printedAs(l.quantity, false)} ${l.unit}`))) {
      const printed = printedQuantity(l.quote, l.quantity, l.unit, false);
      problems.push(`${item(l)}: read quantity "${printedAs(l.quantity, false)} ${l.unit}", ${printed ? `the invoice prints "${printed}"` : `not printed as such in the row "${l.quote}"`}`);
    }
    checkLine(problems, item(l), l.quote, text, l.code, [
      { n: l.quantity, money: false },
      { n: l.unitPrice, money: true },
      { n: l.vatRate, money: false },
      { n: l.lineTotal, money: true },
    ]);
  });
  return problems;
}

export function verifyNote(doc: NoteDoc, text: string): string[] {
  const problems: string[] = [];
  checkText(problems, 'noteNumber', doc.noteNumber, text);
  checkText(problems, 'supplierPib', doc.supplierPib, text);
  checkDate(problems, 'deliveryDate', doc.deliveryDate, text);
  doc.lines.forEach((l) => {
    checkLine(problems, item(l), l.quote, text, l.code, [{ n: l.quantity, money: false }]);
    // Delivery notes print unit then quantity ("kom 120").
    if (!compact(l.quote).includes(compact(`${l.unit} ${printedAs(l.quantity, false)}`))) {
      const printed = printedQuantity(l.quote, l.quantity, l.unit, true);
      problems.push(`${item(l)}: read quantity "${l.unit} ${printedAs(l.quantity, false)}", ${printed ? `the delivery note prints "${printed}"` : `not printed as such in the row "${l.quote}"`}`);
    }
    if (l.expiryDate && !dateInQuote(l.expiryDate, l.quote)) problems.push(`${item(l)}: read expiry ${l.expiryDate}, which is not in the row "${l.quote}"`);
    if (!l.expiryDate && /\d{2}\.\d{2}\.\d{4}/.test(l.quote)) problems.push(`${item(l)}: the row prints an expiry date but none was read ("${l.quote}")`);
  });
  return problems;
}
