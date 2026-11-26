import 'dotenv/config';

import { mkdirSync, writeFileSync } from 'node:fs';

import {
  defineRuntime,
  RuntimeState,
  createAgent,
  createHuman,
  type Agent,
} from '@mozaik-ai/core';

import { loadConfig, type Config } from './config.js';
import { invoices } from './data/invoices.js';
import { debtor, vendors } from './data/vendors.js';
import { WhenAnswerFrom, WhenAnyAnswer, answerText } from './events.js';
import { parseAudit, parseExtraction } from './parsing.js';
import {
  addDuplicateChecks,
  caseChecks,
  decide,
  findVendor,
  type InvoiceCase,
} from './checks.js';
import { buildPain001, type Payment } from './sepa.js';
import { buildReport, DISCLAIMER } from './report.js';
import {
  EXTRACTOR_INSTRUCTION,
  AUDITOR_INSTRUCTION,
  extractorMessage,
  auditorMessage,
} from './prompts.js';

const OUT_DIR = 'out';

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

// runLoop is fire-and-forget; wrap it so both sync throws and rejected
// promises end up in the case instead of crashing the run.
function run(agent: Agent, c: InvoiceCase, message: string): void {
  Promise.resolve()
    .then(() =>
      runLoop(agent.getId(), message, {
        model: config.model,
        context: agent.getMemory().getContext(),
        tools: agent.getTools(),
      })
    )
    .catch((error: unknown) => {
      c.errors.push(`model call failed: ${String(error)}`);
      c.done = true;
      finishIfDone();
    });
}

// Per document: an Extractor, then an Auditor that checks the Extractor.
// Each Auditor only reacts to its own Extractor, so agents can't loop.
const names = new Map<string, string>();
const auditorCase = new Map<string, InvoiceCase>();
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
              auditorMessage(c.doc.file, c.doc.text, c.extraction, c.checks)
            );
          },
        },
      },
    ],
  });

  names.set(extractor.getId(), `Extractor ${c.doc.id}`);
  names.set(auditor.getId(), `Auditor ${c.doc.id}`);
  auditorCase.set(auditor.getId(), c);
  extractors.push({ agent: extractor, c });
  join(extractor);
  join(auditor);
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

          const c = auditorCase.get(event.producerId);
          if (!c || c.done) return;

          const answer = answerText(event.payload);
          const parsed = parseAudit(answer);
          if (parsed.ok) c.audit = parsed.value;
          else c.errors.push(`auditor answer rejected: ${parsed.error}. Answer started with: ${preview(answer)}`);
          c.done = true;
          finishIfDone();
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

  const payments: Payment[] = state.cases
    .filter((c) => decide(c, config.approvalLimitEur) === 'ready')
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
  writeFileSync(reportFile, buildReport(state.cases, config.approvalLimitEur, draftFile));

  console.log('');
  for (const c of state.cases) {
    console.log(`${c.doc.id}: ${decide(c, config.approvalLimitEur)}`);
  }
  console.log(`\nReport: ${reportFile}`);
  if (draftFile) console.log(`SEPA draft: ${draftFile} (${payments.length} payments)`);
  console.log(`\n${DISCLAIMER}`);

  process.exit(exitCode);
}

setTimeout(() => {
  for (const c of state.cases) {
    if (!c.done) c.errors.push(`no answer within ${config.timeoutMs} ms`);
  }
  console.error(`\n[error] Run timed out after ${config.timeoutMs} ms; writing partial report.`);
  finish(1);
}, config.timeoutMs);

console.log(`StockMind AI — invoice to SEPA payment draft (model ${config.model})`);
console.log(`${invoices.length} documents, ${invoices.length * 2} agents, approval limit EUR ${config.approvalLimitEur}\n`);

// All extractors start at once and run in parallel.
for (const { agent, c } of extractors) {
  run(agent, c, extractorMessage(c.doc.file, c.doc.text));
}
