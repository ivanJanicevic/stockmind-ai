import type { DatabaseSync } from 'node:sqlite';

import type { Tool } from '@mozaik-ai/core';

import { documentItems, type DocumentRow } from '../../db/documents.js';
import { saveFinding, type FindingType } from '../../db/findings.js';
import { comparePrices, type PriceDifference } from '../../domain/procurement.js';
import { marginDrops, salesDrops, type Article, type MarginDrop, type SalesDrop } from '../../domain/profit.js';
import type { AgreedPrice } from '../../domain/purchase-prices.js';
import type { Recipes } from '../../domain/recipes.js';
import type { SaleRow } from '../../domain/sales.js';

export const SALES_AGENT = 'Prodaja';

export interface SalesData {
  db: DatabaseSync;
  recipes: Recipes;
  sales: readonly SaleRow[];
  prices: readonly AgreedPrice[];
  articles: readonly Article[];
}

/** Every invoice read into the database. */
export function invoices(db: DatabaseSync): DocumentRow[] {
  return db.prepare(`SELECT * FROM prometni_dokument WHERE vrsta = 'ULAZNA_FAKTURA' ORDER BY id`).all() as unknown as DocumentRow[];
}

export type SalesIssue =
  | { kind: 'price'; invoice: DocumentRow; difference: PriceDifference }
  | { kind: 'margin'; drop: MarginDrop }
  | { kind: 'sales'; drop: SalesDrop };

/** Everything wrong with prices, margins and sales as of a date, computed in code, in a stable order. */
export function salesIssues(data: SalesData, asOf: string): SalesIssue[] {
  const issues: SalesIssue[] = [];
  for (const invoice of invoices(data.db)) {
    if (invoice.datum_dokumenta > asOf) continue;
    for (const difference of comparePrices(invoice, documentItems(data.db, invoice.id), data.prices).differences) {
      issues.push({ kind: 'price', invoice, difference });
    }
  }
  for (const drop of marginDrops(data.articles, data.sales, data.recipes, data.prices, asOf).drops) issues.push({ kind: 'margin', drop });
  for (const drop of salesDrops(data.sales, data.articles, asOf)) issues.push({ kind: 'sales', drop });
  return issues;
}

/** The key a sales issue is recorded under, so the same finding is not recorded twice. */
export function salesIssueKey(issue: SalesIssue): string {
  return issue.kind === 'price' ? `CENA|${issue.difference.invoiceItemId}` : issue.drop.key;
}

/** How a sales issue is stored as a finding (nalaz). */
export function salesFindingValues(issue: SalesIssue): {
  type: FindingType;
  expected: number | null;
  actual: number | null;
  amountWithoutVat: number | null;
  source: string;
  documentId: number | null;
  itemId: number | null;
} {
  if (issue.kind === 'price') {
    const d = issue.difference;
    return {
      type: 'CENA',
      expected: d.agreedPrice,
      actual: d.invoicedPrice,
      amountWithoutVat: d.amountWithoutVat,
      source: `${d.invoiceSource}; ${d.priceSource}`,
      documentId: issue.invoice.id,
      itemId: d.invoiceItemId,
    };
  }
  if (issue.kind === 'margin') {
    const d = issue.drop;
    return {
      type: 'PAD_MARZE',
      expected: d.before.marginPercent,
      actual: d.after.marginPercent,
      amountWithoutVat: d.lostMargin,
      source: d.sources.join('; '),
      documentId: null,
      itemId: null,
    };
  }
  const d = issue.drop;
  return {
    type: 'PAD_PRODAJE',
    expected: d.firstWeek,
    actual: d.lastWeek,
    amountWithoutVat: null,
    source: d.sources.join('; '),
    documentId: null,
    itemId: null,
  };
}

/** What the model sees of an issue: everything except database ids. */
function forModel(id: string, issue: SalesIssue): Record<string, unknown> {
  if (issue.kind === 'price') {
    const { invoiceItemId: _i, ...difference } = issue.difference;
    return { id, kind: 'price_above_agreed', invoice: issue.invoice.broj, supplier: issue.invoice.dobavljac, ...difference };
  }
  if (issue.kind === 'margin') {
    const { key: _k, ...drop } = issue.drop;
    return { id, kind: 'margin_drop', ...drop };
  }
  const { key: _k, ...drop } = issue.drop;
  return { id, kind: 'sales_drop', ...drop };
}

/** The sales and profit agent's tools. Every number is computed in code; the model never counts. */
export function createSalesTools(data: SalesData): Tool[] {
  let lastIssues = new Map<string, SalesIssue>();

  const checkTool: Tool = {
    type: 'function',
    name: 'check_sales_and_profit',
    description:
      'Computes, as of a date: "price_above_agreed" (an invoice line priced above the agreed purchase price in ' +
      'data/nabavne_cene.csv), "margin_drop" (a sold article whose margin fell by 3 or more percentage points ' +
      'after supplier price increases, with costs from the recipes, and the margin lost on what was sold since) ' +
      'and "sales_drop" (an article whose weekly sales fell by half or more from the first to the last full ' +
      'week while its price stayed the same). Every issue has an id, its numbers and their sources.',
    parameters: {
      type: 'object',
      properties: {
        asOf: { type: 'string', description: 'Date as YYYY-MM-DD, from the task.' },
      },
      required: ['asOf'],
      additionalProperties: false,
    },
    strict: true,
    invoke: async ({ asOf }: { asOf: string }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`asOf "${asOf}" is not YYYY-MM-DD`);
      const issues = salesIssues(data, asOf);
      lastIssues = new Map(issues.map((issue, i) => [`P${i + 1}`, issue]));
      return {
        asOf,
        invoicesChecked: invoices(data.db).map((i) => i.broj),
        issues: [...lastIssues].map(([id, issue]) => forModel(id, issue)),
      };
    },
  };

  const recordFindingTool: Tool = {
    type: 'function',
    name: 'record_finding',
    description:
      'Records one issue from the last check_sales_and_profit call as a finding for the Auditor. You give the ' +
      'issue id and the words for the owner; the numbers and sources are copied from the issue by the tool.',
    parameters: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'The id check_sales_and_profit gave the issue, e.g. P2.' },
        explanation: {
          type: 'string',
          description: 'For the café owner, in Serbian, one or two sentences: what changed and what it costs.',
        },
        suggestedAction: {
          type: 'string',
          description: 'What the owner should do, in Serbian, e.g. "Zatražiti knjižno odobrenje za razliku u ceni."',
        },
      },
      required: ['issueId', 'explanation', 'suggestedAction'],
      additionalProperties: false,
    },
    strict: true,
    invoke: async ({ issueId, explanation, suggestedAction }: { issueId: string; explanation: string; suggestedAction: string }) => {
      const issue = lastIssues.get(issueId);
      if (!issue) {
        return { recorded: false, error: `No issue ${issueId} in the last check_sales_and_profit result. Call it first.` };
      }
      const v = salesFindingValues(issue);
      const saved = saveFinding(data.db, {
        agent: SALES_AGENT,
        type: v.type,
        description: explanation,
        suggestion: suggestedAction,
        expected: v.expected,
        actual: v.actual,
        amountWithoutVat: v.amountWithoutVat,
        source: v.source,
        documentId: v.documentId,
        itemId: v.itemId,
        key: salesIssueKey(issue),
      });
      return {
        recorded: true,
        findingId: saved.id,
        alreadyRecorded: !saved.created && !saved.resubmitted,
        resubmittedToAuditor: saved.resubmitted,
        type: v.type,
      };
    },
  };

  return [checkTool, recordFindingTool];
}
