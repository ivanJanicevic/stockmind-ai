import 'dotenv/config';

import { mkdirSync, writeFileSync } from 'node:fs';

import {
  defineRuntime,
  RuntimeState,
  createAgent,
  createHuman,
  type Agent,
} from '@mozaik-ai/core';

import { loadConfig, parseApprovals, type Config } from './config.js';
import { invoices } from './data/invoices.js';
import { debtor, vendors } from './data/vendors.js';
import {
  WhenAnswerFrom,
  WhenAnyAnswer,
  WhenInferenceCompleted,
  answerText,
} from './events.js';
import {
  parseAudit,
  parseExtraction,
  parseVerification,
  unsourcedFigures,
} from './parsing.js';
import {
  addDuplicateChecks,
  caseChecks,
  decide,
  findVendor,
  needsVerification,
  type Decision,
  type InvoiceCase,
} from './checks.js';
import { buildPain001, type Payment } from './sepa.js';
import { buildReport, DISCLAIMER } from './report.js';
import {
  EXTRACTOR_INSTRUCTION,
  AUDITOR_INSTRUCTION,
  VERIFIER_INSTRUCTION,
  EXTRACTION_SCHEMA,
  AUDIT_SCHEMA,
  VERIFICATION_SCHEMA,
  extractorMessage,
  auditorMessage,
  verifierMessage,
} from './prompts.js';

const OUT_DIR = 'out';

interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
}
const tokens = { input: 0, output: 0 };

