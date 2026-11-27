import { documentById, documentItems, itemById, receiptForInvoice } from '../../db/documents.js';
import { findingById, type FindingRow } from '../../db/findings.js';
import { receivedLots } from '../../db/stock.js';
import { compareQuantities, itemKey } from '../../domain/procurement.js';
import { checkStock, stockDateOfKey } from '../../domain/stock.js';
import { createProcurementAgent, procurementRetryTask } from '../procurement/agent.js';
import { createProcurementTools, PROCUREMENT_AGENT } from '../procurement/tools.js';
import { runAgent } from '../run-agent.js';
import { createStockAgent, stockRetryTask } from '../stock/agent.js';
import { createStockTools, STOCK_AGENT } from '../stock/tools.js';
import type { AuditContext } from './checks.js';
import type { Verdict } from './tools.js';

export interface ReturnResult {
  /** Findings their agent was asked to record again. */
  returned: number[];
  /** Findings that could not go back, e.g. the data no longer gives them. */
  notReturned: { findingId: number; why: string }[];
}

/**
 * Sends rejected findings back to the agents that recorded them: each agent runs once more, with
 * the Auditor's reasons in its task, and records only those findings again (they wait for the
 * Auditor again). Agents run in parallel; one run per agent and stock date or invoice.
 */
export async function returnToAgents(
  ctx: AuditContext,
  rejected: readonly Verdict[],
  model: string,
  latestSaleDate: string,
): Promise<ReturnResult> {
  const { db, recipes, sales } = ctx;
  const result: ReturnResult = { returned: [], notReturned: [] };
  const runs: Promise<unknown>[] = [];

  const findings = rejected
    .map((v) => ({ finding: findingById(db, v.findingId), reason: v.reason }))
    .filter((x): x is { finding: FindingRow; reason: string } => x.finding !== undefined);

  // Zalihe: one run per stock date. The issue ids are the ones check_stock will give, since it
  // computes the same issues from the same data in the same order.
  const byDate = new Map<string, { issueId: string; name: string; reason: string; findingId: number }[]>();
  for (const { finding, reason } of findings.filter((x) => x.finding.agent === STOCK_AGENT)) {
    const asOf = stockDateOfKey(finding.kljuc ?? '') ?? latestSaleDate;
    const issues = checkStock(receivedLots(db), sales, recipes, asOf).issues;
    const index = issues.findIndex((i) => i.key === finding.kljuc);
    if (index < 0) {
      result.notReturned.push({ findingId: finding.id, why: `stanje na dan ${asOf} ga više ne daje` });
      continue;
    }
    const list = byDate.get(asOf) ?? [];
    list.push({ issueId: `I${index + 1}`, name: issues[index]!.name, reason, findingId: finding.id });
    byDate.set(asOf, list);
  }
  for (const [asOf, list] of byDate) {
    result.returned.push(...list.map((x) => x.findingId));
    const agent = createStockAgent(createStockTools({ db, recipes, sales }));
    runs.push(runAgent(agent, stockRetryTask(asOf, list), model, `${STOCK_AGENT} (ispravka)`));
  }

  // Nabavka: one run per invoice, only for differences the comparison still gives.
  const byInvoice = new Map<string, { supplierCode: string; reason: string; findingId: number }[]>();
  for (const { finding, reason } of findings.filter((x) => x.finding.agent === PROCUREMENT_AGENT)) {
    const invoice = finding.dokument_id === null ? undefined : documentById(db, finding.dokument_id);
    const item = finding.stavka_id === null ? undefined : itemById(db, finding.stavka_id);
    const receipt = invoice ? receiptForInvoice(db, invoice) : undefined;
    const stillDiffers =
      invoice && item && receipt
        ? compareQuantities(documentItems(db, invoice.id), receipt, documentItems(db, receipt.id)).differences.some(
            (d) => d.invoiceItemId === item.id,
          )
        : false;
    if (!invoice || !item || !stillDiffers) {
      result.notReturned.push({ findingId: finding.id, why: 'faktura i prijemnica se za tu stavku više ne razlikuju' });
      continue;
    }
    const list = byInvoice.get(invoice.broj) ?? [];
    list.push({ supplierCode: itemKey(item), reason, findingId: finding.id });
    byInvoice.set(invoice.broj, list);
  }
  for (const [invoiceNumber, list] of byInvoice) {
    result.returned.push(...list.map((x) => x.findingId));
    const agent = createProcurementAgent(createProcurementTools({ db }));
    runs.push(runAgent(agent, procurementRetryTask(invoiceNumber, list), model, `${PROCUREMENT_AGENT} (ispravka)`));
  }

  for (const { finding } of findings.filter((x) => x.finding.agent !== STOCK_AGENT && x.finding.agent !== PROCUREMENT_AGENT)) {
    result.notReturned.push({ findingId: finding.id, why: `agent ${finding.agent} još ne prima vraćene nalaze` });
  }

  await Promise.all(runs);
  return result;
}
