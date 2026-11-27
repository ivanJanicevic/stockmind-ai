import 'dotenv/config';

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';

import {
  defineRuntime,
  RuntimeState,
  createAgent,
  createHuman,
  type Agent,
} from '@mozaik-ai/core';
import { join as joinNetwork } from '@jigjoy/mozaik-network';
import { HOSTED_NETWORK, readInviteLink } from '@jigjoy/mozaik-network/invite-link';
import { NetworkClient } from '@jigjoy/mozaik-network/network-client';

import { loadConfig, parseApprovals, type Config } from './config.js';
import { DATA_DIR, loadDataset } from './data/load.js';
import { periodResult, priceChanges, round2, stockCheck, unitMargins, weeklyTrend } from './analytics.js';
import {
  blockingFailures,
  decide,
  findSupplier,
  loadCases,
  loadMaster,
  matchInvoice,
  missingDocuments,
  type ApCase,
  type Decision,
} from './ap.js';
import { parseInvoice, parseNote } from './documents.js';
import { allowedFigures, parseFindings, parseReview, type Rejected, type Review } from './findings.js';
import { parseVerification, unsourcedFigures } from './parsing.js';
import { WhenAnyAnswer, WhenInferenceCompleted, answerText } from './events.js';
import { buildPaymentCsv, type PaymentOrder } from './payments.js';
import { buildReport, DISCLAIMER, rsd, type AnalystResult, type TimelineEntry } from './report.js';
import {
  CLAIMS_WRITER,
  CLAIM_OUTPUT,
  FINDINGS_OUTPUT_FORMAT,
  INVOICE_CLERK,
  INVOICE_OUTPUT,
  MARGIN_ANALYST,
  NOTE_OUTPUT,
  RECEIVING_CLERK,
  REVIEWER,
  REVIEW_OUTPUT,
  SALES_ANALYST,
  STOCK_ANALYST,
  claimMessage,
  documentMessage,
  reviewMessage,
  rowsMessage,
  type OutputFormat,
} from './agents.js';

const OUT_DIR = 'out';
const startedAt = Date.now();
const elapsed = () => Date.now() - startedAt;
const tokens = { input: 0, output: 0 };
let calls = 0;

