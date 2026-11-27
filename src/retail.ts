import 'dotenv/config';

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  createAgent,
  createHuman,
  defineRuntime,
  RuntimeState,
  type Agent,
} from '@mozaik-ai/core';
import { sendMessage as sendNetworkMessage } from '@jigjoy/mozaik-network';
import { join as joinNetwork } from '@jigjoy/mozaik-network';
import { HOSTED_NETWORK, readInviteLink } from '@jigjoy/mozaik-network/invite-link';
import { NetworkClient } from '@jigjoy/mozaik-network/network-client';
import type { Peer } from '@jigjoy/mozaik-network/peer';

import { loadConfig, type Config } from './config.js';
import { answerText, WhenAnyAnswer, WhenInferenceCompleted, WhenMessageSent } from './events.js';
import {
  buildLocalRetailEvidence,
  buildRetailEvidenceFacts,
  defaultDataRoot,
  loadRetailDataset,
  analyzeRetailDataset,
  type RetailAnalysis,
  type RetailDataset,
} from './retail-data.js';
import {
  FINANCE_ANALYST_INSTRUCTION,
  INVOICE_AUDITOR_INSTRUCTION,
  INVENTORY_ANALYST_INSTRUCTION,
  RETAIL_PLANNER_INSTRUCTION,
  SALES_ANALYST_INSTRUCTION,
  retailAnalystMessage,
  retailPlannerMessage,
  type RetailTeamMessage,
} from './retail-prompts.js';
import {
  parseRetailAnalysis,
  parseRetailPlan,
  type RetailCandidate,
} from './retail-parsing.js';
import type { RetailPlanAnswer } from './retail-prompts.js';
import {
  buildRetailCandidates,
  buildRetailReport,
  type RetailAgentReport,
} from './retail-report.js';
import {
  configureRetailNetwork,
  parseRetailTeamMessage,
  retailNetworkPolicy,
  setRetailNetworkMessageHandler,
} from './retail-network.js';

process.env.MOZAIK_REDACTION ??= 'content';

const OUT_DIR = 'out';
const OUT_FILE = `${OUT_DIR}/stockmind-review.md`;
const preview = (text: string) => text.replace(/\s+/g, ' ').slice(0, 250);

function fail(message: string, error?: unknown): never {
  console.error(`\n[error] ${message}`, error ?? '');
  process.exit(1);
}

const config: Config = (() => {
  try {
    return loadConfig(process.env);
  } catch (error) {
    return fail((error as Error).message);
  }
})();

let dataset: RetailDataset;
let analysis: RetailAnalysis;
let candidates: RetailCandidate[];
try {
  dataset = loadRetailDataset(defaultDataRoot());
  analysis = analyzeRetailDataset(dataset);
  candidates = buildRetailCandidates(dataset, analysis);
} catch (error) {
  fail(`could not load or analyze the local cafe data: ${(error as Error).message}`);
}

type AnalystRole = 'sales' | 'inventory' | 'finance' | 'invoice_audit';
type Role = AnalystRole | 'planner';

interface AgentJob {
  agent: Agent;
  role: Role;
  message: string;
  startTime: number;
  validationAttempt: number;
}

interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
}

class StockMindState extends RuntimeState {
  agentResults = new Map<AnalystRole, RetailAgentReport>();
  teamMessages: RetailTeamMessage[] = [];
  errors: string[] = [];
  plan?: RetailPlanAnswer;
}

const state = new StockMindState();
const { initializeRuntime, join, runLoop, sendMessage } = defineRuntime<StockMindState>();
initializeRuntime({ state });

const evidence = buildLocalRetailEvidence(dataset, analysis);
const evidenceFacts = buildRetailEvidenceFacts(dataset, analysis);
const evidenceIds = new Set(evidenceFacts.keys());
for (const candidate of candidates) {
  for (const id of candidate.evidenceIds) {
    if (!evidenceFacts.has(id)) {
      evidenceFacts.set(id, JSON.stringify({
        target: candidate.target,
        metrics: candidate.metrics,
      }));
    }
  }
}
const datasetKey = createHash('sha256')
  .update(JSON.stringify([...evidenceFacts.entries()]))
  .digest('hex');
