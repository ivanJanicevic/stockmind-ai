import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { documentById, documentItems, itemById, receiptForInvoice } from '../../db/documents.js';
import type { FindingRow, FindingType } from '../../db/findings.js';
import { receivedLots } from '../../db/stock.js';
import {
  formatNumber,
  lineHasDate,
  lineHasNumber,
  sameNumber,
  sourceRefs,
  textCheck,
  type AuditCheck,
} from '../../domain/audit.js';
import { parseLocalNumber, toLocalDate } from '../../domain/document-draft.js';
import { extractPdfLines } from '../../domain/pdf.js';
import { itemKey, PRICE_FILE_NAME } from '../../domain/procurement.js';
import type { Article } from '../../domain/profit.js';
import type { AgreedPrice } from '../../domain/purchase-prices.js';
import type { Recipes } from '../../domain/recipes.js';
import { salesFindingValues, salesIssueKey, salesIssues } from '../sales/tools.js';
import { SALES_FILE_NAME, type SaleRow } from '../../domain/sales.js';
import { checkStock, stockDateOfKey, stockFindingValues } from '../../domain/stock.js';

export interface AuditContext {
  db: DatabaseSync;
  recipes: Recipes;
  sales: readonly SaleRow[];
  prices: readonly AgreedPrice[];
  articles: readonly Article[];
  /** Where the PDFs a finding's izvor names live ("fakture/...", "otpremnice/..."). */
  dataDir: string;
}

/** Every number in a value, however deep: what the agent was shown, so its text may use it. */
function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(numbersIn);
  return [];
}

