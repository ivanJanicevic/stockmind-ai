// The StockMind app: one Node process that hosts the Mozaik runtime, the agents and a small web page.
// Agents run in this process, so their loops show up live on the page's timeline.
//
//   npm run app          then open http://localhost:3000
//
// Buttons that run agents call Gemini. Synthetic data only; nothing here is financial advice.

import 'dotenv/config';

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.js';
import {
  createReceipt,
  documentById,
  documentItems,
  findDocument,
  findDocumentByFile,
  receiptForInvoice,
} from '../db/documents.js';
import { findingById, type AuditStatus, type FindingRow } from '../db/findings.js';
import { receivedLots, unconfirmedDeliveryNotes } from '../db/stock.js';
import { extractPdfLines } from '../domain/pdf.js';
import { checkStock, EXPIRY_ALARM_DAYS } from '../domain/stock.js';
import { limitModelCalls } from '../model-rate-limit.js';
import { activitySince, onActivity, recordActivity } from '../agents/activity.js';
import { createFindingAuditor } from '../agents/auditor/checks.js';
import { receiptMessage } from '../agents/document/messages.js';
import { listDocuments } from '../agents/document/process-document.js';
import {
  latestSaleDate,
  loadContext,
  postInNetwork,
  readDocuments,
  runAudit,
  runFlow,
  runProcurement,
  runSales,
  runStock,
} from '../agents/flows.js';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url));
const OWNER = 'Vlasnik (aplikacija)';

const config = loadConfig(process.env);
limitModelCalls(config.requestsPerMinute);
const ctx = loadContext(config.models[0]!);
const defaultDate = latestSaleDate(ctx);

// ---------------------------------------------------------------- jobs

interface Job {
  id: number;
  kind: string;
  label: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
}

const jobs: Job[] = [];
let running: Job | undefined;

/** Starts one agent job. Only one runs at a time: they share the model's rate limit and the findings. */
function startJob(kind: string, label: string, work: () => Promise<unknown>): Job {
  if (running) throw new HttpError(409, `Već radi: ${running.label}. Sačekaj da se završi.`);
  const job: Job = { id: jobs.length + 1, kind, label, status: 'running', startedAt: new Date().toISOString() };
  jobs.push(job);
  running = job;
  recordActivity({ type: 'note', agent: 'Aplikacija', loopId: `job-${job.id}`, detail: `pokrenuto: ${label}` });
  work().then(
    (result) => finishJob(job, { result }),
    (error) => finishJob(job, { error: error instanceof Error ? error.message : String(error) }),
  );
  return job;
}

function finishJob(job: Job, outcome: { result?: unknown; error?: string }): void {
  if (job.status !== 'running') return;
  job.status = outcome.error === undefined ? 'done' : 'failed';
  job.finishedAt = new Date().toISOString();
  if (outcome.error !== undefined) job.error = outcome.error;
  else job.result = outcome.result;
  if (running === job) running = undefined;
  recordActivity({
    type: 'note',
    agent: 'Aplikacija',
    loopId: `job-${job.id}`,
    detail: job.status === 'done' ? `završeno: ${job.label}` : `greška: ${job.label}: ${job.error}`,
  });
}

// An agent loop's error is not routed back to its caller (Mozaik runLoop returns void): it ends up
// here. The running job is marked failed, so the app does not wait for it forever.
process.on('unhandledRejection', (error) => {
  const status = (error as { status?: number } | null)?.status;
  const text = `${status === undefined ? '' : `HTTP ${status}: `}${error instanceof Error ? error.message : String(error)}`;
  console.error('[error]', text);
  recordActivity({ type: 'loop.failed', agent: 'Model', loopId: 'error', detail: text });
  if (running) finishJob(running, { error: text });
});

// ---------------------------------------------------------------- helpers

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Telo zahteva nije ispravan JSON.');
  }
}

function dateParam(value: unknown): string {
  if (value === undefined || value === null || value === '') return defaultDate;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `Datum "${String(value)}" nije oblika 2026-12-25.`);
  return value;
}

const pdfCache = new Map<string, Promise<string[]>>();
function pdfLines(file: string): Promise<string[]> {
  let lines = pdfCache.get(file);
  if (!lines) {
    lines = extractPdfLines(new Uint8Array(readFileSync(path.join(ctx.dataDir, file))));
    pdfCache.set(file, lines);
  }
  return lines;
}

