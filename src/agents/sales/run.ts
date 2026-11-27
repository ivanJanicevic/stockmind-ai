// Prodaja i profit: invoice prices against the agreed prices, margins after supplier price increases,
// and articles whose sales fell. The agent records findings and posts them in the network.
// Calls Gemini (one loop).
//
//   npm run sales                    as of 2026-12-25, the last day of the sales export
//   npm run sales -- 2026-12-15      as of another day
//
// Prices are checked only on invoices already in the database: read them first with
// "npm run procurement -- fakture/<faktura>.pdf" (Coca-Cola is on faktura-04-sokovi.pdf).

import 'dotenv/config';

import { loadConfig } from '../../config.js';
import { listDocuments } from '../document/process-document.js';
import { latestSaleDate, loadContext, runSales } from '../flows.js';
import { limitModelCalls } from '../../model-rate-limit.js';
import { salesFindingsMessage } from './messages.js';
import { invoices } from './tools.js';

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

const ctx = loadContext(config.models[0]!);
const asOf = process.argv[2] ?? latestSaleDate(ctx);
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) fail(`"${asOf}" is not a date like 2026-12-25`);

const read = invoices(ctx.db);
const notRead = (await listDocuments()).filter((d) => d.kind === 'invoice' && !read.some((i) => i.izvorni_fajl === d.file));
console.log(
  `[db] invoices in the database: ${read.map((i) => i.broj).join(', ') || 'none'}` +
    (notRead.length > 0 ? `; not read yet, so their prices are not checked: ${notRead.map((d) => d.file).join(', ')}` : ''),
);

const findings = await runSales(ctx, asOf);
console.log(`\n${salesFindingsMessage(asOf, findings, read.map((i) => i.broj))}`);
process.exit(0);