const preview = (text: string) =>
  '`' + text.replace(/\s+/g, ' ').slice(0, 300).replace(/`/g, "'") + '`';

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

// Human approver: `npm start -- --approve INV-1004` releases payments above
// the agent's limit. It cannot override failed checks or auditor concerns.
const approved: ReadonlySet<string> = new Set(parseApprovals(process.argv.slice(2)));

// Shared state: every agent's result lands in the case for its document.
class AppState extends RuntimeState {
  cases: InvoiceCase[] = invoices.map((doc) => ({
    doc,
    checks: [],
    errors: [],
    done: false,
  }));
}

const state = new AppState();
const { initializeRuntime, join, runLoop } = defineRuntime<AppState>();
initializeRuntime({ state });

interface OutputFormat {
  name: string;
  schema: Record<string, unknown>;
}

// The agent loop each unfinished case is waiting on, so it can be retried.
const pendingLoops = new Map<
  InvoiceCase,
  { agent: Agent; message: string; output: OutputFormat }
>();
let modelIndex = 0;
const currentModel = () => config.models[modelIndex] ?? config.models[0]!;

// Native JSON Schema output (Mozaik structuredOutput). If a model or provider
// rejects it, handleModelError switches it off and the prompt-level JSON
// contract plus the tolerant parser take over.
let useStructuredOutput = true;

// Client-side rate limit (REQUESTS_PER_MINUTE): free tiers allow only a few
// requests per minute, so model calls wait in a queue instead of all firing
// at once. Sliding 60s window.
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

// runLoop is fire-and-forget; provider errors usually surface as unhandled
// rejections (see handleModelError), but catch direct failures too.
function run(agent: Agent, c: InvoiceCase, message: string, output: OutputFormat): void {
  pendingLoops.set(c, { agent, message, output });
  callQueue.push(() => {
    Promise.resolve()
      .then(() =>
        runLoop(agent.getId(), message, {
          model: currentModel(),
          context: agent.getMemory().getContext(),
          tools: agent.getTools(),
          ...(useStructuredOutput
            ? { structuredOutput: { name: output.name, schema: output.schema, strict: true } }
            : {}),
        })
      )
      .catch(handleModelError);
  });
  pumpQueue();
}

const EXTRACTION_OUTPUT: OutputFormat = { name: 'invoice_extraction', schema: EXTRACTION_SCHEMA };
const AUDIT_OUTPUT: OutputFormat = { name: 'payment_audit', schema: AUDIT_SCHEMA };
const VERIFY_OUTPUT: OutputFormat = { name: 'vendor_verification', schema: VERIFICATION_SCHEMA };

// An answer settles the pending loop only if it came from the agent that
// loop belongs to (another handler may already have started the next one).
function settle(c: InvoiceCase, producerId: string): void {
  if (pendingLoops.get(c)?.agent.getId() === producerId) pendingLoops.delete(c);
}

// Per document: an Extractor, then an Auditor that checks the Extractor, then
// (only when bank details look wrong) a Verifier that reacts to the Auditor.
// Each agent only reacts to its own predecessor, so agents can't loop.
const names = new Map<string, string>();
const auditorCase = new Map<string, InvoiceCase>();
const verifierCase = new Map<string, InvoiceCase>();
const auditAnswered = new Set<InvoiceCase>();
const extractors: { agent: Agent; c: InvoiceCase }[] = [];

for (const c of state.cases) {
  const extractor = createAgent({
    name: `Extractor ${c.doc.id}`,
    capabilities: ['inference'],
    instruction: EXTRACTOR_INSTRUCTION,
    tools: [],
    handlers: [],
  });

  let audited = false;
  const auditor = createAgent({
    name: `Auditor ${c.doc.id}`,
    capabilities: ['inference'],
    instruction: AUDITOR_INSTRUCTION,
    tools: [],
    handlers: [
      {
        specification: new WhenAnswerFrom(extractor.getId()),
        processor: {
          apply({ event }) {
            if (audited) return;
            audited = true;
            settle(c, event.producerId);

            const answer = answerText(event.payload);
            const parsed = parseExtraction(answer);
            if (!parsed.ok) {
              c.errors.push(`extractor answer rejected: ${parsed.error}. Answer started with: ${preview(answer)}`);
              c.done = true;
              finishIfDone();
              return;
            }

            c.extraction = parsed.value;
            c.checks = caseChecks(c.doc, parsed.value, vendors);
            run(
              auditor,
              c,
              auditorMessage(c.doc.file, c.doc.text, c.extraction, c.checks),
              AUDIT_OUTPUT
            );
          },
        },
      },
    ],
  });

  let verifying = false;
  const verifier = createAgent({
    name: `Verifier ${c.doc.id}`,
    capabilities: ['inference'],
    instruction: VERIFIER_INSTRUCTION,
    tools: [],
    handlers: [
      {
        specification: new WhenAnswerFrom(auditor.getId()),
        processor: {
          apply({ event }) {
            const vendor = needsVerification(c, vendors);
            if (verifying || !vendor) return;
            verifying = true;

            const audit = parseAudit(answerText(event.payload));
            const findings = {
              failedChecks: c.checks.filter((check) => !check.ok),
              auditorIssues: audit.ok ? audit.value.issues : [],
            };
            const { name, iban, contactEmail, phone } = vendor;
            run(
              verifier,
              c,
              verifierMessage(c.doc.file, c.doc.text, { name, iban, contactEmail, phone }, findings),
              VERIFY_OUTPUT
            );
          },
        },
      },
    ],
  });

  names.set(extractor.getId(), `Extractor ${c.doc.id}`);
  names.set(auditor.getId(), `Auditor ${c.doc.id}`);
  names.set(verifier.getId(), `Verifier ${c.doc.id}`);
  auditorCase.set(auditor.getId(), c);
  verifierCase.set(verifier.getId(), c);
  extractors.push({ agent: extractor, c });
  join(extractor);
  join(auditor);
  join(verifier);
}

function recordVerification(c: InvoiceCase, answer: string): void {
  const vendor = findVendor(c.extraction!.vendorName.value, vendors)!;
  const parsed = parseVerification(answer);
  if (!parsed.ok) {
    c.verificationError = `verifier answer rejected: ${parsed.error}. Answer started with: ${preview(answer)}`;
    return;
  }
  // Every figure in the draft must come from the document, the vendor master,
  // or the extraction; otherwise the draft is withheld.
  const allowed = [c.doc.text, JSON.stringify(vendor), JSON.stringify(c.extraction)].join('\n');
  const unsourced = unsourcedFigures(`${parsed.value.subject}\n${parsed.value.body}`, allowed);
  if (unsourced.length > 0) {
    c.verificationError = `verification draft withheld: unsourced figures ${unsourced.join(', ')}`;
    return;
  }
  c.verification = { ...parsed.value, to: vendor.contactEmail, phone: vendor.phone };
}

// Logs every answer and records the auditor verdicts.
const monitor = createHuman({
  name: 'Monitoring',
  capabilities: [],
  handlers: [
    {
      specification: new WhenAnyAnswer(),
      processor: {
        apply({ event }) {
          console.log(`[${names.get(event.producerId) ?? event.producerId}] answered`);

          const verified = verifierCase.get(event.producerId);
          if (verified && !verified.done) {
            settle(verified, event.producerId);
            recordVerification(verified, answerText(event.payload));
            verified.done = true;
            return finishIfDone();
          }

          const c = auditorCase.get(event.producerId);
          if (!c || c.done || auditAnswered.has(c)) return;
          auditAnswered.add(c);
          settle(c, event.producerId);

          const answer = answerText(event.payload);
          const parsed = parseAudit(answer);
          if (parsed.ok) c.audit = parsed.value;
          else c.errors.push(`auditor answer rejected: ${parsed.error}. Answer started with: ${preview(answer)}`);
          // Wait for the Verifier if bank details need confirming.
          if (!needsVerification(c, vendors)) {
            c.done = true;
            finishIfDone();
          }
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

let finished = false;

// Deferred so the other handlers for the same event (e.g. monitor logging)
// run before the process exits.
function finishIfDone(): void {
  if (!finished && state.cases.every((c) => c.done)) setImmediate(() => finish(0));
}

function finish(exitCode: number): void {
  if (finished) return;
  finished = true;

  addDuplicateChecks(state.cases);

  const decisions = new Map<string, Decision>(
    state.cases.map((c) => [c.doc.id, decide(c, config.approvalLimitEur, approved)])
  );
  const payments: Payment[] = state.cases
    .filter((c) => ['ready', 'approved'].includes(decisions.get(c.doc.id)!))
    .map((c) => {
      const e = c.extraction!;
      return {
        endToEndId: `${c.doc.id}-${e.invoiceNumber.value}`.slice(0, 35),
        amount: e.totalAmount.value,
        creditorName: findVendor(e.vendorName.value, vendors)?.name ?? e.vendorName.value,
        creditorIban: e.iban.value,
        creditorBic: e.bic?.value ?? null,
        remittance: e.invoiceNumber.value,
      };
    });

  mkdirSync(OUT_DIR, { recursive: true });

  let draftFile: string | null = null;
  if (payments.length > 0) {
    const now = new Date();
    draftFile = `${OUT_DIR}/sepa-draft.xml`;
    writeFileSync(
      draftFile,
      buildPain001({
        messageId: `STOCKMIND-${now.getTime()}`,
        createdAt: now,
        executionDate: now.toISOString().slice(0, 10),
        debtor,
        payments,
      })
    );
  }

  const reportFile = `${OUT_DIR}/review.md`;
  const usage = `models: ${config.models.slice(0, modelIndex + 1).join(' → ')}; tokens: ${tokens.input} in / ${tokens.output} out`;
  writeFileSync(
    reportFile,
    buildReport(state.cases, decisions, { approvalLimit: config.approvalLimitEur, draftFile, usage, vendors })
  );

  console.log('');
  for (const c of state.cases) {
    const verification = c.verification ? ` (verification request drafted to ${c.verification.to})` : '';
    console.log(`${c.doc.id}: ${decisions.get(c.doc.id)}${verification}`);
  }
  const waiting = state.cases.filter((c) => decisions.get(c.doc.id) === 'needs_approval');
  if (waiting.length) {
    console.log(`\nTo approve as a human, re-run with: --approve ${waiting.map((c) => c.doc.id).join(',')}  (e.g. npm run dev -- --approve ${waiting[0]!.doc.id})`);
  }
  console.log(`\nReport: ${reportFile}`);
  console.log(`Usage: ${usage}`);
  if (draftFile) console.log(`SEPA draft: ${draftFile} (${payments.length} payments)`);
  console.log(`\n${DISCLAIMER}`);

  process.exit(exitCode);
}

// Stop early but still write the report: unfinished cases get the reason.
function abort(reason: string): void {
  if (finished) return;
  for (const c of state.cases) {
    if (!c.done) c.errors.push(reason);
  }
  console.error(`\n[error] ${reason}; writing partial report.`);
  finish(1);
}

// Provider errors (e.g. Gemini 429 quota, 503 overload) are raised inside
// Mozaik's fire-and-forget loop, so they surface here, not in run().
// Gemini 429 bodies say which quota was hit and when to retry, e.g.
// quotaId "GenerateRequestsPerDayPerProjectPerModel-FreeTier", retryDelay "35s".
function rateLimitInfo(error: unknown): { perDay: boolean; retryAfterMs: number | undefined } {
  const message = (error as { message?: string } | null)?.message ?? '';
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
  return {
    perDay: /PerDay/i.test(message),
    retryAfterMs: delay ? Math.ceil(Number(delay[1]) * 1000) : undefined,
  };
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

// Error without HTTP status / 400 while structured output is on: retry once
// without it. 429 per-minute limit: wait retryDelay, same model. 429 daily
// quota: won't recover today, so fall back at once. 503 (overloaded) / 500:
// retry the same model with backoff, then fall back.
// Mozaik doesn't tell us which loop failed, so every pending loop is re-run;
// the run-once guards in the handlers ignore duplicate answers.
const RETRYABLE = new Set([429, 500, 503]);
const MAX_SAME_MODEL_RETRIES = 2;
const MAX_RATE_LIMIT_RETRIES = 4;

// A 429 we can wait out: not a daily quota, and retry within two minutes.
function isShortRateLimit(error: unknown): boolean {
  const { perDay, retryAfterMs } = rateLimitInfo(error);
  return !perDay && (retryAfterMs === undefined || retryAfterMs <= 120_000);
}
let sameModelRetries = 0;
let retryScheduled = false;

function handleModelError(error: unknown): void {
  if (finished) return fail('unexpected error', error);
  // Several parallel loops usually fail together; handle them as one.
  if (retryScheduled) return;

  const status = (error as { status?: number } | null)?.status;
  if (pendingLoops.size === 0) return abort(describeError(error));

  let delayMs: number;
  let action: string;
  if ((status === undefined || status === 400) && useStructuredOutput) {
    // Most likely the structured output schema was rejected; retry without it.
    useStructuredOutput = false;
    delayMs = 500;
    action = 'without structured output';
  } else if (status === undefined || !RETRYABLE.has(status)) {
    return abort(describeError(error));
  } else if (status === 429 && isShortRateLimit(error) && sameModelRetries < MAX_RATE_LIMIT_RETRIES) {
    // Per-minute limit: wait for the window to reopen and stay on this model.
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
  console.error(
    `[retry] ${describeError(error)}\n[retry] re-running ${pendingLoops.size} pending agent(s) ${action} in ${delayMs / 1000}s`
  );
  setTimeout(() => {
    retryScheduled = false;
    callQueue.length = 0; // queued calls are pending too and get re-run below
    for (const [c, loop] of [...pendingLoops]) run(loop.agent, c, loop.message, loop.output);
  }, delayMs);
}

process.on('unhandledRejection', handleModelError);
process.on('uncaughtException', handleModelError);

setTimeout(
  () => abort(`no answer within ${config.timeoutMs} ms`),
  config.timeoutMs
);

console.log(`StockMind AI — invoice to SEPA payment draft (models: ${config.models.join(' → ')})`);
console.log(`${invoices.length} documents, ${invoices.length * 3} agents, approval limit EUR ${config.approvalLimitEur}, max ${config.requestsPerMinute} model calls/min`);
if (approved.size) console.log(`Human approval given for: ${[...approved].join(', ')}`);
console.log('');

// All extractors start at once and run in parallel.
for (const { agent, c } of extractors) {
  run(agent, c, extractorMessage(c.doc.file, c.doc.text), EXTRACTION_OUTPUT);
}
