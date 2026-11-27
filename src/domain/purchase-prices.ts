import { readFileSync } from 'node:fs';

import { parseLocalNumber } from './document-draft.js';

/** One row of data/nabavne_cene.csv: the agreed purchase price of one invoice line. */
export interface AgreedPrice {
  /** Line number in the file; the header is line 1. */
  row: number;
  date: string;
  invoiceNumber: string;
  deliveryNote: string;
  supplierCode: string | null;
  name: string;
  unit: string;
  quantity: number;
  /** Price per unit without VAT, RSD. */
  price: number;
}

/** Reads the agreed prices (";" separated, decimal comma). Rows without a readable price are skipped. */
export function readAgreedPrices(csvPath: string): AgreedPrice[] {
  const lines = readFileSync(csvPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  const header = (lines[0] ?? '').split(';');
  const column = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`${csvPath} has no column "${name}"`);
    return index;
  };
  const c = {
    date: column('datum'),
    invoice: column('broj_fakture'),
    note: column('veza_otpremnica'),
    code: column('sifra_dobavljaca'),
    name: column('naziv'),
    unit: column('jm'),
    quantity: column('kolicina'),
    price: column('nabavna_cena_bez_pdv'),
  };

  const prices: AgreedPrice[] = [];
  lines.forEach((line, i) => {
    if (i === 0 || line.trim() === '') return;
    const f = line.split(';');
    const price = parseLocalNumber(f[c.price] ?? '');
    if (price === null) return;
    prices.push({
      row: i + 1,
      date: f[c.date] ?? '',
      invoiceNumber: f[c.invoice] ?? '',
      deliveryNote: f[c.note] ?? '',
      supplierCode: f[c.code] || null,
      name: f[c.name] ?? '',
      unit: f[c.unit] ?? '',
      quantity: parseLocalNumber(f[c.quantity] ?? '') ?? 0,
      price,
    });
  });
  return prices;
}

/**
 * The price an invoice line should have: the row agreed for this invoice and code, or else
 * the latest earlier price for the code. undefined when the code has no price at all.
 */
export function agreedPriceFor(
  prices: readonly AgreedPrice[],
  invoiceNumber: string,
  supplierCode: string,
  invoiceDate: string,
): { price: AgreedPrice; basis: 'invoice' | 'previous' } | undefined {
  const forInvoice = prices.find((p) => p.invoiceNumber === invoiceNumber && p.supplierCode === supplierCode);
  if (forInvoice) return { price: forInvoice, basis: 'invoice' };

  const earlier = prices
    .filter((p) => p.supplierCode === supplierCode && p.date <= invoiceDate)
    .sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row)
    .at(-1);
  return earlier ? { price: earlier, basis: 'previous' } : undefined;
}