/** The text a source reference points at, with a few lines around it. */
async function readSource(ref: string): Promise<{ ref: string; file: string; line: number; lines: { n: number; text: string }[] }> {
  const match = /^([\w./-]+\.(pdf|csv)):(\d+)$/.exec(ref);
  if (!match || match[1]!.includes('..')) throw new HttpError(400, `"${ref}" nije referenca oblika fajl.pdf:red ili fajl.csv:red.`);
  const file = match[1]!;
  const line = Number(match[3]);
  let all: string[];
  try {
    all =
      match[2] === 'pdf'
        ? await pdfLines(file)
        : readFileSync(path.resolve(ctx.dataDir, '..', file), 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  } catch {
    throw new HttpError(404, `Fajl ${file} ne postoji.`);
  }
  if (line < 1 || line > all.length) throw new HttpError(404, `${file} nema red ${line}.`);
  const from = Math.max(1, line - 3);
  const to = Math.min(all.length, line + 3);
  const around = [];
  for (let n = from; n <= to; n++) around.push({ n, text: all[n - 1] ?? '' });
  // The header of a CSV says what each column is.
  if (match[2] === 'csv' && from > 1) around.unshift({ n: 1, text: all[0] ?? '' });
  return { ref, file, line, lines: around };
}

// ---------------------------------------------------------------- API

async function documentsOverview() {
  const files = await listDocuments();
  return files.map(({ file, kind }) => {
    const vrsta = kind === 'invoice' ? 'ULAZNA_FAKTURA' : 'OTPREMNICA';
    const row = findDocumentByFile(ctx.db, vrsta, file);
    const receipt = row
      ? kind === 'invoice'
        ? receiptForInvoice(ctx.db, row)
        : findDocument(ctx.db, 'PRIJEMNICA', `PRIJ-${row.broj}`)
      : undefined;
    return {
      file,
      kind,
      id: row?.id ?? null,
      number: row?.broj ?? null,
      date: row?.datum_dokumenta ?? null,
      supplier: row?.dobavljac ?? null,
      status: row?.status ?? 'NIJE_PROCITAN',
      linkedNumber: row?.veza_broj ?? null,
      receipt: receipt ? { id: receipt.id, number: receipt.broj, confirmedBy: receipt.potvrdio } : null,
    };
  });
}

function findings(status: string | null, agent: string | null): FindingRow[] {
  const where: string[] = [];
  const args: string[] = [];
  if (status) {
    where.push('audit_status = ?');
    args.push(status);
  }
  if (agent) {
    where.push('agent = ?');
    args.push(agent);
  }
  return ctx.db
    .prepare(`SELECT * FROM nalaz ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`)
    .all(...args) as unknown as FindingRow[];
}

function summary() {
  const counts = ctx.db
    .prepare('SELECT agent, audit_status AS status, COUNT(*) AS n FROM nalaz GROUP BY agent, audit_status')
    .all() as { agent: string; status: AuditStatus; n: number }[];
  return {
    defaultDate,
    expiryAlarmDays: EXPIRY_ALARM_DAYS,
    model: ctx.model,
    network: Boolean(process.env.MOZAIK_INVITE?.trim()),
    running: running ?? null,
    findings: counts,
    unconfirmedDeliveryNotes: unconfirmedDeliveryNotes(ctx.db),
  };
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const p = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'GET' && (p === '/' || p === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(path.join(PUBLIC_DIR, 'index.html')));
    return;
  }

  if (method === 'GET' && p === '/api/summary') return send(res, 200, summary());

  // Live timeline: Server-Sent Events, replaying what happened after ?after=<seq>.
  if (method === 'GET' && p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    for (const event of activitySince(Number(url.searchParams.get('after') ?? 0))) write(event);
    const stop = onActivity(write);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      stop();
      clearInterval(ping);
    });
    return;
  }
  if (method === 'GET' && p === '/api/activity') return send(res, 200, activitySince(Number(url.searchParams.get('after') ?? 0)));
  if (method === 'GET' && p === '/api/jobs') return send(res, 200, [...jobs].reverse());

  // Documents and receiving.
  if (method === 'GET' && p === '/api/documents') return send(res, 200, await documentsOverview());
  const documentMatch = /^\/api\/documents\/(\d+)$/.exec(p);
  if (method === 'GET' && documentMatch) {
    const document = documentById(ctx.db, Number(documentMatch[1]));
    if (!document) throw new HttpError(404, 'Dokument ne postoji.');
    return send(res, 200, { ...document, items: documentItems(ctx.db, document.id) });
  }
  if (method === 'POST' && p === '/api/documents/read') {
    const body = await readBody(req);
    const files = Array.isArray(body.files) ? body.files.filter((f): f is string => typeof f === 'string') : undefined;
    return send(res, 202, startJob('read', files?.length ? `čitanje: ${files.join(', ')}` : 'čitanje svih dokumenata', () => readDocuments(ctx, files)));
  }
  if (method === 'POST' && p === '/api/delivery-notes/confirm') {
    const body = await readBody(req);
    if (typeof body.number !== 'string') throw new HttpError(400, 'Nedostaje broj otpremnice (number).');
    const corrections = new Map<string, number>();
    for (const [code, value] of Object.entries((body.corrections ?? {}) as Record<string, unknown>)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new HttpError(400, `Količina za ${code} nije ispravan broj.`);
      corrections.set(code, value);
    }
    const result = createReceipt(ctx.db, { deliveryNote: body.number, corrections }, OWNER);
    if (!result.ok) throw new HttpError(409, result.error);
    void postInNetwork('Vlasnik', receiptMessage(result, OWNER));
    recordActivity({ type: 'note', agent: OWNER, loopId: 'owner', detail: `potvrdio ${result.deliveryNote} -> ${result.receiptNumber}` });
    return send(res, 201, result);
  }

  // Agents.
  if (method === 'POST' && p === '/api/flow') {
    const asOf = dateParam((await readBody(req)).asOf);
    return send(res, 202, startJob('flow', `ceo tok na dan ${asOf}`, () => runFlow(ctx, asOf)));
  }
  if (method === 'POST' && p === '/api/agents/procurement') {
    const invoice = (await readBody(req)).invoice;
    if (typeof invoice !== 'string') throw new HttpError(400, 'Nedostaje broj fakture (invoice).');
    return send(res, 202, startJob('procurement', `Nabavka: ${invoice}`, () => runProcurement(ctx, invoice)));
  }
  if (method === 'POST' && p === '/api/agents/stock') {
    const asOf = dateParam((await readBody(req)).asOf);
    return send(res, 202, startJob('stock', `Zalihe na dan ${asOf}`, () => runStock(ctx, asOf)));
  }
  if (method === 'POST' && p === '/api/agents/sales') {
    const asOf = dateParam((await readBody(req)).asOf);
    return send(res, 202, startJob('sales', `Prodaja na dan ${asOf}`, () => runSales(ctx, asOf)));
  }
  if (method === 'POST' && p === '/api/agents/audit') {
    return send(res, 202, startJob('audit', 'Auditor', () => runAudit(ctx)));
  }

  // Findings and their sources.
  if (method === 'GET' && p === '/api/findings') {
    return send(res, 200, findings(url.searchParams.get('status'), url.searchParams.get('agent')));
  }
  const findingMatch = /^\/api\/findings\/(\d+)$/.exec(p);
  if (method === 'GET' && findingMatch) {
    const finding = findingById(ctx.db, Number(findingMatch[1]));
    if (!finding) throw new HttpError(404, 'Nalaz ne postoji.');
    // The Auditor's checks, run again in code (no model call), so the page shows them as they stand now.
    const audit = await createFindingAuditor(ctx).audit(finding);
    return send(res, 200, { ...finding, checks: audit.checks, passed: audit.passed });
  }
  if (method === 'GET' && p === '/api/sources') return send(res, 200, await readSource(url.searchParams.get('ref') ?? ''));

  // Stock.
  if (method === 'GET' && p === '/api/stock/overview') {
    const asOf = dateParam(url.searchParams.get('asOf'));
    const check = checkStock(receivedLots(ctx.db), ctx.sales, ctx.recipes, asOf);
    return send(res, 200, {
      asOf,
      alarmDays: EXPIRY_ALARM_DAYS,
      lots: check.overview,
      soldWithoutReceipt: check.soldWithoutReceipt,
      unconfirmedDeliveryNotes: unconfirmedDeliveryNotes(ctx.db),
    });
  }

  throw new HttpError(404, `Nema ${method} ${p}.`);
}

createServer((req, res) => {
  route(req, res).catch((error: unknown) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    if (!res.headersSent) send(res, status, { error: error instanceof Error ? error.message : String(error) });
    else res.end();
  });
}).listen(PORT, () => {
  console.log(`StockMind app: http://localhost:${PORT}  (model ${ctx.model}, network ${process.env.MOZAIK_INVITE ? 'on' : 'off'})`);
});
