// out/review.md for the café finance desk: payment run, every hold with its
// evidence and amount at stake, business findings with their source rows, the
// reviewer's priorities, and a timeline proving the agents ran concurrently.

import type { ApCase, Decision, MissingDocument } from './ap.js';
import type { Finding, Rejected, Review } from './findings.js';
import type { ComparisonRow, LotRow, PlanningParams, ProfitRow, PromotionRow, RecommendationLine, ReplenishmentRow } from './planning.js';
import { PLANNING_RULES } from './planning.js';

export interface PlanningSection {
  asOf: string;
  profit: ProfitRow[];
  comparison: ComparisonRow[];
  monthly: { comparable: boolean; reason: string };
  lots: LotRow[];
  promotions: PromotionRow[];
  replenishment: ReplenishmentRow[];
  recommendations: RecommendationLine[];
  excludedNotes: string[];
  unusedItems: string[];
  params: PlanningParams | null;
}

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
  planning?: PlanningSection;
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

  if (r.planning) out.push(...planningSection(r.planning));

  out.push('', '## 7. Agent timeline', '', 'Seconds since start. Overlapping intervals are agents working at the same time.', '', '| Agent | Role | Started | Answered | Status |', '| --- | --- | ---: | ---: | --- |');
  for (const t of [...r.timeline].sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity))) {
    const s = (ms?: number) => (ms === undefined ? '–' : (ms / 1000).toFixed(1));
    out.push(`| ${t.agent} | ${t.role} | ${s(t.startedAt)} | ${s(t.answeredAt)} | ${t.status} |`);
  }

  out.push('', `> ${DISCLAIMER}`, '');
  return out.join('\n');
}

const num = (n: number | null, digits = 2) =>
  n === null ? '–' : n.toLocaleString('sr-RS', { minimumFractionDigits: 0, maximumFractionDigits: digits });

