import { readFileSync } from 'node:fs';

import { parseLocalNumber } from './document-draft.js';

export const SALES_FILE_NAME = 'data/promet_2026-11-26_do_2026-12-25.csv';

/** One line of a fiscal receipt from the cash register export. */
export interface SaleRow {
  /** Line number in the file; the header is line 1. */
  row: number;
  date: string;
  time: string;
  receiptNumber: string;
  /** "Promet Prodaja", or "Promet Refundacija" with a negative quantity. */
  type: string;
  articleCode: number;
  name: string;
  quantity: number;
}

/** Reads the sales export (";" separated, decimal comma). */
export function readSales(csvPath: string): SaleRow[] {
  const lines = readFileSync(csvPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  const header = (lines[0] ?? '').split(';');
  const column = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`${csvPath} has no column "${name}"`);
    return index;
  };
  const c = {
    date: column('datum'),
    time: column('vreme'),
    receipt: column('pfr_broj_racuna'),
    type: column('vrsta_racuna'),
    article: column('sifra_artikla'),
    name: column('naziv'),
    quantity: column('kolicina'),
  };

  const rows: SaleRow[] = [];
  lines.forEach((line, i) => {
    if (i === 0 || line.trim() === '') return;
    const f = line.split(';');
    const quantity = parseLocalNumber(f[c.quantity] ?? '');
    if (quantity === null) return;
    rows.push({
      row: i + 1,
      date: f[c.date] ?? '',
      time: f[c.time] ?? '',
      receiptNumber: f[c.receipt] ?? '',
      type: f[c.type] ?? '',
      articleCode: Number(f[c.article]),
      name: f[c.name] ?? '',
      quantity,
    });
  });
  return rows;
}