/** A finding as the Auditor checked it: its numbers, its text and every check with its result. */
export interface FindingAudit {
  findingId: number;
  agent: string;
  type: FindingType;
  expected: number | null;
  actual: number | null;
  amountWithoutVat: number | null;
  explanation: string;
  suggestion: string | null;
  source: string;
  checks: AuditCheck[];
  /** True only when every check passed. */
  passed: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Checks findings against their sources, in code: the original PDF lines, the cash register rows and
 * the confirmed receipts are read again, and numbers that are not printed anywhere (amounts, stock
 * left) are recomputed from the current data.
 */
export function createFindingAuditor(ctx: AuditContext) {
  const { db, recipes, sales } = ctx;
  const pdfs = new Map<string, Promise<string[]>>();
  const salesByRow = new Map(sales.map((s) => [s.row, s]));
  const latestSaleDate = sales.reduce((max, s) => (s.date > max ? s.date : max), '');

  function pdfLines(file: string): Promise<string[]> {
    let lines = pdfs.get(file);
    if (!lines) {
      lines = extractPdfLines(new Uint8Array(readFileSync(path.join(ctx.dataDir, file)))).catch(() => []);
      pdfs.set(file, lines);
    }
    return lines;
  }

  /** The text of "file.pdf:N", or undefined if there is no such line. */
  async function pdfLine(ref: string): Promise<string | undefined> {
    const at = ref.lastIndexOf(':');
    const lines = await pdfLines(ref.slice(0, at));
    return lines[Number(ref.slice(at + 1)) - 1];
  }

  const csvFiles = new Map<string, string[]>();
  /** Row N of a CSV named from the project root ("data/nabavne_cene.csv"); the header is row 1. */
  function csvRow(file: string, row: number): string | undefined {
    let lines = csvFiles.get(file);
    if (!lines) {
      try {
        lines = readFileSync(path.resolve(ctx.dataDir, '..', file), 'utf8').replace(/^﻿/, '').split(/\r?\n/);
      } catch {
        lines = [];
      }
      csvFiles.set(file, lines);
    }
    const text = lines[row - 1];
    return text === undefined || text.trim() === '' ? undefined : text;
  }

  /** Every source reference must exist. Returns the check and the quoted source text. */
  async function sourcesExist(izvor: string): Promise<{ check: AuditCheck; quoted: string }> {
    const refs = sourceRefs(izvor);
    const missing: string[] = [];
    const quoted: string[] = [];
    for (const { file, line } of refs.pdf) {
      const text = await pdfLine(`${file}:${line}`);
      if (text === undefined) missing.push(`${file}:${line}`);
      else quoted.push(`${file}:${line} "${text}"`);
    }
    for (const { file, row } of refs.csv) {
      if (file === SALES_FILE_NAME) {
        const sale = salesByRow.get(row);
        if (!sale) missing.push(`${file}:${row}`);
        else quoted.push(`${file}:${row} ${sale.date} ${sale.time} ${sale.name} ${formatNumber(sale.quantity)}`);
      } else {
        const text = csvRow(file, row);
        if (text === undefined) missing.push(`${file}:${row}`);
        else quoted.push(`${file}:${row} ${text}`);
      }
    }
    const count = refs.pdf.length + refs.csv.length;
    return {
      check: {
        check: 'izvori postoje',
        ok: count > 0 && missing.length === 0,
        detail:
          count === 0
            ? 'nalaz ne navodi nijednu liniju PDF-a ni red prometa'
            : missing.length > 0
              ? `ne postoje: ${missing.join(', ')}`
              : `${count} referenci, sve postoje`,
      },
      quoted: quoted.join('; '),
    };
  }

  /** Nabavka: invoiced quantity on the invoice line, received quantity on the confirmed receipt, amount recomputed. */
  async function quantityChecks(f: FindingRow): Promise<{ checks: AuditCheck[]; sources: string; values: number[] }> {
    const invoice = f.dokument_id === null ? undefined : documentById(db, f.dokument_id);
    const item = f.stavka_id === null ? undefined : itemById(db, f.stavka_id);
    if (!invoice || !item) {
      return { checks: [{ check: 'stavka fakture', ok: false, detail: 'nalaz ne pokazuje na stavku fakture u bazi' }], sources: '', values: [] };
    }

    const checks: AuditCheck[] = [];
    const invoiceLine = await pdfLine(item.izvor);
    checks.push({
      check: 'fakturisana količina',
      ok: invoiceLine !== undefined && sameNumber(item.kolicina, f.stvarno) && lineHasNumber(invoiceLine, item.kolicina),
      detail: `nalaz: ${formatNumber(f.stvarno)}; ${item.izvor}: "${invoiceLine ?? 'linija ne postoji'}"`,
    });

    const receipt = receiptForInvoice(db, invoice);
    if (!receipt) {
      checks.push({ check: 'primljena količina', ok: false, detail: `nema potvrđene prijemnice za otpremnicu ${invoice.veza_broj ?? '?'}` });
      return { checks, sources: invoiceLine ?? '', values: [item.kolicina] };
    }
    const match = documentItems(db, receipt.id).find((r) => itemKey(r) === itemKey(item));
    const received = match ? (match.kolicina_primljena ?? match.kolicina) : 0;
    checks.push({
      check: 'primljena količina',
      ok: sameNumber(received, f.ocekivano),
      detail: match
        ? `nalaz: ${formatNumber(f.ocekivano)}; ${receipt.broj} stavka ${match.redni_broj}: primljeno ${formatNumber(received)}, potvrdio ${receipt.potvrdio ?? '?'}`
        : `nalaz: ${formatNumber(f.ocekivano)}; stavke nema na ${receipt.broj}, primljeno 0`,
    });

    let noteLine: string | undefined;
    if (match) {
      noteLine = await pdfLine(match.izvor);
      checks.push({
        check: 'otpremnica',
        ok: noteLine !== undefined && lineHasNumber(noteLine, match.kolicina),
        detail: `isporučeno ${formatNumber(match.kolicina)}; ${match.izvor}: "${noteLine ?? 'linija ne postoji'}"`,
      });
    }

    const price = item.cena;
    const amount = price === null ? null : round2((item.kolicina - received) * price);
    checks.push({
      check: 'iznos',
      ok: price !== null && invoiceLine !== undefined && lineHasNumber(invoiceLine, price) && sameNumber(amount, f.iznos_bez_pdv),
      detail: `(${formatNumber(item.kolicina)} - ${formatNumber(received)}) x ${formatNumber(price)} = ${formatNumber(amount)}; nalaz: ${formatNumber(f.iznos_bez_pdv)}`,
    });

    const values = [item.kolicina, received, item.kolicina - received, price, amount].filter((n): n is number => n !== null);
    return { checks, sources: `${invoiceLine ?? ''} ${noteLine ?? ''}`, values };
  }

  /** Zalihe: the stock is computed again for the finding's date and must give the same issue and numbers. */
  async function stockChecks(f: FindingRow): Promise<{ checks: AuditCheck[]; sources: string; values: number[] }> {
    if (!f.kljuc) {
      return { checks: [{ check: 'ponovni obračun', ok: false, detail: 'nalaz nema ključ, pa ne može da se ponovo izračuna' }], sources: '', values: [] };
    }
    const asOf = stockDateOfKey(f.kljuc) ?? latestSaleDate;
    const lots = receivedLots(db);
    const issue = checkStock(lots, sales, recipes, asOf).issues.find((i) => i.key === f.kljuc);
    if (!issue) {
      return {
        checks: [{ check: 'ponovni obračun', ok: false, detail: `stanje na dan ${asOf} više ne daje ovaj nalaz (${f.kljuc})` }],
        sources: '',
        values: [],
      };
    }

    const checks: AuditCheck[] = [];
    const v = stockFindingValues(issue);
    checks.push({
      check: 'ponovni obračun',
      ok: v.type === f.tip && sameNumber(v.expected, f.ocekivano) && sameNumber(v.actual, f.stvarno),
      detail:
        `stanje na dan ${asOf}, ${issue.kind}: ` +
        (issue.kind === 'shortage'
          ? `primljeno ${formatNumber(issue.received)}, prodato ${formatNumber(issue.sold)}, preko stanja ${formatNumber(issue.over)}`
          : `na stanju ${formatNumber(issue.remaining)}, rok ${issue.expiry ? toLocalDate(issue.expiry) : '-'}` +
            (issue.daysLeft !== undefined ? `, ${issue.daysLeft} dana do isteka` : '') +
            (issue.projectedLeftover !== undefined ? `, procena viška ${formatNumber(issue.projectedLeftover)}` : '')) +
        `; nalaz: očekivano ${formatNumber(f.ocekivano)}, stvarno ${formatNumber(f.stvarno)}`,
    });

    // The lots behind the issue: each delivery note line must show the delivered quantity (and expiry).
    const key = f.kljuc.split('|').slice(1, -1).join('|');
    const issueLots =
      issue.kind === 'shortage'
        ? lots.filter((l) => l.receivedOn <= asOf && recipes.stockItemFor(l.supplierCode, l.name)?.key === key)
        : lots.filter((l) => l.itemId === issue.itemId);
    const lines: string[] = [];
    const bad: string[] = [];
    for (const lot of issueLots) {
      const delivered = itemById(db, lot.itemId)?.kolicina ?? lot.quantity;
      const line = await pdfLine(lot.source);
      lines.push(line ?? '');
      const expiryOk = issue.kind === 'shortage' || lot.expiry === null || (line !== undefined && lineHasDate(line, lot.expiry));
      if (line === undefined || !lineHasNumber(line, delivered) || !expiryOk) bad.push(`${lot.source}: "${line ?? 'linija ne postoji'}"`);
    }
    const first = issueLots[0];
    checks.push({
      check: 'otpremnica',
      ok: issueLots.length > 0 && bad.length === 0,
      detail:
        bad.length > 0
          ? `ne slaže se sa otpremnicom: ${bad.join('; ')}`
          : issue.kind === 'shortage'
            ? `${issueLots.length} isporuka, količine se slažu sa otpremnicama`
            : `${first?.source}: "${lines[0]}"` + (first && first.quantity !== itemById(db, first.itemId)?.kolicina ? `; vlasnik potvrdio ${formatNumber(first.quantity)}` : ''),
    });

    if (issue.kind === 'shortage' && issue.firstSaleOverStock) {
      const sale = salesByRow.get(issue.firstSaleOverStock.row);
      const usesItem = sale ? (recipes.componentsOf(sale.articleCode) ?? []).some((c) => c.key === key) : false;
      checks.push({
        check: 'prva prodaja preko stanja',
        ok: sale !== undefined && usesItem && sale.date <= asOf,
        detail: sale
          ? `${SALES_FILE_NAME}:${sale.row} ${sale.date} ${sale.time} ${sale.name} ${formatNumber(sale.quantity)}`
          : `red ${issue.firstSaleOverStock.row} ne postoji u prometu`,
      });
    }

    return { checks, sources: `${lines.join(' ')} ${JSON.stringify(issue)}`, values: numbersIn(issue) };
  }

  /** Prodaja: prices, margins and sales are computed again for the finding's date and must give the same numbers. */
  async function salesChecks(f: FindingRow): Promise<{ checks: AuditCheck[]; sources: string; values: number[] }> {
    if (!f.kljuc) {
      return { checks: [{ check: 'ponovni obračun', ok: false, detail: 'nalaz nema ključ, pa ne može da se ponovo izračuna' }], sources: '', values: [] };
    }
    const asOf = stockDateOfKey(f.kljuc) ?? latestSaleDate;
    const issue = salesIssues(ctx, asOf).find((i) => salesIssueKey(i) === f.kljuc);
    if (!issue) {
      return {
        checks: [{ check: 'ponovni obračun', ok: false, detail: `podaci na dan ${asOf} više ne daju ovaj nalaz (${f.kljuc})` }],
        sources: '',
        values: [],
      };
    }
    const v = salesFindingValues(issue);
    const same = v.type === f.tip && sameNumber(v.expected, f.ocekivano) && sameNumber(v.actual, f.stvarno) && sameNumber(v.amountWithoutVat, f.iznos_bez_pdv);
    const recomputed =
      issue.kind === 'price'
        ? `ugovoreno ${formatNumber(issue.difference.agreedPrice)}, fakturisano ${formatNumber(issue.difference.invoicedPrice)}, ` +
          `x ${formatNumber(issue.difference.quantity)} = ${formatNumber(issue.difference.amountWithoutVat)}`
        : issue.kind === 'margin'
          ? `nabavna ${formatNumber(issue.drop.before.cost)} -> ${formatNumber(issue.drop.after.cost)}, marža ` +
            `${formatNumber(issue.drop.before.marginPercent)}% -> ${formatNumber(issue.drop.after.marginPercent)}%, ` +
            `prodato ${formatNumber(issue.drop.soldSince)}, izgubljeno ${formatNumber(issue.drop.lostMargin)}`
          : `nedeljno ${issue.drop.weeks.map((w) => formatNumber(w.quantity)).join(' / ')} (${formatNumber(issue.drop.percent)}%)`;
    const checks: AuditCheck[] = [
      {
        check: 'ponovni obračun',
        ok: same,
        detail: `na dan ${asOf}: ${recomputed}; nalaz: ${formatNumber(f.ocekivano)} / ${formatNumber(f.stvarno)} / ${formatNumber(f.iznos_bez_pdv)}`,
      },
    ];

    let sources = JSON.stringify(issue);
    if (issue.kind === 'price') {
      const d = issue.difference;
      const invoiceLine = await pdfLine(d.invoiceSource);
      checks.push({
        check: 'cena na fakturi',
        ok: invoiceLine !== undefined && lineHasNumber(invoiceLine, d.invoicedPrice) && lineHasNumber(invoiceLine, d.quantity),
        detail: `${d.invoiceSource}: "${invoiceLine ?? 'linija ne postoji'}"`,
      });
      const priceRef = /:(\d+)/.exec(d.priceSource);
      const priceRow = priceRef ? csvRow(PRICE_FILE_NAME, Number(priceRef[1])) : undefined;
      checks.push({
        check: 'ugovorena cena',
        ok: priceRow !== undefined && priceRow.split(';').some((cell) => sameNumber(parseLocalNumber(cell), d.agreedPrice)),
        detail: `${d.priceSource}: "${priceRow ?? 'red ne postoji'}"`,
      });
      sources += ` ${invoiceLine ?? ''} ${priceRow ?? ''}`;
    } else if (issue.kind === 'margin') {
      const article = ctx.articles.find((a) => a.code === issue.drop.articleCode);
      checks.push({
        check: 'prodajna cena',
        ok: article !== undefined && sameNumber(Math.round((article.price / (1 + article.vatRate / 100)) * 100) / 100, issue.drop.netPrice),
        detail: article
          ? `data/artikli.json artikal ${article.code}: ${formatNumber(article.price)} sa PDV ${article.vatRate}%, bez PDV ${formatNumber(issue.drop.netPrice)}`
          : `artikla ${issue.drop.articleCode} nema u data/artikli.json`,
      });
    }
    return { checks, sources, values: numbersIn(issue) };
  }

  async function audit(f: FindingRow): Promise<FindingAudit> {
    const exist = await sourcesExist(f.izvor);
    const specific =
      f.tip === 'KOLICINA'
        ? await quantityChecks(f)
        : f.tip === 'ROK' || f.tip === 'MANJAK'
          ? await stockChecks(f)
          : await salesChecks(f);
    const text = textCheck(
      `${f.opis} ${f.predlog ?? ''}`,
      `${f.izvor} ${exist.quoted} ${specific.sources}`,
      [f.ocekivano, f.stvarno, f.iznos_bez_pdv, ...specific.values],
    );
    const checks = [exist.check, ...specific.checks, text];
    return {
      findingId: f.id,
      agent: f.agent,
      type: f.tip,
      expected: f.ocekivano,
      actual: f.stvarno,
      amountWithoutVat: f.iznos_bez_pdv,
      explanation: f.opis,
      suggestion: f.predlog,
      source: f.izvor,
      checks,
      passed: checks.every((c) => c.ok),
    };
  }

  return { audit, latestSaleDate };
}