const runId = crypto.randomUUID();
configureRetailNetwork(datasetKey, evidenceFacts);
const agents: Array<{ role: AnalystRole; name: string; instruction: string; evidence: string }> = [
  { role: 'sales', name: 'Sales & Demand Analyst', instruction: SALES_ANALYST_INSTRUCTION, evidence: evidence.sales },
  { role: 'inventory', name: 'Inventory & Expiry Analyst', instruction: INVENTORY_ANALYST_INSTRUCTION, evidence: evidence.inventory },
  { role: 'finance', name: 'Cost & Margin Analyst', instruction: FINANCE_ANALYST_INSTRUCTION, evidence: evidence.finance },
  { role: 'invoice_audit', name: 'Invoice Reconciliation Auditor', instruction: INVOICE_AUDITOR_INSTRUCTION, evidence: evidence.invoiceAudit },
];

const agentById = new Map<string, { role: AnalystRole; name: string }>();
const agentsByRole = new Map<AnalystRole, Agent>();
const networkAgents: Array<{ role: Role; name: string }> = [];
for (const definition of agents) {
  const agent = createAgent({
    name: definition.name,
    capabilities: ['inference', 'analyze-evidence'],
    instruction: definition.instruction,
    tools: [],
    handlers: [],
  });
  agentById.set(agent.getId(), {
    role: definition.role,
    name: definition.name,
  });
  agentsByRole.set(definition.role, agent);
  networkAgents.push({ role: definition.role, name: definition.name });
  join(agent);
}

const planner = createAgent({
  name: 'Promotion & Action Planner',
  capabilities: ['inference'],
  instruction: RETAIL_PLANNER_INSTRUCTION,
  tools: [],
  handlers: [],
});
const plannerId = planner.getId();
networkAgents.push({ role: 'planner', name: 'Promotion & Action Planner' });
join(planner);

const names = new Map<string, string>([
  ...[...agentsByRole.entries()].map(([role, agent]) => [
    agent.getId(),
    agents.find((definition) => definition.role === role)!.name,
  ] as const),
  [plannerId, 'Promotion & Action Planner'],
]);

const tokens = { input: 0, output: 0 };
const jobs = new Map<string, AgentJob>();
const callQueue: (() => void)[] = [];
const callTimes: number[] = [];
const answered = new Set<string>();
const answeredAnalysts = new Set<AnalystRole>();
const seenTeamMessages = new Set<string>();
const forwardedTeamMessages = new Set<string>();
const networkPeersByRole = new Map<Role, Peer>();
const pendingNetworkSends = new Set<Promise<void>>();
let modelIndex = 0;
let plannerStarted = false;
let nextAnalystIndex = 0;
let finished = false;
let networkId: string | undefined;
let plannerCandidates: RetailCandidate[] = [];
let pumpTimer: NodeJS.Timeout | undefined;
let timeout: NodeJS.Timeout | undefined;
const currentModel = () => config.models[modelIndex] ?? config.models[0]!;

function pumpQueue(): void {
  const now = Date.now();
  while (callTimes.length && now - callTimes[0]! >= 60_000) callTimes.shift();
  while (callQueue.length && callTimes.length < config.requestsPerMinute) {
    callTimes.push(now);
    callQueue.shift()!();
  }
  if (callQueue.length && !pumpTimer) {
    pumpTimer = setTimeout(() => {
      pumpTimer = undefined;
      pumpQueue();
    }, 60_000 - (now - callTimes[0]!) + 50);
  }
}

function run(job: AgentJob): void {
  jobs.set(job.agent.getId(), job);
  callQueue.push(() => {
    console.log(`[${names.get(job.agent.getId()) ?? job.agent.getId()}] started`);
    Promise.resolve()
      .then(() =>
        runLoop(job.agent.getId(), job.message, {
          model: currentModel(),
          context: job.agent.getMemory().getContext(),
          tools: job.agent.getTools(),
        })
      )
      .catch((error: unknown) => handleModelError(error, job));
  });
  pumpQueue();
}

function allAnalystsAnswered(): boolean {
  return agents.every(({ role }) => answeredAnalysts.has(role));
}

function messageFromResult(role: Role, summary: string, findings: RetailAgentReport['findings']): RetailTeamMessage {
  return {
    protocol: 'stockmind.team.v1',
    messageId: crypto.randomUUID(),
    runId,
    datasetKey,
    role,
    status: 'completed',
    summary,
    findings,
  };
}

function publishTeamMessage(message: RetailTeamMessage, producerId: string): void {
  if (!seenTeamMessages.has(message.messageId)) {
    seenTeamMessages.add(message.messageId);
    state.teamMessages.push(message);
  }
  if (!forwardedTeamMessages.has(message.messageId)) {
    forwardedTeamMessages.add(message.messageId);
    sendNetworkTeamMessage(message);
  }
  sendMessage(JSON.stringify({
    protocol: 'stockmind.runtime.v1',
    origin: 'local',
    message,
  }), producerId);
}

