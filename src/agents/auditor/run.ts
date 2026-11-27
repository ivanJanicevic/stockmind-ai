// The Auditor checks every finding waiting for it (audit_status CEKA) against its sources and records
// POTVRDJEN or ODBIJEN. Rejected findings go back to their agent once, with the reason; the agent records
// them again and the Auditor checks them once more. The verdicts are posted in the network.
// Calls Gemini (one Auditor loop, plus one loop per returned agent and a second Auditor loop if needed).
//
//   npm run audit
//
// Record findings first: "npm run procurement -- <faktura>" and "npm run stock".

import 'dotenv/config';

import path from 'node:path';

import { loadConfig } from '../../config.js';
import { openDatabase } from '../../db/database.js';
import { findingsWithStatus } from '../../db/findings.js';
import { readRecipes } from '../../domain/recipes.js';
import { readSales } from '../../domain/sales.js';
import { limitModelCalls } from '../../model-rate-limit.js';
import { connectPeer } from '../../network/connect.js';
import { DATA_DIR } from '../document/process-document.js';
import { runAgent } from '../run-agent.js';
import { auditTask, createAuditorAgent } from './agent.js';
import { createFindingAuditor, type AuditContext } from './checks.js';
import { auditMessage } from './messages.js';
import { returnToAgents, type ReturnResult } from './return-to-agent.js';
import { AUDITOR_AGENT, createAuditorTools, type Verdict } from './tools.js';

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

const db = openDatabase();
const ctx: AuditContext = {
  db,
  recipes: readRecipes(DATA_DIR),
  sales: readSales(path.join(DATA_DIR, 'promet_2026-11-26_do_2026-12-25.csv')),
  dataDir: DATA_DIR,
};
const auditor = createFindingAuditor(ctx);

/** One Auditor loop over the findings waiting now. Returns the verdicts it recorded. */
async function auditRound(label: string): Promise<Verdict[]> {
  const verdicts: Verdict[] = [];
  const agent = createAuditorAgent(createAuditorTools({ db, audit: auditor.audit, onVerdict: (v) => verdicts.push(v) }));
  await runAgent(agent, auditTask(), model, label);
  return verdicts;
}

const waiting = findingsWithStatus(db, 'CEKA');
if (waiting.length === 0) {
  console.log('No findings are waiting for the Auditor. Record some first: npm run procurement, npm run stock.');
  process.exit(0);
}
console.log(`[db] ${waiting.length} finding(s) waiting for the Auditor`);

// 1. The Auditor checks every waiting finding.
const first = await auditRound(AUDITOR_AGENT);

// 2. Rejected findings go back to their agent once; what the agents record again is checked once more.
const rejected = first.filter((v) => v.verdict === 'ODBIJEN');
let returned: ReturnResult | undefined;
let second: Verdict[] = [];
if (rejected.length > 0) {
  console.log(`\n[auditor] ${rejected.length} rejected; returning them to their agents once`);
  returned = await returnToAgents(ctx, rejected, model, auditor.latestSaleDate);
  if (findingsWithStatus(db, 'CEKA').length > 0) {
    console.log('\n[auditor] checking the corrected findings');
    second = await auditRound(`${AUDITOR_AGENT} (ponovo)`);
  }
}

const left = findingsWithStatus(db, 'CEKA');
if (left.length > 0) console.log(`\n[warning] still without a verdict: ${left.map((f) => `#${f.id}`).join(', ')}`);

// 3. Post the verdicts in the network.
const message = auditMessage(first, returned, second);
console.log(`\n${message}`);

const session = await connectPeer({ name: AUDITOR_AGENT, role: 'agent', policy: { rules: [] } });
await session.send(message);
await session.leave();
console.log(`\n[network] "${AUDITOR_AGENT}" posted ${first.length + second.length} verdict(s) in network ${session.networkId}`);
process.exit(0);