const preview = (text: string) => '`' + text.replace(/\s+/g, ' ').slice(0, 300).replace(/`/g, "'") + '`';

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

// Human approver: `npm run dev -- --approve F-ZP-2026-01184` releases an
// invoice above the agent's limit. It cannot release a held invoice.
const approved: ReadonlySet<string> = new Set(parseApprovals(process.argv.slice(2)));

// ---------------------------------------------------------------------------
// Data and deterministic analysis (no model involved)

const ds = loadDataset();
const master = loadMaster();
const { pnl, costChanges } = periodResult(ds);

type Row = { id: string; sources: string[]; flagged?: boolean; oversold?: boolean };
const stockRows: Row[] = stockCheck(ds);
const trendRows: Row[] = weeklyTrend(ds).filter((r) => r.weeks.some((w) => w > 0));
const marginRows: Row[] = [...priceChanges(ds), ...unitMargins(ds).filter((r) => r.flagged), ...pnl, ...costChanges];
const isFlagged = (r: Row) => r.flagged === true || r.oversold === true || /^(PRICE|PNL|COST)-/.test(r.id);

const analysis = (key: string, title: string, agent: string, rows: Row[]): AnalystResult => ({
  key,
  title,
  agent,
  rows,
  flaggedIds: rows.filter(isFlagged).map((r) => r.id),
  accepted: [],
  rejected: [],
  done: false,
});

// Shared runtime state: every agent's result lands here; the report reads it.
class AppState extends RuntimeState {
  cases: ApCase[] = loadCases(readdirSync(`${DATA_DIR}text`));
  analyses: AnalystResult[] = [
    analysis('stock', 'Stock vs deliveries', 'Stock Analyst', stockRows),
    analysis('sales', 'Demand trends', 'Sales Analyst', trendRows),
    analysis('margin', 'Margins and costs', 'Margin & Cost Analyst', marginRows),
  ];
  review: { review: Review; rejected: Rejected[] } | undefined;
  reviewNote: string | undefined;
  reviewDone = false;
  timeline = new Map<string, TimelineEntry>();
}

const state = new AppState();
const { initializeRuntime, join, runLoop } = defineRuntime<AppState>();
initializeRuntime({ state });

// ---------------------------------------------------------------------------
// Agents

type Role = 'invoice' | 'note' | 'claims' | 'analyst' | 'reviewer';
interface AgentInfo {
  agent: Agent;
  name: string;
  role: Role;
  caseId?: string;
  analyst?: string;
}
const agents = new Map<string, AgentInfo>();

function register(name: string, role: Role, instruction: string, extra: { caseId?: string; analyst?: string } = {}): Agent {
  const agent = createAgent({ name, capabilities: ['inference'], instruction, tools: [], handlers: [] });
  agents.set(agent.getId(), { agent, name, role, ...extra });
  state.timeline.set(agent.getId(), { agent: name, role, status: 'idle' });
  join(agent);
  return agent;
}

const analystInstruction: Record<string, string> = { stock: STOCK_ANALYST, sales: SALES_ANALYST, margin: MARGIN_ANALYST };
const analystAgent = new Map<string, Agent>();
for (const a of state.analyses) analystAgent.set(a.key, register(a.agent, 'analyst', analystInstruction[a.key]!, { analyst: a.key }));

const clerks = new Map<string, { invoice: Agent; note: Agent; claims: Agent }>();
for (const c of state.cases) {
  clerks.set(c.id, {
    invoice: register(`Invoice Clerk ${c.id}`, 'invoice', INVOICE_CLERK, { caseId: c.id }),
    note: register(`Receiving Clerk ${c.id}`, 'note', RECEIVING_CLERK, { caseId: c.id }),
    claims: register(`Claims Writer ${c.id}`, 'claims', CLAIMS_WRITER, { caseId: c.id }),
  });
}
const reviewer = register('Reviewer', 'reviewer', REVIEWER);

// ---------------------------------------------------------------------------
// Rate-limited model calls with retries

const pendingLoops = new Map<string, { agent: Agent; message: string; output: OutputFormat }>();
let modelIndex = 0;
const currentModel = () => config.models[modelIndex] ?? config.models[0]!;
// Native JSON Schema output; switched off automatically if a model rejects it.
let useStructuredOutput = true;

// Client-side rate limit (REQUESTS_PER_MINUTE), sliding 60 s window.
const callQueue: (() => void)[] = [];
const callTimes: number[] = [];
let pumpTimer: NodeJS.Timeout | undefined;

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

const label = (id: string) => agents.get(id)?.name ?? id;
const stamp = () => `[+${(elapsed() / 1000).toFixed(1)}s]`;

// runLoop is fire-and-forget; provider errors surface as unhandled rejections.
function run(agent: Agent, message: string, output: OutputFormat): void {
  pendingLoops.set(agent.getId(), { agent, message, output });
  const entry = state.timeline.get(agent.getId());
  if (entry) entry.status = 'queued';
  callQueue.push(() => {
    calls++;
    if (entry) {
      entry.startedAt ??= elapsed();
      entry.status = 'running';
    }
    console.log(`${stamp()} [${label(agent.getId())}] started`);
    Promise.resolve()
      .then(() =>
        runLoop(agent.getId(), message, {
          model: currentModel(),
          context: agent.getMemory().getContext(),
          tools: agent.getTools(),
          ...(useStructuredOutput ? { structuredOutput: { name: output.name, schema: output.schema, strict: true } } : {}),
        })
      )
      .catch(handleModelError);
  });
  pumpQueue();
}

// ---------------------------------------------------------------------------
// Coordination: the Monitoring participant reacts to every model.answer event,
// writes results into shared state and starts the agents that depend on them.

const answered = new Set<string>();
const invoiceIn = new Set<string>();
const noteIn = new Set<string>();
let reviewerStarted = false;

const caseOf = (id: string) => state.cases.find((c) => c.id === id)!;
const facts = (c: ApCase) => blockingFailures(c).map(({ name, detail, impactRsd }) => ({ name, detail, impactRsd }));

function handleInvoice(c: ApCase, answer: string): void {
  const parsed = parseInvoice(answer);
  if (parsed.ok) c.invoice = parsed.value;
  else c.errors.push(`invoice clerk answer rejected: ${parsed.error}. Answer started with: ${preview(answer)}`);
  invoiceIn.add(c.id);
  completePair(c);
}

function handleNote(c: ApCase, answer: string): void {
  const parsed = parseNote(answer);
  if (parsed.ok) c.note = parsed.value;
  else c.errors.push(`receiving clerk answer rejected: ${parsed.error}. Answer started with: ${preview(answer)}`);
  noteIn.add(c.id);
  completePair(c);
}

// Both clerks answered: check them against each other and the agreed prices.
// A hold starts the Claims Writer for that invoice.
function completePair(c: ApCase): void {
  if (!invoiceIn.has(c.id) || !noteIn.has(c.id)) return;
  if (c.invoice && c.note) c.checks = matchInvoice(c, ds.purchases, master);
  const supplier = c.invoice && findSupplier(master, c.invoice.supplierPib.value);
  // If our own clerks' reading can't be verified, a person re-checks the
  // documents; the supplier only gets a claim for real discrepancies.
  const readingOk = c.checks.every((x) => x.ok || !x.name.endsWith('_sources'));
  if (blockingFailures(c).length && supplier && readingOk && !c.errors.length) {
    const contact = { naziv: supplier.naziv, email: supplier.email, telefon: supplier.telefon };
    run(clerks.get(c.id)!.claims, claimMessage(c.invoiceText, c.noteText, facts(c), contact), CLAIM_OUTPUT);
  } else {
    c.done = true;
  }
}

function handleClaim(c: ApCase, answer: string): void {
  const parsed = parseVerification(answer);
  const supplier = findSupplier(master, c.invoice!.supplierPib.value)!;
  if (!parsed.ok) {
    c.claimError = `answer rejected: ${parsed.error}. Answer started with: ${preview(answer)}`;
  } else {
    // Only figures from the documents, the failed checks or the supplier record.
    const allowed = [c.invoiceText, c.noteText, allowedFigures(facts(c)), JSON.stringify(supplier)].join('\n');
    const unsourced = unsourcedFigures(`${parsed.value.subject}\n${parsed.value.body}`, allowed);
    if (unsourced.length) c.claimError = `draft withheld: unsourced figures ${unsourced.join(', ')}`;
    else c.claim = { to: supplier.email, ...parsed.value };
  }
  c.done = true;
}

function handleAnalysis(key: string, answer: string): void {
  const a = state.analyses.find((x) => x.key === key)!;
  const parsed = parseFindings(answer, new Map(a.rows.map((r) => [r.id, r])));
  if (parsed.ok) {
    a.accepted = parsed.value.accepted;
    a.rejected = parsed.value.rejected;
  } else {
    a.error = `analyst answer rejected: ${parsed.error}. Answer started with: ${preview(answer)}`;
  }
  a.done = true;
}

// What the reviewer gets: accepted findings with their data, and the AP outcome.
function reviewItems(): Map<string, unknown> {
  const items = new Map<string, unknown>();
  let n = 0;
  for (const a of state.analyses) {
    for (const f of a.accepted) {
      const id = `F-${++n}`;
      items.set(id, { id, analyst: a.agent, finding: f, data: a.rows.find((r) => r.id === f.id) });
    }
  }
  for (const c of state.cases) {
    if (!c.invoice) continue;
    const id = `AP-${c.invoice.invoiceNumber.value}`;
    items.set(id, {
      id,
      supplier: c.invoice.supplierName.value,
      totalAmount: c.invoice.totalAmount.value,
      decision: decide(c, config.approvalLimitRsd, approved),
      failedChecks: facts(c),
    });
  }
  return items;
}

// The reviewer starts once every specialist is in: all analysts answered and
// every invoice pair checked.
function maybeStartReviewer(): void {
  if (reviewerStarted) return;
  const ready = state.analyses.every((a) => a.done) && state.cases.every((c) => invoiceIn.has(c.id) && noteIn.has(c.id));
  if (!ready) return;
  reviewerStarted = true;
  const items = reviewItems();
  if (![...items.keys()].some((id) => id.startsWith('F-'))) {
    state.reviewNote = 'skipped: no analyst findings were accepted';
    state.reviewDone = true;
    return;
  }
  run(reviewer, reviewMessage([...items.values()]), REVIEW_OUTPUT);
}

function handleReview(answer: string): void {
  const parsed = parseReview(answer, reviewItems());
  if (parsed.ok) state.review = parsed.value;
  else state.reviewNote = `reviewer answer rejected: ${parsed.error}. Answer started with: ${preview(answer)}`;
  state.reviewDone = true;
}

const monitor = createHuman({
  name: 'Monitoring',
  capabilities: [],
  handlers: [
    {
      specification: new WhenAnyAnswer(),
      processor: {
        apply({ event }) {
          const info = agents.get(event.producerId);
          if (!info || answered.has(event.producerId) || finished) return;
          answered.add(event.producerId);
          pendingLoops.delete(event.producerId);
          const entry = state.timeline.get(event.producerId);
          if (entry) {
            entry.answeredAt = elapsed();
            entry.status = 'answered';
          }
          console.log(`${stamp()} [${info.name}] answered`);

          const answer = answerText(event.payload);
          if (info.role === 'invoice') handleInvoice(caseOf(info.caseId!), answer);
          else if (info.role === 'note') handleNote(caseOf(info.caseId!), answer);
          else if (info.role === 'claims') handleClaim(caseOf(info.caseId!), answer);
          else if (info.role === 'analyst') handleAnalysis(info.analyst!, answer);
          else handleReview(answer);

          maybeStartReviewer();
          finishIfDone();
        },
      },
    },
    {
      specification: new WhenInferenceCompleted(),
      processor: {
        apply({ event }) {
          const usage = (event.payload as { tokenUsage?: { inputTokens?: number; outputTokens?: number } } | null)?.tokenUsage;
          tokens.input += usage?.inputTokens ?? 0;
          tokens.output += usage?.outputTokens ?? 0;
        },
      },
    },
  ],
});
join(monitor);

// ---------------------------------------------------------------------------
// Finish: decisions, payment draft, report

let finished = false;

const allDone = () => state.cases.every((c) => c.done) && state.analyses.every((a) => a.done) && state.reviewDone;

// Deferred so other handlers for the same event run before the process exits.
function finishIfDone(): void {
  if (!finished && allDone()) setImmediate(() => finish(0));
}

function finish(exitCode: number): void {
  if (finished) return;
  finished = true;

  const decisions = new Map<string, Decision>(state.cases.map((c) => [c.id, decide(c, config.approvalLimitRsd, approved)]));
  const orders: PaymentOrder[] = state.cases
    .filter((c) => ['ready', 'approved'].includes(decisions.get(c.id)!))
    .map((c) => {
      const inv = c.invoice!;
      return {
        status: decisions.get(c.id) as 'ready' | 'approved',
        recipient: inv.supplierName.value,
        recipientAccount: inv.supplierAccount.value,
        amount: inv.totalAmount.value,
        reference: inv.invoiceNumber.value,
        purpose: `Plaćanje po računu ${inv.invoiceNumber.value}`,
        valueDate: inv.dueDate.value,
        payer: master.platilac.naziv,
        payerAccount: master.platilac.racun,
        source: `data/fakture/${c.invoiceFile.replace('.txt', '.pdf')}: "${inv.totalAmount.quote}"`,
      };
    });
  const paymentTotal = round2(orders.reduce((s, o) => s + o.amount, 0));

  mkdirSync(OUT_DIR, { recursive: true });
  const paymentFile = orders.length ? `${OUT_DIR}/payment-draft.csv` : null;
  if (paymentFile) writeFileSync(paymentFile, buildPaymentCsv(orders));

  const reportFile = `${OUT_DIR}/review.md`;
  writeFileSync(
    reportFile,
    buildReport({
      cases: state.cases,
      decisions,
      limitRsd: config.approvalLimitRsd,
      approvalsGiven: [...approved],
      missing: missingDocuments(ds.purchases, state.cases),
      analyses: state.analyses,
      ...(state.review ? { review: state.review } : {}),
      ...(state.reviewNote ? { reviewNote: state.reviewNote } : {}),
      timeline: [...state.timeline.values()].filter((t) => t.status !== 'idle'),
      run: {
        models: config.models.slice(0, modelIndex + 1).join(' → '),
        tokens: `${tokens.input} in / ${tokens.output} out`,
        calls,
        durationS: elapsed() / 1000,
        network: networkStatus,
      },
      paymentFile,
      paymentTotal,
    })
  );

  console.log('');
  for (const c of state.cases) {
    const failed = blockingFailures(c).map((x) => x.name);
    const why = c.errors.length ? ' (agent error)' : failed.length ? ` (${failed.join(', ')})` : '';
    const claim = c.claim ? ' + claim drafted' : '';
    console.log(`${c.invoice?.invoiceNumber.value ?? c.invoiceFile}: ${decisions.get(c.id)}${why}${claim}`);
  }
  for (const a of state.analyses) {
    console.log(`${a.agent}: ${a.error ? 'failed' : `${a.accepted.length} findings accepted, ${a.rejected.length} rejected`}`);
  }
  console.log(`Reviewer: ${state.review ? `${state.review.review.actions.length} actions` : state.reviewNote}`);
  const waiting = state.cases.filter((c) => decisions.get(c.id) === 'needs_approval');
  if (waiting.length) {
    const ids = waiting.map((c) => c.invoice!.invoiceNumber.value).join(',');
    console.log(`\nTo approve as a human, re-run with: npm run dev -- --approve ${ids}`);
  }
  console.log(`\nReport: ${reportFile}`);
  if (paymentFile) console.log(`Payment draft: ${paymentFile} (${orders.length} orders, ${rsd(paymentTotal)})`);
  console.log(`Run: ${calls} model calls, ${(elapsed() / 1000).toFixed(1)} s, tokens ${tokens.input} in / ${tokens.output} out, Mozaik Network: ${networkStatus}`);
  console.log(`\n${DISCLAIMER}`);

  process.exit(exitCode);
}

// Stop early but still write the report: unfinished work gets the reason.
function abort(reason: string): void {
  if (finished) return;
  for (const c of state.cases) {
    if (c.done) continue;
    c.errors.push(reason);
    c.done = true;
  }
  for (const a of state.analyses) {
    if (a.done) continue;
    a.error = reason;
    a.done = true;
  }
  if (!state.reviewDone) state.reviewNote = `did not finish: ${reason}`;
  for (const t of state.timeline.values()) if (t.status === 'running' || t.status === 'queued') t.status = 'no answer';
  console.error(`\n[error] ${reason}; writing partial report.`);
  finish(1);
}

// ---------------------------------------------------------------------------
// Model errors: retry, wait out rate limits, fall back to other models

// Gemini 429 bodies say which quota was hit and when to retry.
function rateLimitInfo(error: unknown): { perDay: boolean; retryAfterMs: number | undefined } {
  const message = (error as { message?: string } | null)?.message ?? '';
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
  return { perDay: /PerDay/i.test(message), retryAfterMs: delay ? Math.ceil(Number(delay[1]) * 1000) : undefined };
}

function describeError(error: unknown): string {
  const e = error as { status?: number; message?: string };
  let message = e?.message ?? String(error);
  try {
    message = JSON.parse(message).error.message ?? message;
  } catch {
    // not a JSON error body
  }
  return `model call failed${e?.status ? ` (${e.status})` : ''}: ${message.split('\n')[0]}`;
}

// No HTTP status / 400 while structured output is on: retry once without it.
// 429 per-minute: wait retryDelay, same model. 429 daily quota: fall back now.
// 503/500: retry with backoff, then fall back. Mozaik doesn't say which loop
// failed, so every pending loop is re-run; repeat answers are ignored.
const RETRYABLE = new Set([429, 500, 503]);
const MAX_SAME_MODEL_RETRIES = 2;
const MAX_RATE_LIMIT_RETRIES = 4;
let sameModelRetries = 0;
let retryScheduled = false;

const isShortRateLimit = (error: unknown) => {
  const { perDay, retryAfterMs } = rateLimitInfo(error);
  return !perDay && (retryAfterMs === undefined || retryAfterMs <= 120_000);
};

// Errors from the optional network client must not trigger model retries.
const isNetworkError = (error: unknown) =>
  /mozaik-network|NetworkClient|network-client/i.test(String((error as Error | null)?.stack ?? error));

function handleModelError(error: unknown): void {
  if (isNetworkError(error)) {
    networkStatus = `error: ${describeError(error).replace(/^model call failed/, 'network')}`;
    console.warn(`[network] ${networkStatus}`);
    return;
  }
  if (finished) return fail('unexpected error', error);
  if (retryScheduled) return; // parallel loops usually fail together

  const status = (error as { status?: number } | null)?.status;
  if (pendingLoops.size === 0) return abort(describeError(error));

  let delayMs: number;
  let action: string;
  if ((status === undefined || status === 400) && useStructuredOutput) {
    useStructuredOutput = false;
    delayMs = 500;
    action = 'without structured output';
  } else if (status === undefined || !RETRYABLE.has(status)) {
    return abort(describeError(error));
  } else if (status === 429 && isShortRateLimit(error) && sameModelRetries < MAX_RATE_LIMIT_RETRIES) {
    sameModelRetries++;
    delayMs = rateLimitInfo(error).retryAfterMs ?? 30_000;
    action = `on ${currentModel()} (rate limit)`;
  } else if (status !== 429 && sameModelRetries < MAX_SAME_MODEL_RETRIES) {
    sameModelRetries++;
    delayMs = 2000 * 2 ** sameModelRetries;
    action = `on ${currentModel()}`;
  } else if (modelIndex + 1 < config.models.length) {
    modelIndex++;
    sameModelRetries = 0;
    delayMs = 1000;
    action = `on fallback model ${currentModel()}`;
  } else {
    return abort(describeError(error));
  }

  retryScheduled = true;
  console.error(`[retry] ${describeError(error)}\n[retry] re-running ${pendingLoops.size} pending agent(s) ${action} in ${delayMs / 1000}s`);
  setTimeout(() => {
    retryScheduled = false;
    callQueue.length = 0; // queued calls are pending too and get re-run below
    for (const loop of [...pendingLoops.values()]) run(loop.agent, loop.message, loop.output);
  }, delayMs);
}

process.on('unhandledRejection', handleModelError);
process.on('uncaughtException', handleModelError);
setTimeout(() => abort(`no answer within ${config.timeoutMs} ms`), config.timeoutMs);

// ---------------------------------------------------------------------------
// Optional Mozaik Network: visibility only (peers mirror agent names, the
// work happens in this runtime). Background, own timeout, never fails a run.

let networkStatus = process.env.MOZAIK_INVITE?.trim() ? 'connecting' : 'off (MOZAIK_INVITE not set)';
const NETWORK_TIMEOUT_MS = 15_000;

async function connectNetworkAgents(): Promise<void> {
  const link = readInviteLink(process.env.MOZAIK_INVITE!.trim(), HOSTED_NETWORK);
  if (!link) throw new Error('MOZAIK_INVITE must be a quoted link like "https://network.app.jigjoy.ai#nt_..." or a bare nt_ invite');
  const client = new NetworkClient({ origin: link.origin });
  for (const { name } of agents.values()) {
    const peer = await client.createPeer({ name, role: 'agent', capabilities: ['message'], invite: link.invite, policy: { rules: [] } });
    if (!peer.invitedTo) throw new Error(`network did not assign a network to peer "${name}"`);
    await joinNetwork(peer, peer.invitedTo, client);
  }
}

function startNetwork(): void {
  if (networkStatus.startsWith('off')) return;
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`timed out after ${NETWORK_TIMEOUT_MS / 1000}s`)), NETWORK_TIMEOUT_MS).unref()
  );
  Promise.race([connectNetworkAgents(), timeout])
    .then(() => {
      networkStatus = `connected (${agents.size} peers)`;
    })
    .catch((error: unknown) => {
      networkStatus = `skipped: ${error instanceof Error ? error.message : String(error)}`;
      console.warn(`[network] ${networkStatus}`);
    });
}

// ---------------------------------------------------------------------------
// Start: analysts and all clerks at once (the queue only spaces them out to
// the rate limit); matching, claims and the reviewer follow from events.

console.log(`StockMind AI — café finance desk for Kafe „Plava Šolja“ (models: ${config.models.join(' → ')})`);
console.log(
  `${state.cases.length} invoice/delivery-note pairs, ${ds.sales.length} POS rows · ${agents.size} agents · approval limit ${rsd(config.approvalLimitRsd)} · max ${config.requestsPerMinute} model calls/min`
);
if (approved.size) console.log(`Human approval given for: ${[...approved].join(', ')}`);
console.log('');

startNetwork();
for (const a of state.analyses) run(analystAgent.get(a.key)!, rowsMessage(a.rows), FINDINGS_OUTPUT_FORMAT);
for (const c of state.cases) {
  const { invoice, note } = clerks.get(c.id)!;
  run(invoice, documentMessage(`data/fakture/${c.invoiceFile.replace('.txt', '.pdf')}`, c.invoiceText), INVOICE_OUTPUT);
  run(note, documentMessage(`data/otpremnice/${c.noteFile.replace('.txt', '.pdf')}`, c.noteText), NOTE_OUTPUT);
}
