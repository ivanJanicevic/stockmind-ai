import type { DatabaseSync } from 'node:sqlite';

import type { Tool } from '@mozaik-ai/core';

import { saveFinding } from '../../db/findings.js';
import { receivedLots, unconfirmedDeliveryNotes } from '../../db/stock.js';
import type { Recipes } from '../../domain/recipes.js';
import type { SaleRow } from '../../domain/sales.js';
import { checkStock, EXPIRY_ALARM_DAYS, stockFindingValues, type StockIssue } from '../../domain/stock.js';

export const STOCK_AGENT = 'Zalihe';

export interface StockToolsOptions {
  db: DatabaseSync;
  recipes: Recipes;
  sales: readonly SaleRow[];
}

/** The stock agent's tools. Stock is computed in code from confirmed receipts and sales; the model never counts. */
export function createStockTools({ db, recipes, sales }: StockToolsOptions): Tool[] {
  // Issues of the last check_stock call, by the short id the model sees (I1, I2, ...).
  let lastIssues = new Map<string, StockIssue>();

  const checkStockTool: Tool = {
    type: 'function',
    name: 'check_stock',
    description:
      'Computes the stock of every item with a confirmed receipt as of a date, from the receipts and the ' +
      'cash register sales converted through the recipes, and returns what is wrong: "shortage" (sold more ' +
      'than was received and valid), "expired_on_receipt" (already expired when delivered), ' +
      `"expired_with_stock" (expired with goods left: a write-off), "expiring_soon" (expires within ${EXPIRY_ALARM_DAYS} days ` +
      'with goods on stock; includes an estimate of what will be left). Every issue has an id, its numbers ' +
      'and their sources. Also lists what could not be checked.',
    parameters: {
      type: 'object',
      properties: {
        asOf: { type: 'string', description: 'Stock date as YYYY-MM-DD, from the task.' },
      },
      required: ['asOf'],
      additionalProperties: false,
    },
    strict: true,
    invoke: async ({ asOf }: { asOf: string }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`asOf "${asOf}" is not YYYY-MM-DD`);
      const result = checkStock(receivedLots(db), sales, recipes, asOf);
      lastIssues = new Map(result.issues.map((issue, i) => [`I${i + 1}`, issue]));
      return {
        asOf,
        issues: [...lastIssues].map(([id, { key: _key, receiptId: _r, itemId: _i, ...issue }]) => ({ id, ...issue })),
        notChecked: {
          soldWithoutConfirmedReceipt: result.soldWithoutReceipt,
          deliveryNotesNotConfirmed: unconfirmedDeliveryNotes(db),
          articlesWithoutRecipe: result.articlesWithoutRecipe,
        },
      };
    },
  };

  const recordFindingTool: Tool = {
    type: 'function',
    name: 'record_finding',
    description:
      'Records one issue from the last check_stock call as a finding for the Auditor. You give the issue id ' +
      'and the words for the owner; the numbers and sources are copied from the issue by the tool.',
    parameters: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'The id check_stock gave the issue, e.g. I2.' },
        explanation: {
          type: 'string',
          description: 'For the café owner, in Serbian, one or two sentences: what is wrong and what it costs or risks.',
        },
        suggestedAction: {
          type: 'string',
          description:
            'What the owner should do, in Serbian, e.g. "Staviti Fantu na akciju do 18.12." or "Reklamirati dobavljaču."',
        },
      },
      required: ['issueId', 'explanation', 'suggestedAction'],
      additionalProperties: false,
    },
    strict: true,
    invoke: async ({ issueId, explanation, suggestedAction }: { issueId: string; explanation: string; suggestedAction: string }) => {
      const issue = lastIssues.get(issueId);
      if (!issue) {
        return { recorded: false, error: `No issue ${issueId} in the last check_stock result. Call check_stock first.` };
      }
      const { type, expected, actual } = stockFindingValues(issue);
      const saved = saveFinding(db, {
        agent: STOCK_AGENT,
        type,
        description: explanation,
        suggestion: suggestedAction,
        expected,
        actual,
        amountWithoutVat: null,
        source: issue.sources.join('; '),
        documentId: issue.receiptId,
        itemId: issue.itemId,
        key: issue.key,
      });
      return {
        recorded: true,
        findingId: saved.id,
        alreadyRecorded: !saved.created && !saved.resubmitted,
        resubmittedToAuditor: saved.resubmitted,
        kind: issue.kind,
        name: issue.name,
      };
    },
  };

  const stockOverviewTool: Tool = {
    type: 'function',
    name: 'stock_overview',
    description:
      'Lists every lot received up to a date (confirmed receipts), first-expiring first: the article, the ' +
      'received quantity, the quantity still on stock, the expiry date, days to expiry and a status: "OK", ' +
      `"ISTICE_USKORO" (expires within ${EXPIRY_ALARM_DAYS} days), "ISTEKLO", "ISTEKLO_PRI_PRIJEMU", "BEZ_ROKA" ` +
      '(no expiry date). usedBySales is false for goods no sold article uses, whose stock sales never reduce. ' +
      'Read only: records nothing. Use it for questions about the whole stock, not for recording findings.',
    parameters: {
      type: 'object',
      properties: {
        asOf: { type: 'string', description: 'Stock date as YYYY-MM-DD.' },
      },
      required: ['asOf'],
      additionalProperties: false,
    },
    strict: true,
    invoke: async ({ asOf }: { asOf: string }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`asOf "${asOf}" is not YYYY-MM-DD`);
      const { overview } = checkStock(receivedLots(db), sales, recipes, asOf);
      return { asOf, alarmDays: EXPIRY_ALARM_DAYS, lots: overview };
    },
  };

  return [checkStockTool, recordFindingTool, stockOverviewTool];
}
