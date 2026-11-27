// The steps of the back office, as functions the CLI commands and the app share. Every step that
// runs an agent calls Gemini; the numbers are computed in code. Each agent posts its result in the
// Mozaik Network when MOZAIK_INVITE is set (a network error is logged, it does not stop the step).

import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { openDatabase } from '../db/database.js';
import {
  findDocument,
  findDocumentByFile,
  linkDocuments,
  receiptForInvoice,
  saveDeliveryNote,
  saveInvoice,
} from '../db/documents.js';
import { findingsByKey, findingsForDocument, findingsWithStatus, type FindingRow } from '../db/findings.js';
import { receivedLots, unconfirmedDeliveryNotes } from '../db/stock.js';
import { readArticles } from '../domain/profit.js';
import { readAgreedPrices } from '../domain/purchase-prices.js';
import { readRecipes } from '../domain/recipes.js';
import { readSales } from '../domain/sales.js';
import { checkStock } from '../domain/stock.js';
import { connectPeer } from '../network/connect.js';
import { recordActivity } from './activity.js';
import { auditTask, createAuditorAgent } from './auditor/agent.js';
import { createFindingAuditor, type AuditContext } from './auditor/checks.js';
import { auditMessage } from './auditor/messages.js';
import { returnToAgents, type ReturnResult } from './auditor/return-to-agent.js';
import { AUDITOR_AGENT, createAuditorTools, type Verdict } from './auditor/tools.js';
import { DATA_DIR, listDocuments, processDocument } from './document/process-document.js';
import { createProcurementAgent, procurementTask } from './procurement/agent.js';
import { findingsMessage } from './procurement/messages.js';
import { createProcurementTools, PROCUREMENT_AGENT } from './procurement/tools.js';
import { runAgent } from './run-agent.js';
import { createSalesAgent, salesTask } from './sales/agent.js';
import { salesFindingsMessage } from './sales/messages.js';
import { createSalesTools, invoices, SALES_AGENT, salesIssueKey, salesIssues } from './sales/tools.js';
import { createStockAgent, stockTask } from './stock/agent.js';
import { stockFindingsMessage } from './stock/messages.js';
import { createStockTools, STOCK_AGENT } from './stock/tools.js';

export const SALES_CSV = 'promet_2026-11-26_do_2026-12-25.csv';

export interface FlowContext extends AuditContext {
  model: string;
}

/** The database and every data file, read once. */
export function loadContext(model: string, db: DatabaseSync = openDatabase()): FlowContext {
  return {
    db,
    recipes: readRecipes(DATA_DIR),
    sales: readSales(path.join(DATA_DIR, SALES_CSV)),
    prices: readAgreedPrices(path.join(DATA_DIR, 'nabavne_cene.csv')),
    articles: readArticles(DATA_DIR),
    dataDir: DATA_DIR,
    model,
  };
}

/** The last day of the sales export: the default stock date. */
export function latestSaleDate(ctx: FlowContext): string {
  return ctx.sales.reduce((max, s) => (s.date > max ? s.date : max), '');
}

/** Posts a message in the network as the named agent. Returns false when there is no network or it failed. */
export async function postInNetwork(name: string, message: string): Promise<boolean> {
  if (!process.env.MOZAIK_INVITE?.trim()) return false;
  try {
    const session = await connectPeer({ name, role: 'agent', policy: { rules: [] } });
    await session.send(message);
    await session.leave();
    recordActivity({ type: 'note', agent: name, loopId: 'network', detail: `objavljeno u mreži ${session.networkId}` });
    return true;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    console.error(`[network] ${name} could not post: ${text}`);
    recordActivity({ type: 'note', agent: name, loopId: 'network', detail: `mreža nije dostupna: ${text}` });
    return false;
  }
}

/** Invoices whose delivery note has a confirmed receipt get linked to it. */
function linkInvoicesToReceipts(db: DatabaseSync): void {
  for (const invoice of invoices(db)) {
    const receipt = receiptForInvoice(db, invoice);
    if (receipt && invoice.povezani_dokument_id !== receipt.id) linkDocuments(db, invoice.id, receipt.id);
  }
}

export interface ReadResult {
  file: string;
  kind: 'invoice' | 'delivery_note';
  number?: string;
  status: 'saved' | 'already' | 'failed';
  error?: string;
}

/**
 * Reads PDFs with Document agents, all at the same time, one agent per document. A delivery note is
 * saved as OTPREMNICA (NACRT, waiting for the owner), an invoice as ULAZNA_FAKTURA. Documents already
 * in the database are not read again. With no files given, every PDF in data/ is read.
 */