function sendNetworkTeamMessage(message: RetailTeamMessage): void {
  if (!networkId) return;
  const peer = networkPeersByRole.get(message.role);
  if (!peer) {
    state.errors.push(`Mozaik Network has no peer registered for ${message.role}.`);
    return;
  }
  let pending: Promise<void>;
  pending = sendNetworkMessage(peer, networkId, JSON.stringify(message))
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      const report = `Mozaik Network could not send ${message.role}'s team message: ${detail}`;
      state.errors.push(report);
      console.error(`[network] ${report}`);
    })
    .finally(() => pendingNetworkSends.delete(pending));
  pendingNetworkSends.add(pending);
}

function nextAnalyst(): void {
  if (finished) return;
  const definition = agents[nextAnalystIndex++];
  if (!definition) {
    finishIfReady();
    return;
  }
  const agent = agentsByRole.get(definition.role)!;
  run({
    agent,
    role: definition.role,
    message: retailAnalystMessage(
      analysis.periodStart,
      analysis.periodEnd,
      definition.evidence,
      state.teamMessages
    ),
    startTime: Date.now(),
    validationAttempt: 0,
  });
}

function candidateHasCompletedAnalyst(candidate: RetailCandidate): boolean {
  if (candidate.type === 'promotion_test' || candidate.type === 'bundle_test') {
    return state.agentResults.has('sales');
  }
  if (candidate.type === 'inventory_check' || candidate.type === 'markdown_review') {
    return state.agentResults.has('inventory');
  }
  if (candidate.type === 'price_review' || candidate.type === 'expense_review') {
    return state.agentResults.has('finance');
  }
  return false;
}

function finishIfReady(): void {
  if (finished || !allAnalystsAnswered() || plannerStarted) return;
  if (state.agentResults.size === 0) return finish(1);
  plannerStarted = true;
  plannerCandidates = candidates.filter(candidateHasCompletedAnalyst);
  run({
    agent: planner,
    role: 'planner',
    message: retailPlannerMessage({
      analysis: [...state.agentResults.entries()].map(([role, result]) => ({
        role,
        summary: result.summary,
        findings: result.findings,
      })),
      candidates: plannerCandidates,
      peerMessages: state.teamMessages.filter((message) => message.runId !== runId),
    }),
    startTime: Date.now(),
    validationAttempt: 0,
  });
}

function completeAnalyst(
  producerId: string,
  definition: { role: AnalystRole; name: string },
  job: AgentJob,
  answer: string
): void {
  const parsed = parseRetailAnalysis(answer, evidenceIds, evidenceFacts);
  if (!parsed.ok && job.validationAttempt < 1) {
    console.warn(`[retry] ${definition.name} response did not pass validation: ${parsed.error}`);
    run({
      ...job,
      validationAttempt: job.validationAttempt + 1,
      message: `${job.message}\n\nYour previous answer failed validation: ${parsed.error}. Re-check the provided evidence and return only the required JSON with valid evidence IDs and grounded figures.`,
    });
    return;
  }

  answered.add(producerId);
  answeredAnalysts.add(definition.role);
  jobs.delete(producerId);
  if (!parsed.ok) {
    state.errors.push(`${definition.name}: answer rejected after retry: ${parsed.error}`);
    console.error(`[error] ${definition.name} answer rejected after retry: ${parsed.error}`);
    return nextAnalyst();
  }

  const result: RetailAgentReport = {
    name: definition.name,
    summary: parsed.value.summary,
    findings: parsed.value.findings,
    durationMs: Date.now() - job.startTime,
  };
  state.agentResults.set(definition.role, result);
  publishTeamMessage(messageFromResult(definition.role, result.summary, result.findings), producerId);
  console.log(`[${definition.name}] answer accepted (${parsed.value.findings.length} findings)`);
  nextAnalyst();
}

function recordAnalystAnswer(producerId: string, answer: string): void {
  const definition = agentById.get(producerId);
  const job = jobs.get(producerId);
  if (!definition || !job || job.role === 'planner' || answered.has(producerId)) return;
  completeAnalyst(producerId, definition, job, answer);
}

