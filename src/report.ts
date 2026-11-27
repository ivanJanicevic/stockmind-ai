// out/review.md for the café finance desk: payment run, every hold with its
// evidence and amount at stake, business findings with their source rows, the
// reviewer's priorities, and a timeline proving the agents ran concurrently.

import type { ApCase, Decision, MissingDocument } from './ap.js';
import type { Finding, Rejected, Review } from './findings.js';

export const DISCLAIMER =
  'Decision support on synthetic data. Not financial advice. No payment or e-mail has been sent.';

const LABEL: Record<Decision, string> = {
  ready: '✅ Ready — in payment draft',
  approved: '👤 Approved by human — in payment draft',
  needs_approval: '⏸ Needs human approval (above agent limit)',
  held: '⛔ Held',
};

export const rsd = (n: number) => `${n.toLocaleString('sr-RS', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RSD`;
const cell = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|');
const src = (sources: string[]) => (sources.length ? ` _(${sources.map((s) => `\`${s}\``).join(', ')})_` : '');

export interface AnalystResult {
  key: string;
  title: string;
  agent: string;
  rows: { id: string; sources: string[] }[];
  flaggedIds: string[];
  accepted: Finding[];
  rejected: Rejected[];
  error?: string;
  done: boolean;
}

export interface TimelineEntry {
  agent: string;
  role: string;
  queuedAt?: number; // ms since run start
  startedAt?: number;
  answeredAt?: number;
  status: string;
}

export interface ReportInput {
  cases: ApCase[];
  decisions: ReadonlyMap<string, Decision>;
  limitRsd: number;
  approvalsGiven: string[];
  missing: MissingDocument[];
  analyses: AnalystResult[];
  review?: { review: Review; rejected: Rejected[] };
  reviewNote?: string;
  timeline: TimelineEntry[];
  run: { models: string; tokens: string; calls: number; durationS: number; network: string };
  paymentFile: string | null;
  paymentTotal: number;
}

const invoiceNo = (c: ApCase) => c.invoice?.invoiceNumber.value ?? c.invoiceFile;

export function buildReport(r: ReportInput): string {
  const out: string[] = [
    '# Café finance desk — Kafe „Plava Šolja“',
    '',
    `> ${DISCLAIMER}`,
    '',
    `Run: ${r.run.calls} model calls in ${r.run.durationS.toFixed(1)} s · ${r.run.models} · tokens ${r.run.tokens} · Mozaik Network: ${r.run.network}`,
    '',
    '## 1. Payment run',
    '',
    `Agent approval limit: ${rsd(r.limitRsd)}. Human approvals given: ${r.approvalsGiven.length ? r.approvalsGiven.join(', ') : 'none'}. Payment draft: ${r.paymentFile ? `\`${r.paymentFile}\` (${rsd(r.paymentTotal)})` : 'none'}.`,
    '',
    '| Invoice | Supplier | Amount | Decision | Why |',
    '| --- | --- | ---: | --- | --- |',
  ];

  for (const c of r.cases) {
    const decision = r.decisions.get(c.id) ?? 'held';
    const failed = c.checks.filter((x) => !x.ok && x.blocking);
    const why = c.errors.length ? 'agent error' : failed.length ? failed.map((x) => x.detail).join('; ') : decision === 'needs_approval' ? 'clean, above limit' : 'all checks passed';
    out.push(
      `| ${invoiceNo(c)} | ${cell(c.invoice?.supplierName.value ?? '?')} | ${c.invoice ? rsd(c.invoice.totalAmount.value) : '?'} | ${LABEL[decision]} | ${cell(why)} |`
    );
  }
  const atStake = r.cases.flatMap((c) => c.checks.filter((x) => !x.ok && x.blocking)).reduce((s, x) => s + x.impactRsd, 0);
  out.push('', `Amount at stake on held invoices: **${rsd(atStake)}** (incl. VAT).`);

  if (r.missing.length) {
    out.push('', '**In the purchase register but no invoice document to check — not paid:**', '');
    for (const m of r.missing) out.push(`- ${m.invoiceNo} · ${m.supplier} · ${m.date} · ${rsd(m.totalInclVat)}${src(m.sources)}`);
  }

  out.push('', '## 2. Invoice checks (invoice ↔ delivery note ↔ agreed prices)');
  for (const c of r.cases) {
    out.push('', `### ${invoiceNo(c)} — ${LABEL[r.decisions.get(c.id) ?? 'held']}`, '', `Documents: \`data/fakture/${c.invoiceFile.replace('.txt', '.pdf')}\`, \`data/otpremnice/${c.noteFile.replace('.txt', '.pdf')}\``, '');
    for (const e of c.errors) out.push(`- ❌ agent: ${e}`);
    const failed = c.checks.filter((x) => !x.ok);
    for (const x of failed) {
      out.push(`- ${x.blocking ? '❌' : '⚠️'} **${x.name}**: ${x.detail}${x.impactRsd ? ` — at stake ${rsd(x.impactRsd)}` : ''}${src(x.sources)}`);
    }
    if (c.checks.some((x) => !x.ok && x.name.endsWith('_sources'))) {
      out.push('- 🔎 The clerk agents\' reading could not be verified against the document, so no claim was sent to the supplier — re-check this invoice by hand.');
    }
    const passed = c.checks.filter((x) => x.ok).length;
    if (c.checks.length) out.push(`- ✅ ${passed} other checks passed (sources, supplier, bank account, note reference, prices, quantities, totals)`);
    if (c.claim) {
      out.push('', `**Claim draft (not sent)** — to ${c.claim.to}`, '', `Subject: ${c.claim.subject}`, '', ...c.claim.body.split('\n').map((l) => `> ${l}`));
    } else if (c.claimError) {
      out.push(`- ❌ claims writer: ${c.claimError}`);
    }
  }

  out.push('', '## 3. Business findings', '', 'Every number below is computed by code from `data/`; analysts only interpret the rows, and any finding citing a figure not in its row is rejected.');
  for (const a of r.analyses) {
    out.push('', `### ${a.title} — ${a.agent}`, '');
    if (a.error) out.push(`- ❌ ${a.error} — the computed rows below are still valid.`);
    for (const f of a.accepted) {
      const row = a.rows.find((x) => x.id === f.id);
      out.push(`- **[${f.severity}] ${f.headline}** (${f.id}) — ${f.explanation} → _${f.action}_${src(row?.sources.slice(0, 4) ?? [])}`);
    }
    if (!a.accepted.length && !a.error) out.push('- (no findings accepted)');
    const missed = a.flaggedIds.filter((id) => !a.accepted.some((f) => f.id === id));
    if (missed.length) out.push(`- ℹ️ flagged by code but not discussed: ${missed.join(', ')}`);
    for (const x of a.rejected) out.push(`- 🚫 rejected: ${cell(x.item)} — ${x.reason}`);
  }

  out.push('', '## 4. Reviewer — priorities this week', '');
  if (r.review) {
    if (r.review.review.summary) out.push(r.review.review.summary, '');
    r.review.review.actions.forEach((a, i) => out.push(`${i + 1}. **${a.action}** — ${a.why} _(${a.itemIds.join(', ')})_`));
    for (const x of r.review.rejected) out.push(`- 🚫 rejected: ${cell(x.item)} — ${x.reason}`);
  } else {
    out.push(`- ${r.reviewNote ?? 'reviewer did not run'}`);
  }

  out.push('', '## 5. Agent timeline', '', 'Seconds since start. Overlapping intervals are agents working at the same time.', '', '| Agent | Role | Started | Answered | Status |', '| --- | --- | ---: | ---: | --- |');
  for (const t of [...r.timeline].sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity))) {
    const s = (ms?: number) => (ms === undefined ? '–' : (ms / 1000).toFixed(1));
    out.push(`| ${t.agent} | ${t.role} | ${s(t.startedAt)} | ${s(t.answeredAt)} | ${t.status} |`);
  }

  out.push('', `> ${DISCLAIMER}`, '');
  return out.join('\n');
}
