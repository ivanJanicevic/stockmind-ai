import type { DatabaseSync } from 'node:sqlite';

import type { Tool } from '@mozaik-ai/core';

import { documentItems, findDocument, receiptForInvoice, type DocumentRow } from '../../db/documents.js';
import { saveFinding } from '../../db/findings.js';
import { compareQuantities } from '../../domain/procurement.js';

export const PROCUREMENT_AGENT = 'Nabavka';

// Nabavka checks quantities only: invoice against the confirmed receipt.
// Prices are checked by the sales and profit agent.

/** The procurement agent's tools. All numbers come from the database, never from the model. */
export function createProcurementTools({ db }: { db: DatabaseSync }): Tool[] {
  function loadInvoice(invoiceNumber: string): DocumentRow {
    const invoice = findDocument(db, 'ULAZNA_FAKTURA', invoiceNumber);
    if (!invoice) throw new Error(`Invoice ${invoiceNumber} is not in the database.`);
    return invoice;
  }

  function quantities(invoiceNumber: string) {
    const invoice = loadInvoice(invoiceNumber);
    const receipt = receiptForInvoice(db, invoice);
    if (!receipt) return { invoice, receipt: undefined, result: undefined };
    const result = compareQuantities(documentItems(db, invoice.id), receipt, documentItems(db, receipt.id));
    return { invoice, receipt, result };
  }

  const compareQuantitiesTool: Tool = {
    type: 'function',
    name: 'compare_quantities',
    description:
      'Compares the quantities on an invoice with the receipt the owner confirmed for its delivery note. ' +
      'Returns only the items that differ, with the invoiced and received quantity, the difference in RSD ' +
      'without VAT, and where each number comes from.',
    parameters: {
      type: 'object',
      properties: {
        invoiceNumber: { type: 'string', description: 'Invoice number as given in the task, e.g. F-ZP-2026-01197.' },
      },
      required: ['invoiceNumber'],
      additionalProperties: false,
    },
    strict: true,
    invoke: async ({ invoiceNumber }: { invoiceNumber: string }) => {
      const { invoice, receipt, result } = quantities(invoiceNumber);
      if (!receipt || !result) {
        return {
          ok: false,
          error: `No confirmed receipt for delivery note ${invoice.veza_broj ?? '(none printed)'} yet. The owner must confirm it first.`,
        };
      }
      return {
        ok: true,
        invoice: { number: invoice.broj, supplier: invoice.dobavljac, file: invoice.izvorni_fajl },
        receipt: { number: receipt.broj, confirmedBy: receipt.potvrdio },
        differences: result.differences,
        receivedButNotInvoiced: result.notInvoiced,
      };
    },
  };

  const recordFindingTool: Tool = {
    type: 'function',
    name: 'record_finding',
    description:
      'Records one difference returned by compare_quantities as a finding for the Auditor. You give which ' +
      'difference it is and the words for the owner; the numbers and sources are copied from the comparison ' +
      'by the tool. A difference the comparison did not return cannot be recorded.',
    parameters: {
      type: 'object',
      properties: {
        invoiceNumber: { type: 'string' },
        supplierCode: {
          type: 'string',
          description: 'supplierCode of the difference, exactly as compare_quantities returned it.',
        },
        explanation: {
          type: 'string',
          description: 'For the café owner, in Serbian, one or two sentences: what differs and what it means for payment.',
        },
        suggestedAction: {
          type: 'string',
          description: 'What the owner should do, in Serbian, e.g. "Zatražiti knjižno odobrenje za 3 kom."',
        },
      },
      required: ['invoiceNumber', 'supplierCode', 'explanation', 'suggestedAction'],
      additionalProperties: false,
    },
    strict: true,
    invoke: async (args: { invoiceNumber: string; supplierCode: string; explanation: string; suggestedAction: string }) => {
      const { invoice, receipt, result } = quantities(args.invoiceNumber);
      const d = result?.differences.find((x) => x.supplierCode === args.supplierCode);
      if (!receipt || !d) {
        return {
          recorded: false,
          error: `compare_quantities returned no difference for ${args.supplierCode} on invoice ${args.invoiceNumber}. Record only differences it returned.`,
        };
      }
      const source = `${d.invoiceSource}; ${d.receiptSource}`;
      const saved = saveFinding(db, {
        agent: PROCUREMENT_AGENT,
        type: 'KOLICINA',
        description: args.explanation,
        suggestion: args.suggestedAction,
        expected: d.received,
        actual: d.invoiced,
        amountWithoutVat: d.amountWithoutVat,
        source,
        documentId: invoice.id,
        itemId: d.invoiceItemId,
      });
      return {
        recorded: true,
        findingId: saved.id,
        alreadyRecorded: !saved.created && !saved.resubmitted,
        resubmittedToAuditor: saved.resubmitted,
        received: d.received,
        invoiced: d.invoiced,
        amountWithoutVat: d.amountWithoutVat,
        source,
      };
    },
  };

  return [compareQuantitiesTool, recordFindingTool];
}
