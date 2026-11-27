// Checks the stock as of a date: the stock agent (Zalihe) computes it from the confirmed receipts and
// the cash register sales, records findings and posts them in the network. Calls Gemini (one loop).
//
//   npm run stock                    stock as of 2026-12-25, the last day of the sales export
//   npm run stock -- 2026-12-10      stock as of another day
//
// Only confirmed receipts count as goods received: confirm the delivery notes first with
// "npm run receive -- sve".

import 'dotenv/config';

import path from 'node:path';

import { loadConfig } from '../../config.js';
import { openDatabase } from '../../db/database.js';
import { findingsByKey } from '../../db/findings.js';
import { receivedLots, unconfirmedDeliveryNotes } from '../../db/stock.js';
import { readRecipes } from '../../domain/recipes.js';
import { readSales } from '../../domain/sales.js';
import { checkStock } from '../../domain/stock.js';
import { limitModelCalls } from '../../model-rate-limit.js';
import { connectPeer } from '../../network/connect.js';
import { DATA_DIR } from '../document/process-document.js';
import { runAgent } from '../run-agent.js';
import { createStockAgent, stockTask } from './agent.js';
import { stockFindingsMessage, stockOverviewTable } from './messages.js';
import { createStockTools, STOCK_AGENT } from './tools.js';

const asOf = process.argv[2] ?? '2026-12-25';

function fail(message: string): never {
  console.error(`\n[error] ${message}`);
  process.exit(1);
}

function describeError(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : String(error);
  return status === undefined ? message : `HTTP ${status}: ${message}`;
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) fail(`"${asOf}" is not a date like 2026-12-25`);
const config = (() => {
  try {
    return loadConfig(process.env);
  } catch (error) {
    return fail((error as Error).message);
  }
})();
process.on('unhandledRejection', (error) => fail(describeError(error)));
limitModelCalls(config.requestsPerMinute);

const db = openDatabase();
const recipes = readRecipes(DATA_DIR);
const sales = readSales(path.join(DATA_DIR, 'promet_2026-11-26_do_2026-12-25.csv'));

const lots = receivedLots(db);
if (lots.length === 0) fail('There is no confirmed receipt yet. Run "npm run receive -- sve" and confirm the delivery notes first.');
const pending = unconfirmedDeliveryNotes(db);
console.log(
  `[db] ${lots.length} confirmed receipt lines; ${sales.length} sales lines` +
    (pending.length > 0 ? `; not confirmed yet: ${pending.map((p) => p.number).join(', ')}` : ''),
);

// The stock agent checks and records findings.
const agent = createStockAgent(createStockTools({ db, recipes, sales }));
await runAgent(agent, stockTask(asOf), config.models[0]!, STOCK_AGENT);

// Post the findings of this stock date in the network.
const check = checkStock(lots, sales, recipes, asOf);
const findings = findingsByKey(db, STOCK_AGENT, check.issues.map((i) => i.key));
const message = stockFindingsMessage(asOf, findings, {
  soldWithoutReceipt: check.soldWithoutReceipt.map((s) => s.name),
  deliveryNotesNotConfirmed: pending.map((p) => p.number),
});
console.log(`\n${stockOverviewTable(asOf, check.overview)}`);
console.log(`\n${message}`);

const session = await connectPeer({ name: STOCK_AGENT, role: 'agent', policy: { rules: [] } });
await session.send(message);
await session.leave();
console.log(`\n[network] "${STOCK_AGENT}" posted ${findings.length} finding(s) in network ${session.networkId}`);
process.exit(0);
