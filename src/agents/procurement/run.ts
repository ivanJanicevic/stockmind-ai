// Checks one invoice: the Document agent reads it, then the procurement agent (Nabavka) compares its
// quantities with the confirmed receipt and records findings. Calls Gemini (two agent loops) and
// posts one message in the network.
//
//   npm run procurement -- fakture/faktura-05-kafa.pdf
//
// The receipt comes from "npm run receive" for the invoice's delivery note. Prices are not checked
// here; the sales and profit agent does that.

import 'dotenv/config';

import { loadConfig } from '../../config.js';
import { openDatabase } from '../../db/database.js';
import { findDocument, linkDocuments, receiptForInvoice, saveInvoice } from '../../db/documents.js';
import { findingsForDocument } from '../../db/findings.js';
import { limitModelCalls } from '../../model-rate-limit.js';
import { connectPeer } from '../../network/connect.js';
import { listDocuments, processDocument } from '../document/process-document.js';
import { runAgent } from '../run-agent.js';
import { createProcurementAgent, procurementTask } from './agent.js';
import { findingsMessage } from './messages.js';
import { createProcurementTools, PROCUREMENT_AGENT } from './tools.js';

const file = process.argv[2] ?? 'fakture/faktura-05-kafa.pdf';

function fail(message: string): never {
  console.error(`\n[error] ${message}`);
  process.exit(1);
}

function describeError(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : String(error);
  return status === undefined ? message : `HTTP ${status}: ${message}`;
}

const config = (() => {
  try {
    return loadConfig(process.env);
  } catch (error) {
    return fail((error as Error).message);
  }
})();
process.on('unhandledRejection', (error) => fail(describeError(error)));
limitModelCalls(config.requestsPerMinute);
const model = config.models[0]!;

const known = (await listDocuments()).find((d) => d.file === file);
if (!known || known.kind !== 'invoice') fail(`"${file}" is not one of the invoices in data/fakture/.`);

const db = openDatabase();

// 1. Document agent reads the invoice; it is saved as ULAZNA_FAKTURA.
const draft = await processDocument(file, model).catch((error) => fail(describeError(error)));
saveInvoice(db, draft);
const invoice = findDocument(db, 'ULAZNA_FAKTURA', draft.number)!;
const receipt = receiptForInvoice(db, invoice);
if (!receipt) {
  fail(
    `ULAZNA_FAKTURA ${invoice.broj} is saved, but its delivery note ${invoice.veza_broj ?? '-'} is not confirmed yet.\n` +
      `Confirm it first with "npm run receive -- otpremnice/<that delivery note>.pdf", then run this again.`,
  );
}
linkDocuments(db, invoice.id, receipt.id);
console.log(
  `\n[db] ULAZNA_FAKTURA ${invoice.broj} (id ${invoice.id}) -> ${receipt.broj}, confirmed by ${receipt.potvrdio}`,
);

// 2. Nabavka compares quantities and records findings.
const agent = createProcurementAgent(createProcurementTools({ db }));
await runAgent(agent, procurementTask(invoice.broj), model, PROCUREMENT_AGENT);

// 3. Post the findings in the network.
const findings = findingsForDocument(db, invoice.id, PROCUREMENT_AGENT);
const message = findingsMessage(invoice, receipt, findings);
console.log(`\n${message}`);

const session = await connectPeer({ name: PROCUREMENT_AGENT, role: 'agent', policy: { rules: [] } });
await session.send(message);
await session.leave();
console.log(`\n[network] "${PROCUREMENT_AGENT}" posted ${findings.length} finding(s) in network ${session.networkId}`);
process.exit(0);
