// Test helper: parses the fixed synthetic template into the answer a perfect
// clerk agent would return. Only for tests and the stubbed runtime — the app
// itself relies on the LLM (any layout) plus verifyInvoice/verifyNote.

import { readFileSync } from 'node:fs';

import type { InvoiceDoc, NoteDoc } from '../src/documents.js';

const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const iso = (d: string) => d.split('.').reverse().join('-');
const after = (text: string, label: string) => {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.startsWith(label));
  return lines[i + 1]!.trim();
};
const s = <T>(value: T, quote: string) => ({ value, quote });

export function idealInvoice(text: string): InvoiceDoc {
  const supplierName = text.split('\n')[1]!.trim();
  const pib = /PIB: (\d{9})/.exec(text)![1]!;
  const account = /Tekući račun: ([\d-]+)/.exec(text)![1]!;
  const number = /Račun broj: (\S+)/.exec(text)![1]!;
  const total = /Za uplatu RSD: ([\d.,]+)/.exec(text)![1]!;
  const issue = after(text, 'Datum izdavanja:');
  const due = after(text, 'Rok plaćanja:');
  const note = after(text, 'Po otpremnici br.:');
  const lines = text
    .split('\n')
    .map((l) => /^(\d+)\. (\S+) (.+?) ([\d,]+) (\S+) ([\d.]+,\d{2}) \d+% (\d+) ([\d.]+,\d{2})$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      code: m[2]!,
      name: m[3]!,
      quantity: num(m[4]!),
      unit: m[5]!,
      unitPrice: num(m[6]!),
      vatRate: Number(m[7]),
      lineTotal: num(m[8]!),
      quote: m[0],
    }));
  return {
    invoiceNumber: s(number, `Račun broj: ${number}`),
    supplierName: s(supplierName, supplierName),
    supplierPib: s(pib, `PIB: ${pib}`),
    supplierAccount: s(account, `Tekući račun: ${account}`),
    issueDate: s(iso(issue), issue),
    dueDate: s(iso(due), due),
    deliveryNote: s(note, note),
    totalAmount: s(num(total), `Za uplatu RSD: ${total}`),
    lines,
  };
}

export function idealNote(text: string): NoteDoc {
  const number = /OTPREMNICA br\. (\S+)/.exec(text)![1]!;
  const pib = /PIB: (\d{9})/.exec(text)![1]!;
  const date = /Mesto isporuke: (\d{2}\.\d{2}\.\d{4})/.exec(text)![1]!;
  const lines = text
    .split('\n')
    .map((l) => /^(\d+) ([A-Z]{2,4}-\S+) (.+?) (kom|kut|pak|l|kg) ([\d,]+)(?: (\d{2}\.\d{2}\.\d{4}))?/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ ...m, 0: m.input.trim() }) as unknown as RegExpExecArray) // quote = the whole printed row
    .map((m) => ({
      code: m[2]!,
      name: m[3]!,
      unit: m[4]!,
      quantity: num(m[5]!),
      expiryDate: m[6] ? iso(m[6]) : '',
      quote: m[0],
    }));
  return {
    noteNumber: s(number, `OTPREMNICA br. ${number}`),
    supplierPib: s(pib, `PIB: ${pib}`),
    deliveryDate: s(iso(date), date),
    lines,
  };
}

export const readDoc = (file: string) =>
  readFileSync(new URL(`../data/text/${file}`, import.meta.url), 'utf8');
