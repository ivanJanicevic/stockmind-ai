// The Auditor checks every finding waiting for it (audit_status CEKA) against its sources and records
// POTVRDJEN or ODBIJEN. Rejected findings go back to their agent once, with the reason; the agent records
// them again and the Auditor checks them once more. The verdicts are posted in the network.
// Calls Gemini (one Auditor loop, plus one loop per returned agent and a second Auditor loop if needed).
//
//   npm run audit
//
// Record findings first: "npm run procurement -- <faktura>", "npm run stock", "npm run sales".

import 'dotenv/config';

import { loadConfig } from '../../config.js';
import { findingsWithStatus } from '../../db/findings.js';
import { limitModelCalls } from '../../model-rate-limit.js';
import { loadContext, runAudit } from '../flows.js';

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
const waiting = findingsWithStatus(ctx.db, 'CEKA');
if (waiting.length === 0) {
  console.log('No findings are waiting for the Auditor. Record some first: npm run procurement, npm run stock, npm run sales.');
  process.exit(0);
}
console.log(`[db] ${waiting.length} finding(s) waiting for the Auditor`);

const outcome = await runAudit(ctx);
if (outcome.stillWaiting.length > 0) {
  console.log(`\n[warning] still without a verdict: ${outcome.stillWaiting.map((id) => `#${id}`).join(', ')}`);
}
console.log(`\n${outcome.message}`);
process.exit(0);