function recordPlannerAnswer(answer: string): void {
  const job = jobs.get(plannerId);
  if (!job || answered.has(plannerId)) return;
  const parsed = parseRetailPlan(answer, plannerCandidates);
  if (!parsed.ok && job.validationAttempt < 1) {
    console.warn(`[retry] planner response did not pass validation: ${parsed.error}`);
    run({
      ...job,
      validationAttempt: job.validationAttempt + 1,
      message: `${job.message}\n\nYour previous answer failed validation: ${parsed.error}. Select only supplied candidate IDs and return the required JSON.`,
    });
    return;
  }
  answered.add(plannerId);
  jobs.delete(plannerId);
  if (!parsed.ok) {
    state.errors.push(`Promotion & Action Planner: answer rejected after retry: ${parsed.error}`);
    console.error(`[error] Promotion & Action Planner answer rejected after retry: ${parsed.error}`);
    return finish(1);
  }
  state.plan = parsed.value;
  publishTeamMessage(messageFromResult('planner', parsed.value.summary, parsed.value.recommendations.map((recommendation) => {
    const candidate = plannerCandidates.find(({ id }) => id === recommendation.candidateId);
    return {
      title: candidate?.target ?? recommendation.candidateId,
      detail: recommendation.rationale,
      evidenceIds: recommendation.evidenceIds,
    };
  })), plannerId);
  console.log(`[Promotion & Action Planner] answer accepted (${parsed.value.recommendations.length} recommendations)`);
  finish(state.errors.length > 0 ? 1 : 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function handleRuntimeMessage(payload: unknown): void {
  if (!isRecord(payload) || typeof payload.message !== 'string') return;
  let envelope: unknown;
  try {
    envelope = JSON.parse(payload.message);
  } catch {
    return;
  }
  if (
    !isRecord(envelope) ||
    envelope.protocol !== 'stockmind.runtime.v1' ||
    (envelope.origin !== 'local' && envelope.origin !== 'network')
  ) {
    return;
  }
  const message = parseRetailTeamMessage(
    JSON.stringify(envelope.message),
    datasetKey,
    evidenceFacts
  );
  if (!message) {
    const source = envelope.origin === 'local' ? 'local runtime' : 'Mozaik Network';
    const error = `Ignored a ${source} message that failed StockMind protocol validation.`;
    if (envelope.origin === 'local') state.errors.push(error);
    console.warn(`[message] ${error}`);
    return;
  }
  if (envelope.origin === 'local') {
    if (!seenTeamMessages.has(message.messageId)) {
      seenTeamMessages.add(message.messageId);
      state.teamMessages.push(message);
    }
    if (!forwardedTeamMessages.has(message.messageId)) {
      forwardedTeamMessages.add(message.messageId);
      sendNetworkTeamMessage(message);
    }
    return;
  }
  if (seenTeamMessages.has(message.messageId)) return;
  seenTeamMessages.add(message.messageId);
  state.teamMessages.push(message);
}

const monitor = createHuman({
  name: 'StockMind Monitor',
  capabilities: [],
  handlers: [
    {
      specification: new WhenAnyAnswer(),
      processor: {
        apply({ event }) {
          const answer = answerText(event.payload);
          if (event.producerId === plannerId) {
            recordPlannerAnswer(answer);
            return;
          }
          recordAnalystAnswer(event.producerId, answer);
        },
      },
    },
    {
      specification: new WhenMessageSent(),
      processor: {
        apply({ event }) {
          handleRuntimeMessage(event.payload);
        },
      },
    },
    {
      specification: new WhenInferenceCompleted(),
      processor: {
        apply({ event }) {
          const usage = (event.payload as { tokenUsage?: Partial<TokenTotals> } | null)?.tokenUsage;
          tokens.input += usage?.inputTokens ?? 0;
          tokens.output += usage?.outputTokens ?? 0;
        },
      },
    },
  ],
});
join(monitor);

setRetailNetworkMessageHandler((message, senderId) => {
  if (finished || seenTeamMessages.has(message.messageId)) return;
  seenTeamMessages.add(message.messageId);
  state.teamMessages.push(message);
  console.log(`[network] received ${message.role} results from peer ${senderId}`);
  sendMessage(JSON.stringify({
    protocol: 'stockmind.runtime.v1',
    origin: 'network',
    message,
  }), monitor.getId());
});

function writeReportAndExit(exitCode: number): void {
  void Promise.all([...pendingNetworkSends]).then(() => {
    mkdirSync(OUT_DIR, { recursive: true });
    const report = buildRetailReport(dataset, analysis, {
      candidates,
      agentResults: [...state.agentResults.values()],
      ...(state.plan ? { plan: state.plan } : {}),
      errors: state.errors,
      model: currentModel(),
      tokens,
      teamMessages: state.teamMessages,
    });
    writeFileSync(OUT_FILE, report);
    console.log(`\nReport: ${OUT_FILE}`);
    console.log(`Model: ${currentModel()}; usage: ${tokens.input} input / ${tokens.output} output tokens.`);
    console.log('\nSynthetic demo data only. Not financial advice. No prices or orders were changed.');
    process.exit(state.errors.length > 0 ? 1 : exitCode);
  }).catch((error: unknown) => {
    console.error(`[error] could not write the final report: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

function finish(exitCode: number): void {
  if (finished) return;
  finished = true;
  if (timeout) clearTimeout(timeout);
  if (pumpTimer) clearTimeout(pumpTimer);
  writeReportAndExit(exitCode);
}

function abort(reason: string): void {
  if (finished) return;
  state.errors.push(reason);
  for (const job of jobs.values()) {
    if (!answered.has(job.agent.getId())) {
      state.errors.push(`${names.get(job.agent.getId()) ?? job.agent.getId()} did not complete.`);
      answered.add(job.agent.getId());
    }
  }
  console.error(`\n[error] ${reason}; writing a partial report.`);
  finish(1);
}

function retryPending(delayMs: number, message: string): void {
  console.error(`[retry] ${message}; re-running ${jobs.size} pending agent(s) in ${delayMs / 1000}s`);
  setTimeout(() => {
    retryScheduled = false;
    callQueue.length = 0;
    for (const job of [...jobs.values()]) run(job);
  }, delayMs);
}

let retryScheduled = false;
function failJob(job: AgentJob, detail: { status?: number; message?: string }): void {
  const producerId = job.agent.getId();
  if (!jobs.has(producerId) || answered.has(producerId)) return;
  jobs.delete(producerId);
  answered.add(producerId);
  const message = `${names.get(producerId) ?? producerId} failed${detail.status ? ` (${detail.status})` : ''}: ${detail.message ?? 'model request failed.'}`;
  state.errors.push(message);
  console.error(`[error] ${message}`);
  if (job.role === 'planner') {
    finish(1);
    return;
  }
  answeredAnalysts.add(job.role);
  nextAnalyst();
}

function handleModelError(error: unknown, failedJob?: AgentJob): void {
  if (finished || retryScheduled) return;
  const detail = error as { status?: number; message?: string };
  const status = detail.status;
  if (status === 429 && modelIndex + 1 < config.models.length) {
    modelIndex++;
    retryScheduled = true;
    retryPending(1000, `model quota/limit reached; retrying with ${currentModel()}`);
    return;
  }
  if (failedJob) {
    failJob(failedJob, detail);
    return;
  }
  abort(`model request failed${status ? ` (${status})` : ''}: ${detail.message ?? String(error)}`);
}

async function connectNetworkAgents(): Promise<void> {
  const inviteUrl = process.env.MOZAIK_INVITE?.trim();
  if (!inviteUrl) return;
  const link = readInviteLink(inviteUrl, HOSTED_NETWORK);
  if (!link) throw new Error('MOZAIK_INVITE is not a valid Mozaik Network invite link.');

  const client = new NetworkClient({ origin: link.origin });
  for (const { role, name } of networkAgents) {
    const peer = await client.createPeer({
      name,
      role: 'agent',
      capabilities: ['message'],
      invite: link.invite,
      policy: retailNetworkPolicy,
    });
    if (!peer.invitedTo) throw new Error(`Network did not assign an invite network to peer "${name}".`);
    if (networkId && networkId !== peer.invitedTo) {
      throw new Error(`Network assigned peer "${name}" to a different invite network.`);
    }
    networkId = peer.invitedTo;
    await joinNetwork(peer, peer.invitedTo, client);
    networkPeersByRole.set(role, peer);
  }
  console.log(`Connected ${networkAgents.length} StockMind agents to Mozaik Network with validated message policies.`);
}

async function start(): Promise<void> {
  try {
    await connectNetworkAgents();
  } catch (error) {
    fail(`could not connect agents to Mozaik Network: ${(error as Error).message}`);
  }

  console.log(`StockMind AI — cafe operations analysis (${analysis.periodStart} to ${analysis.periodEnd})`);
  console.log(`${dataset.sales.length} POS rows, ${dataset.products.length} products, ${dataset.invoicePairs.length} invoice pairs.`);
  console.log(`Starting ${agents.length} analysts in sequence, sharing validated findings; planner follows after results.`);
  console.log(`Model: ${config.models.join(' → ')}; max ${config.requestsPerMinute} initial requests/min.`);
  console.log('');

  timeout = setTimeout(() => abort(`no complete agent report within ${config.timeoutMs} ms`), config.timeoutMs);
  nextAnalyst();
}

process.on('unhandledRejection', (error: unknown) => handleModelError(error));
process.on('uncaughtException', (error: unknown) => handleModelError(error));
void start();