export async function readDocuments(ctx: FlowContext, files?: readonly string[]): Promise<ReadResult[]> {
  const all = await listDocuments();
  const chosen = files && files.length > 0 ? all.filter((d) => files.includes(d.file)) : all;
  const results = await Promise.all(
    chosen.map(async ({ file, kind }): Promise<ReadResult> => {
      const vrsta = kind === 'invoice' ? 'ULAZNA_FAKTURA' : 'OTPREMNICA';
      const stored = findDocumentByFile(ctx.db, vrsta, file);
      if (stored) return { file, kind, number: stored.broj, status: 'already' };
      try {
        const draft = await processDocument(file, ctx.model);
        if (kind === 'invoice') saveInvoice(ctx.db, draft);
        else saveDeliveryNote(ctx.db, draft);
        return { file, kind, number: draft.number, status: 'saved' };
      } catch (error) {
        return { file, kind, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  linkInvoicesToReceipts(ctx.db);
  return results;
}

/** Nabavka on one invoice: quantities against the confirmed receipt. */
export async function runProcurement(ctx: FlowContext, invoiceNumber: string): Promise<FindingRow[]> {
  const invoice = findDocument(ctx.db, 'ULAZNA_FAKTURA', invoiceNumber);
  if (!invoice) throw new Error(`Faktura ${invoiceNumber} nije u bazi.`);
  const receipt = receiptForInvoice(ctx.db, invoice);
  if (!receipt) throw new Error(`Otpremnica ${invoice.veza_broj ?? '?'} za fakturu ${invoiceNumber} još nije potvrđena.`);
  linkDocuments(ctx.db, invoice.id, receipt.id);

  const agent = createProcurementAgent(createProcurementTools({ db: ctx.db }));
  await runAgent(agent, procurementTask(invoice.broj), ctx.model, `${PROCUREMENT_AGENT} (${invoice.broj})`);
  const findings = findingsForDocument(ctx.db, invoice.id, PROCUREMENT_AGENT);
  await postInNetwork(PROCUREMENT_AGENT, findingsMessage(invoice, receipt, findings));
  return findings;
}

/** Zalihe: stock and expiry as of a date. */
export async function runStock(ctx: FlowContext, asOf: string): Promise<FindingRow[]> {
  const agent = createStockAgent(createStockTools({ db: ctx.db, recipes: ctx.recipes, sales: ctx.sales }));
  await runAgent(agent, stockTask(asOf), ctx.model, STOCK_AGENT);
  const check = checkStock(receivedLots(ctx.db), ctx.sales, ctx.recipes, asOf);
  const findings = findingsByKey(ctx.db, STOCK_AGENT, check.issues.map((i) => i.key));
  await postInNetwork(
    STOCK_AGENT,
    stockFindingsMessage(asOf, findings, {
      soldWithoutReceipt: check.soldWithoutReceipt.map((s) => s.name),
      deliveryNotesNotConfirmed: unconfirmedDeliveryNotes(ctx.db).map((p) => p.number),
    }),
  );
  return findings;
}

/** Prodaja i profit: invoice prices, margins and sales as of a date. */
export async function runSales(ctx: FlowContext, asOf: string): Promise<FindingRow[]> {
  const agent = createSalesAgent(createSalesTools(ctx));
  await runAgent(agent, salesTask(asOf), ctx.model, SALES_AGENT);
  const findings = findingsByKey(ctx.db, SALES_AGENT, salesIssues(ctx, asOf).map(salesIssueKey));
  await postInNetwork(SALES_AGENT, salesFindingsMessage(asOf, findings, invoices(ctx.db).map((i) => i.broj)));
  return findings;
}

export interface AuditOutcome {
  first: Verdict[];
  returned?: ReturnResult | undefined;
  second: Verdict[];
  /** Findings still waiting after both rounds (the model gave them no verdict). */
  stillWaiting: number[];
  message: string;
}

/**
 * Auditor: checks every waiting finding and records POTVRDJEN or ODBIJEN. Rejected findings go back to
 * their agent once, with the reason; what the agents record again is checked once more.
 */
export async function runAudit(ctx: FlowContext): Promise<AuditOutcome> {
  const auditor = createFindingAuditor(ctx);
  const round = async (label: string) => {
    const verdicts: Verdict[] = [];
    const agent = createAuditorAgent(createAuditorTools({ db: ctx.db, audit: auditor.audit, onVerdict: (v) => verdicts.push(v) }));
    await runAgent(agent, auditTask(), ctx.model, label);
    return verdicts;
  };

  if (findingsWithStatus(ctx.db, 'CEKA').length === 0) {
    return { first: [], second: [], stillWaiting: [], message: 'Auditor: nema nalaza koji čekaju proveru.' };
  }
  const first = await round(AUDITOR_AGENT);
  const rejected = first.filter((v) => v.verdict === 'ODBIJEN');
  let returned: ReturnResult | undefined;
  let second: Verdict[] = [];
  if (rejected.length > 0) {
    returned = await returnToAgents(ctx, rejected, ctx.model, auditor.latestSaleDate);
    if (findingsWithStatus(ctx.db, 'CEKA').length > 0) second = await round(`${AUDITOR_AGENT} (ponovo)`);
  }
  const message = auditMessage(first, returned, second);
  await postInNetwork(AUDITOR_AGENT, message);
  return { first, returned, second, stillWaiting: findingsWithStatus(ctx.db, 'CEKA').map((f) => f.id), message };
}

export interface FlowOutcome {
  asOf: string;
  procurement: { invoice: string; findings?: number; error?: string }[];
  stock: number | string;
  sales: number | string;
  audit: AuditOutcome;
}

/**
 * The whole analysis: Nabavka (every invoice with a confirmed receipt), Zalihe and Prodaja run at the
 * same time; when all are done, the Auditor checks what they found.
 */
export async function runFlow(ctx: FlowContext, asOf: string): Promise<FlowOutcome> {
  linkInvoicesToReceipts(ctx.db);
  const ready = invoices(ctx.db).filter((i) => receiptForInvoice(ctx.db, i));
  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

  const [procurement, stock, sales] = await Promise.all([
    Promise.all(
      ready.map((invoice) =>
        runProcurement(ctx, invoice.broj).then(
          (findings) => ({ invoice: invoice.broj, findings: findings.length }),
          (error) => ({ invoice: invoice.broj, error: errorText(error) }),
        ),
      ),
    ),
    runStock(ctx, asOf).then((f) => f.length, errorText),
    runSales(ctx, asOf).then((f) => f.length, errorText),
  ]);
  const audit = await runAudit(ctx);
  return { asOf, procurement, stock, sales, audit };
}
