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

// Header field checks: the quote is in the document and contains the value.
function checkText(problems: string[], name: string, s: Sourced<string>, text: string): void {
  if (!quoteInSource(s.quote, text)) problems.push(`${name}: quote "${s.quote}" not found in document`);
  else if (!compact(s.quote).includes(compact(s.value))) problems.push(`${name}: "${s.value}" does not match quote "${s.quote}"`);
}
function checkDate(problems: string[], name: string, s: Sourced<string>, text: string): void {
  if (!quoteInSource(s.quote, text)) problems.push(`${name}: quote "${s.quote}" not found in document`);
  else if (!dateInQuote(s.value, s.quote)) problems.push(`${name}: date ${s.value} does not match quote "${s.quote}"`);
}
function checkLine(problems: string[], name: string, quote: string, text: string, code: string, values: { n: number; money: boolean }[]): void {
  if (!quoteInSource(quote, text)) return void problems.push(`${name}: quote "${quote}" not found in document`);
  if (!compact(quote).includes(compact(code))) return void problems.push(`${name}: code ${code} not in quote "${quote}"`);
  const tokens = tokensOf(quote);
  const missing = values.filter(({ n, money }) => !tokens.has(printedAs(n, money))).map(({ n }) => n);
  if (missing.length) problems.push(`${name}: ${missing.join(', ')} not printed in "${quote}"`);
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
  if (!quoteInSource(doc.totalAmount.quote, text)) problems.push(`totalAmount: quote "${doc.totalAmount.quote}" not found in document`);
  else if (!has(numbersIn(doc.totalAmount.quote), doc.totalAmount.value)) problems.push(`totalAmount: ${doc.totalAmount.value} not printed in "${doc.totalAmount.quote}"`);
  doc.lines.forEach((l, i) =>
    checkLine(problems, `lines[${i}] ${l.code}`, l.quote, text, l.code, [
      { n: l.quantity, money: false },
      { n: l.unitPrice, money: true },
      { n: l.vatRate, money: false },
      { n: l.lineTotal, money: true },
    ])
  );
  return problems;
}

export function verifyNote(doc: NoteDoc, text: string): string[] {
  const problems: string[] = [];
  checkText(problems, 'noteNumber', doc.noteNumber, text);
  checkText(problems, 'supplierPib', doc.supplierPib, text);
  checkDate(problems, 'deliveryDate', doc.deliveryDate, text);
  doc.lines.forEach((l, i) => {
    checkLine(problems, `lines[${i}] ${l.code}`, l.quote, text, l.code, [{ n: l.quantity, money: false }]);
    if (l.expiryDate && !dateInQuote(l.expiryDate, l.quote)) problems.push(`lines[${i}] ${l.code}: expiry ${l.expiryDate} not in "${l.quote}"`);
  });
  return problems;
}