// Section 6: facts (computed from data), forecasts (projections from recent
// demand) and recommendations (proposed actions), each with sources and limits.
function planningSection(p: PlanningSection): string[] {
  const out: string[] = [
    '',
    '## 6. Sales, profit and inventory planning',
    '',
    `As of ${p.asOf}, the last day in the POS export. **[FACT]** = computed from the data · **[FORECAST]** = projection from the last ${PLANNING_RULES.demandWindowDays} days' demand · **[RECOMMENDATION]** = proposed action. Full rows: \`out/recommendations.csv\`, \`out/sales-by-product.csv\` (daily, weekly, monthly).`,
    '',
    '### [FACT] Profit by product — total vs per unit',
    '',
    'Net revenue excludes VAT; cost of goods is recipe cost at the purchase price in force on each sale date.',
    '',
    '| Rank | Product | Units | Net revenue | Cost of goods | **Total gross profit** | Margin | Profit per unit (avg) | Profit per unit (now) |',
    '| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  const show = [...p.profit.slice(0, 10), ...p.profit.slice(-3)];
  for (const x of show) {
    out.push(`| ${x.rank} | ${x.name} | ${num(x.units)} | ${rsd(x.netRevenue)} | ${rsd(x.costOfGoods)} | **${rsd(x.grossProfit)}** | ${num(x.marginPct)} % | ${rsd(x.avgProfitPerUnit)} | ${rsd(x.currentProfitPerUnit)} |`);
    if (x.rank === 10 && p.profit.length > 13) out.push('| … | | | | | | | | |');
  }
  const missingCost = p.profit.filter((x) => x.costMissing.length);
  if (missingCost.length) out.push('', `⚠️ Cost incomplete for: ${missingCost.map((x) => `${x.name} (${x.costMissing.join(', ')})`).join('; ')}.`);

  const moving = p.comparison.filter((c) => c.flag === 'rising' || c.flag === 'falling');
  out.push('', `### [FACT] Equivalent-period comparison — ${p.comparison[0]?.basis ?? 'not enough full weeks'}`, '');
  out.push(`Flagged when the change is at least ±${PLANNING_RULES.trendChangePct} % and the earlier week had at least ${PLANNING_RULES.trendMinUnits} units.`, '');
  for (const c of moving) out.push(`- ${c.flag === 'rising' ? '📈' : '📉'} ${c.name}: ${num(c.previous)} → ${num(c.latest)} units (${c.changePct! > 0 ? '+' : ''}${num(c.changePct)} %)${src(c.sources)}`);
  if (!moving.length) out.push('- no product moved enough to flag');
  out.push(`- Monthly comparison: ${p.monthly.comparable ? p.monthly.reason : `not possible — ${p.monthly.reason}`}.`);

  const problems = p.lots.filter((l) => l.status === 'expired_on_arrival' || l.status === 'expired_unsold');
  out.push('', '### [FACT] Expired stock by delivered lot (book estimate)', '');
  for (const l of problems) {
    out.push(`- ${l.item}, lot ${l.noteNo} (delivered ${l.deliveryDate}, expiry ${l.expiryDate}): ${l.status === 'expired_on_arrival' ? 'expired on arrival' : 'expired'} with ${num(l.remainingAsOf)} ${l.unit} not used by recipes — ${rsd(l.costAtRisk ?? 0)} at cost${src(l.sources.slice(0, 1))}`);
  }
  if (!problems.length) out.push('- none');

  const atRisk = p.lots.filter((l) => l.status === 'at_risk');
  out.push('', `### [FORECAST] Lots at risk of expiring unsold (next ${PLANNING_RULES.forecastHorizonDays} days)`, '');
  for (const l of atRisk) {
    out.push(`- ${l.item}, lot ${l.noteNo}: ${num(l.remainingAsOf)} ${l.unit} left, expires ${l.expiryDate} (${l.daysToExpiry} days); at ${num(l.avgDailyDemand)} ${l.unit}/day about ${num(l.projectedLeftover)} ${l.unit} will be left — ${rsd(l.costAtRisk ?? 0)} at cost${src(l.sources.slice(0, 1))}`);
  }
  if (!atRisk.length) out.push('- none');

  out.push('', '### [RECOMMENDATION] Promotion candidates', '');
  for (const x of p.promotions) {
    out.push(
      `- **${x.action}.** ${num(x.unitsAtRisk)} ${x.unit} forecast unsold (${rsd(x.costAtRisk)} at cost); clearing it needs ${num(x.requiredDailySales)} ${x.unit}/day vs ${num(x.currentDailySales)} now${x.requiredUpliftPct !== null ? ` (+${num(x.requiredUpliftPct, 0)} %)` : ''}.` +
        (x.maxDiscountPct !== null ? ` Price excl. VAT ${rsd(x.netPricePerUnit ?? 0)}, cost ${rsd(x.costPerUnit ?? 0)}: a discount above ${num(x.maxDiscountPct)} % sells below cost.` : '') +
        ` _${x.limitations.join(' ')}_`
    );
  }
  if (!p.promotions.length) out.push('- none: no lot is forecast to expire with stock left');

  out.push('', '### [RECOMMENDATION] Replenishment', '');
  out.push(
    p.params
      ? `Order quantity = average daily demand × (lead time + review period ${p.params.reviewPeriodDays} d + safety stock ${p.params.safetyStockDays} d) − book stock, in whole purchase units, proposed only below the reorder point (demand × (lead time + safety)).${p.params.synthetic ? ' ⚠️ Lead times and safety stock come from `data/planiranje.json`, which is **synthetic** — replace with real supplier terms.' : ''}`
      : '⚠️ No planning parameters (`data/planiranje.json`): no order quantities are proposed. Missing per item is listed below.',
    '',
    '| Item | Flag | Book stock | Demand/day | Days of cover | Order | Confidence |',
    '| --- | --- | ---: | ---: | ---: | --- | --- |'
  );
  for (const x of p.replenishment.filter((r) => r.flag !== 'ok')) {
    out.push(`| ${x.item} | ${x.flag} | ${num(x.bookStock)} ${x.unit} | ${num(x.avgDailyDemand)} | ${num(x.daysOfCover)} | ${x.orderQuantity ? `${x.orderQuantity} ${x.purchaseUnit}` : '–'} | ${x.confidence} |`);
  }
  out.push('', `${p.replenishment.filter((r) => r.flag === 'ok').length} other items: stock covers demand.`);

  out.push('', '### Missing data and limitations', '');
  const missing = [...new Set(p.replenishment.flatMap((r) => r.missing))];
  out.push(
    ...missing.map((m) => `- ${m}`),
    '- promotion history (no discount effect on volume is estimated)',
    `- longer sales history (only ${p.profit.length ? 'one month' : 'no'} of POS data; no seasonality)`,
    ...p.excludedNotes.map((n) => `- delivery note left out of lot tracking (reading not verified): ${n}`),
    ...(p.unusedItems.length ? [`- delivered items not used by any recipe (not tracked): ${p.unusedItems.join(', ')}`] : [])
  );
  return out;
}
