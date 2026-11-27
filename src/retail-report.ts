import type {
  RetailAnalysis,
  RetailDataset,
  ProductMargin,
} from './retail-data.js';
import type {
  RetailAnalysisAnswer,
  RetailPlanAnswer,
  RetailTeamMessage,
} from './retail-prompts.js';
import type { RetailCandidate } from './retail-parsing.js';

export interface RetailAgentReport {
  name: string;
  summary: string;
  findings: RetailAnalysisAnswer['findings'];
  durationMs: number;
}

export interface RetailReportOptions {
  candidates: RetailCandidate[];
  agentResults: RetailAgentReport[];
  plan?: RetailPlanAnswer;
  teamMessages?: RetailTeamMessage[];
  errors: string[];
  model: string;
  tokens: { input: number; output: number };
}

const money = (amount: number) => `RSD ${amount.toFixed(2)}`;
const percent = (value: number) => `${value.toFixed(2)}%`;
const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function compactRows(rows: number[]): string {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < sorted.length;) {
    const start = sorted[index]!;
    let end = start;
    while (sorted[index + 1] === end + 1) {
      end = sorted[index + 1]!;
      index++;
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    index++;
  }
  return ranges.join(', ') || 'none';
}

function evidenceFor(
  evidenceId: string,
  dataset: RetailDataset,
  analysis: RetailAnalysis
): string[] {
  if (evidenceId === 'sales:overview') {
    return [`data/promet_2026-11-26_do_2026-12-25.csv rows ${compactRows(dataset.sales.map((row) => row.row))}`];
  }
  if (evidenceId.startsWith('sales:')) {
    const code = evidenceId.split(':')[1];
    const product = analysis.products.find((item) => item.code === code);
    return product
      ? [`data/promet_2026-11-26_do_2026-12-25.csv rows ${compactRows(product.sourceRows)}`]
      : [];
  }
  if (evidenceId.startsWith('inventory:')) {
    const item = analysis.inventory.find((entry) => `inventory:${slug(entry.deliveryName)}` === evidenceId);
    return item
      ? [
          ...item.lots.map((lot) => `${lot.file} (${lot.deliveryNote}): "${lot.quote}"`),
          `data/promet_2026-11-26_do_2026-12-25.csv rows ${compactRows(item.sourceRows)}; recipe-based consumption from data/normativi.json`,
        ]
      : [];
  }
  if (evidenceId.startsWith('margin:')) {
    const code = evidenceId.slice('margin:'.length);
    const margin = analysis.productMargins.find((item) => item.code === code);
    return margin
      ? [
          `data/promet_2026-11-26_do_2026-12-25.csv rows ${compactRows(margin.sourceRows)}`,
          `data/nabavne_cene.csv rows ${compactRows(margin.purchaseRows)}; recipe in data/normativi.json`,
        ]
      : [];
  }
  if (evidenceId.startsWith('purchase:')) {
    const code = evidenceId.slice('purchase:'.length);
    const change = analysis.purchasePriceChanges.find((item) => item.supplierCode === code);
    return change ? [change.previousSource, change.latestSource] : [];
  }
  if (evidenceId.startsWith('finance:')) {
    const month = evidenceId.slice('finance:'.length);
    const finance = analysis.monthlyFinance.find((item) => item.month === month);
    return finance
      ? [
          `data/promet_2026-11-26_do_2026-12-25.csv rows ${compactRows(finance.sourceRows)}`,
          `data/nabavne_cene.csv rows ${compactRows(finance.purchaseRows)}`,
          `data/troskovi.csv rows ${compactRows(finance.expenseRows)}`,
        ]
      : [];
  }
  if (evidenceId.startsWith('invoice:')) {
    const file = evidenceId.slice('invoice:'.length);
    return dataset.invoicePairs.some(({ invoice }) => invoice.file === file) ? [file] : [];
  }
  if (evidenceId.startsWith('delivery:')) {
    const file = evidenceId.slice('delivery:'.length);
    return dataset.invoicePairs.some(({ deliveryNote }) => deliveryNote?.file === file) ? [file] : [];
  }
  if (evidenceId.startsWith('basket:')) {
    const [firstCode, secondCode] = evidenceId.slice('basket:'.length).split('+');
    if (!firstCode || !secondCode) return [];
    const receiptProducts = new Map<string, Set<string>>();
    for (const sale of dataset.sales) {
      if (sale.quantity <= 0) continue;
      const products = receiptProducts.get(sale.receipt) ?? new Set<string>();
      products.add(sale.productCode);
      receiptProducts.set(sale.receipt, products);
    }
    const matchingReceipts = new Set(
      [...receiptProducts]
        .filter(([, products]) => products.has(firstCode) && products.has(secondCode))
        .map(([receipt]) => receipt)
    );
    const rows = dataset.sales
      .filter((sale) => matchingReceipts.has(sale.receipt) &&
        (sale.productCode === firstCode || sale.productCode === secondCode))
      .map((sale) => sale.row);
    return [`data/promet_2026-11-26_do_2026-12-25.csv rows ${compactRows(rows)} (paired receipt IDs)`];
  }
  return [];
}

function bundleCandidates(dataset: RetailDataset, analysis: RetailAnalysis): RetailCandidate[] {
  const receipts = new Map<string, Map<string, number[]>>();
  for (const sale of dataset.sales) {
    if (sale.quantity <= 0) continue;
    const receipt = receipts.get(sale.receipt) ?? new Map<string, number[]>();
    receipt.set(sale.productCode, [...(receipt.get(sale.productCode) ?? []), sale.row]);
    receipts.set(sale.receipt, receipt);
  }

  const productByCode = new Map(dataset.products.map((product) => [product.code, product]));
  const counts = new Map<string, { first: string; second: string; receipts: number; rows: number[] }>();
  const productReceiptCounts = new Map<string, number>();
  for (const receipt of receipts.values()) {
    const codes = [...receipt.keys()].sort();
    for (const code of codes) productReceiptCounts.set(code, (productReceiptCounts.get(code) ?? 0) + 1);
    for (let firstIndex = 0; firstIndex < codes.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < codes.length; secondIndex++) {
        const first = codes[firstIndex]!;
        const second = codes[secondIndex]!;
        const key = `${first}+${second}`;
        const pair = counts.get(key) ?? { first, second, receipts: 0, rows: [] };
        pair.receipts++;
        pair.rows.push(...(receipt.get(first) ?? []), ...(receipt.get(second) ?? []));
        counts.set(key, pair);
      }
    }
  }

  return [...counts.values()]
    .filter((pair) => pair.receipts >= 5)
    .sort((a, b) => b.receipts - a.receipts)
    .slice(0, 3)
    .flatMap((pair): RetailCandidate[] => {
      const firstProduct = productByCode.get(pair.first);
      const secondProduct = productByCode.get(pair.second);
      if (!firstProduct || !secondProduct) return [];
      const id = `candidate:bundle:${pair.first}+${pair.second}`;
      const evidenceId = `basket:${pair.first}+${pair.second}`;
      return [{
        id,
        type: 'bundle_test',
        target: `${firstProduct.name} + ${secondProduct.name}`,
        reason: 'These products already appear together in sales receipts; test a bundle only with an owner-approved price.',
        evidenceIds: [evidenceId, `sales:${pair.first}:weekly-trend`, `sales:${pair.second}:weekly-trend`],
        metrics: {
          coPurchaseReceipts: pair.receipts,
          firstProductReceipts: productReceiptCounts.get(pair.first) ?? 0,
          secondProductReceipts: productReceiptCounts.get(pair.second) ?? 0,
          observedBundleRatePercent: Number(
            ((pair.receipts / Math.min(
              productReceiptCounts.get(pair.first) ?? 1,
              productReceiptCounts.get(pair.second) ?? 1
            )) * 100).toFixed(2)
          ),
          salesRows: compactRows(pair.rows),
        },
        limitations: 'Co-purchase does not prove that a discount will increase total profit.',
      }];
    });
}

export function buildRetailCandidates(
  dataset: RetailDataset,
  analysis: RetailAnalysis
): RetailCandidate[] {
  const candidates: RetailCandidate[] = [];
  const marginByCode = new Map(analysis.productMargins.map((margin) => [margin.code, margin]));

  analysis.products
    .filter((product) => product.trendPercent !== null && product.trendPercent <= -20)
    .sort((a, b) => a.trendPercent! - b.trendPercent!)
    .slice(0, 3)
    .forEach((product) => {
      const margin = marginByCode.get(product.code);
      candidates.push({
        id: `candidate:promotion:${product.code}`,
        type: 'promotion_test',
        target: product.name,
        reason: 'Sales declined across complete observed weeks; run a small, measured promotion test only if margin remains acceptable.',
        evidenceIds: [
          `sales:${product.code}:weekly-trend`,
          ...(margin ? [`margin:${product.code}`] : []),
        ],
        metrics: {
          trendPercent: product.trendPercent,
          firstCompleteWeekUnits: product.weeks[0]?.units ?? null,
          lastCompleteWeekUnits: [...product.weeks].reverse().find((week) =>
            dayDifference(week.start, week.end) === 6
          )?.units ?? null,
          observedGrossMargin: margin?.grossMargin ?? null,
        },
        limitations: 'No promotion history is available to estimate price elasticity or uplift.',
      });
    });

  analysis.inventory
    .filter((item) => item.recordedShortfall > 0)
    .forEach((item) => {
      candidates.push({
        id: `candidate:stock-check:${slug(item.deliveryName)}`,
        type: 'inventory_check',
        target: item.deliveryName,
        reason: 'Sales-derived use exceeds recorded deliveries; verify opening stock and missing delivery records before acting.',
        evidenceIds: [`inventory:${slug(item.deliveryName)}`],
        metrics: {
          receivedUnits: item.received,
          usedUnits: item.consumed,
          recordedShortfall: item.recordedShortfall,
        },
        limitations: 'Opening inventory and unrecorded deliveries are unknown, so this is not proof of a loss.',
      });
    });

  analysis.inventory
    .filter((item) => item.expired > 0 || item.nextExpiry !== null)
    .forEach((item) => {
      candidates.push({
        id: `candidate:expiry-review:${slug(item.deliveryName)}`,
        type: 'markdown_review',
        target: item.deliveryName,
        reason: item.expired > 0
          ? 'Review earlier stock rotation and markdown timing for this item in future periods.'
          : 'Monitor the remaining lot and consider a human-reviewed markdown if sell-through is unlikely.',
        evidenceIds: [`inventory:${slug(item.deliveryName)}`],
        metrics: {
          remainingUnits: item.remaining,
          expiredUnits: item.expired,
          nextExpiry: item.nextExpiry,
        },
        limitations: 'The result is retrospective for the synthetic data window; it is not live inventory.',
      });
    });

  analysis.purchasePriceChanges
    .filter((change) => change.changePercent > 0)
    .slice(0, 5)
    .forEach((change) => {
      candidates.push({
        id: `candidate:price-review:${change.supplierCode}`,
        type: 'price_review',
        target: change.productName,
        reason: 'A purchase cost increased; review supplier terms and affected menu margins before changing sale prices.',
        evidenceIds: [`purchase:${change.supplierCode}`],
        metrics: {
          previousPrice: change.previousPrice,
          latestPrice: change.latestPrice,
          changePercent: change.changePercent,
        },
        limitations: 'Any sale-price change requires human review and a full demand assessment.',
      });
    });

  analysis.monthlyFinance
    .filter((month) => month.estimatedMonthlyRunRate !== null && month.estimatedMonthlyRunRate < 0)
    .forEach((month) => {
      candidates.push({
        id: `candidate:expense-review:${month.month}`,
        type: 'expense_review',
        target: month.month,
        reason: 'The estimated monthly run-rate is negative; review recurring expenses and gross-margin assumptions.',
        evidenceIds: [`finance:${month.month}`],
        metrics: {
          estimatedMonthlyRunRate: month.estimatedMonthlyRunRate,
          operatingCosts: month.operatingCosts,
          costCoveragePercent: month.costCoveragePercent,
        },
        limitations: 'This is a simple 30-day extrapolation, not accounting profit or a forecast.',
      });
    });

  candidates.push(...bundleCandidates(dataset, analysis));
  return candidates;
}

function dayDifference(start: string, end: string): number {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

export function buildRetailReport(
  dataset: RetailDataset,
  analysis: RetailAnalysis,
  options: RetailReportOptions
): string {
  const netSales = analysis.dailySales.reduce((sum, day) => sum + day.netRevenue, 0);
  const salesReceipts = new Set(
    dataset.sales.filter((sale) => !sale.receiptType.toLowerCase().includes('refund')).map((sale) => sale.receipt)
  );
  const refundReceipts = new Set(
    dataset.sales.filter((sale) => sale.receiptType.toLowerCase().includes('refund')).map((sale) => sale.receipt)
  );
  const selected = new Map(
    (options.plan?.recommendations ?? []).map((recommendation) => [
      recommendation.candidateId,
      recommendation,
    ])
  );
  const candidateById = new Map(options.candidates.map((candidate) => [candidate.id, candidate]));
  const lines = [
    '# StockMind AI — Cafe Operations Review',
    '',
    '> Demo analysis of synthetic records only. Not financial advice. Recommendations are for human review; no prices, orders, or stock records are changed.',
    '',
    `Analysis window: ${analysis.periodStart} to ${analysis.periodEnd}.`,
    `POS rows: ${analysis.sourceRowCount}; sales receipts: ${salesReceipts.size}; refund receipts: ${refundReceipts.size}; products with sales: ${analysis.products.length}.`,
    `Net sales excluding VAT: ${money(netSales)} (calculated from \`data/promet_2026-11-26_do_2026-12-25.csv\`, rows ${compactRows(dataset.sales.map((row) => row.row))}).`,
    '',
    '## Agent collaboration',
    '',
  ];

  for (const agent of options.agentResults) {
    lines.push(
      `### ${agent.name}`,
      '',
      `${agent.summary} (loop elapsed: ${(agent.durationMs / 1000).toFixed(1)} seconds.)`,
      ''
    );
    for (const finding of agent.findings) {
      lines.push(`- **${finding.title}** — ${finding.detail}`);
      lines.push(`  - Evidence IDs: ${finding.evidenceIds.map((id) => `\`${id}\``).join(', ')}`);
      for (const id of finding.evidenceIds) {
        for (const source of evidenceFor(id, dataset, analysis)) lines.push(`  - Source: ${source}`);
      }
    }
    lines.push('');
  }

  if (options.teamMessages?.length) {
    lines.push('## Shared team messages', '');
    for (const message of options.teamMessages) {
      lines.push(
        `- **${message.role}** (${message.status}; run \`${message.runId}\`): ${message.summary}`
      );
      for (const finding of message.findings) {
        lines.push(`  - ${finding.title}: ${finding.detail} [${finding.evidenceIds.join(', ')}]`);
      }
    }
    lines.push('');
  }

  if (options.errors.length > 0) {
    lines.push('### Agent errors', '', ...options.errors.map((error) => `- ${error}`), '');
  }

  lines.push(
    '## Daily performance',
    '',
    '| Date | Receipts (sales and refunds) | Net sales excl. VAT | Items sold (net) | Source rows |',
    '| --- | ---: | ---: | ---: | --- |'
  );
  for (const day of analysis.dailySales) {
    lines.push(
      `| ${day.date} | ${day.receipts} | ${money(day.netRevenue)} | ${day.units.toFixed(2)} | data/promet_2026-11-26_do_2026-12-25.csv:${compactRows(day.sourceRows)} |`
    );
  }

  lines.push(
    '',
    '## Weekly performance',
    '',
    '| Week | Period | Receipts (sales and refunds) | Net sales excl. VAT | Item units | Source rows |',
    '| --- | --- | ---: | ---: | ---: | --- |'
  );
  for (const week of analysis.weeklySales) {
    const receiptCount = new Set(
      dataset.sales
        .filter((sale) => sale.date >= week.start && sale.date <= week.end)
        .map((sale) => sale.receipt)
    ).size;
    lines.push(
      `| ${week.week} | ${week.start}–${week.end} | ${receiptCount} | ${money(week.netRevenue)} | ${week.units.toFixed(2)} | data/promet_2026-11-26_do_2026-12-25.csv:${compactRows(week.sourceRows)} |`
    );
  }

  lines.push(
    '',
    '## Product demand and gross margin',
    '',
    '| Product | Group | Net units | Weekly change* | Net sales excl. VAT | Gross margin on priced sales | Cost coverage | Source rows |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |'
  );
  for (const product of analysis.products.slice(0, 15)) {
    const margin = analysis.productMargins.find((item) => item.code === product.code);
    const coverage = margin?.netRevenue
      ? Math.min(100, Math.max(0, (margin.pricedNetRevenue / margin.netRevenue) * 100))
      : 0;
    lines.push(
      `| ${cell(product.name)} | ${cell(product.group)} | ${product.units.toFixed(2)} | ${product.trendPercent === null ? 'n/a' : percent(product.trendPercent)} | ${money(product.netRevenue)} | ${margin ? money(margin.grossMargin) : 'not calculated'} | ${percent(coverage)} | sales rows ${compactRows(product.sourceRows)}${margin ? `; purchase rows ${compactRows(margin.purchaseRows)}` : ''} |`
    );
  }
  lines.push(
    '',
    '* Weekly change compares the first and last complete seven-day buckets in the data window; the partial final bucket is excluded.',
    'Gross margin uses recipe quantities from `data/normativi.json`, sale amounts net of VAT, and the latest purchase cost effective on each sales date from `data/nabavne_cene.csv`. Revenue with incomplete ingredient-cost coverage is excluded from the gross-margin subtotal.'
  );

  lines.push(
    '',
    '## Stock and expiry',
    '',
    '| Dispatch item | Received | Sales-derived use | Recorded shortfall | Remaining | Expired in window | Next expiry | Source |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |'
  );
  for (const item of analysis.inventory) {
    const lotSources = item.lots.map((lot) => `${lot.file}:${lot.deliveryNote}`).join('<br>');
    lines.push(
      `| ${cell(item.deliveryName)} | ${item.received.toFixed(2)} | ${item.consumed.toFixed(2)} | ${item.recordedShortfall.toFixed(2)} | ${item.remaining.toFixed(2)} | ${item.expired.toFixed(2)} | ${item.nextExpiry ?? '—'} | ${lotSources}; sales rows ${compactRows(item.sourceRows)} |`
    );
  }
  lines.push(
    '',
    'Inventory quantities are reconciled against recorded dispatch notes and recipe-derived use. Opening stock, missing dispatch records, and physical counts are not present, so a recorded shortfall is a warning to investigate, not proof of loss. Expiry results are retrospective over the supplied synthetic period.'
  );

  lines.push(
    '',
    '## Purchase costs and operating expenses',
    '',
    '| Item | Previous cost | Latest cost | Change | Source rows |',
    '| --- | ---: | ---: | ---: | --- |'
  );
  for (const change of analysis.purchasePriceChanges) {
    lines.push(
      `| ${cell(change.productName)} | ${money(change.previousPrice)} on ${change.previousDate} | ${money(change.latestPrice)} on ${change.latestDate} | ${percent(change.changePercent)} | ${change.previousSource}; ${change.latestSource} |`
    );
  }
  lines.push(
    '',
    '| Month | Sales days in data | Net sales excl. VAT | Priced sales excl. VAT | Cost of goods | Gross margin on priced sales | Cost coverage | Operating costs | 30-day run-rate estimate | Source rows |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |'
  );
  for (const month of analysis.monthlyFinance) {
    lines.push(
      `| ${month.month} | ${month.salesDays} | ${money(month.netRevenue)} | ${money(month.pricedNetRevenue)} | ${money(month.costOfGoods)} | ${money(month.grossMargin)} | ${percent(month.costCoveragePercent)} | ${money(month.operatingCosts)} | ${month.estimatedMonthlyRunRate === null ? 'not estimated (incomplete costs)' : money(month.estimatedMonthlyRunRate)} | sales rows ${compactRows(month.sourceRows)}; purchase rows ${compactRows(month.purchaseRows)}; expense rows ${compactRows(month.expenseRows)} |`
    );
  }
  lines.push(
    '',
    'The run-rate extrapolates observed gross margin per sales day to thirty days, then subtracts the full listed monthly operating costs. It is not accounting profit or a forecast.'
  );

  lines.push('', '## Promotion and action candidates', '');
  if (options.candidates.length === 0) {
    lines.push('No candidates met the deterministic evidence checks.', '');
  } else {
    lines.push(
      '| Candidate | Action type | Target | Evidence-based reason | Metrics | Evidence sources | Limitations |',
      '| --- | --- | --- | --- | --- | --- | --- |'
    );
    for (const candidate of options.candidates) {
      lines.push(
        `| ${candidate.id} | ${candidate.type} | ${cell(candidate.target)} | ${candidate.reason} | ${Object.entries(candidate.metrics).map(([key, value]) => `${key}: ${value ?? 'n/a'}`).join('<br>')} | ${candidate.evidenceIds.map((id) => `${id}: ${evidenceFor(id, dataset, analysis).join('; ')}`).join('<br>')} | ${candidate.limitations} |`
      );
    }
  }

  lines.push('', '## Planner recommendations', '');
  if (options.plan) {
    lines.push(options.plan.summary, '');
    if (options.plan.recommendations.length === 0) lines.push('The planner did not select any action candidate.', '');
    for (const recommendation of options.plan.recommendations) {
      const candidate = candidateById.get(recommendation.candidateId);
      if (!candidate) continue;
      lines.push(
        `### ${candidate.type}: ${candidate.target}`,
        '',
        recommendation.rationale,
        '',
        `Evidence: ${recommendation.evidenceIds.map((id) => `\`${id}\``).join(', ')}`,
        `Candidate metrics: ${Object.entries(candidate.metrics).map(([key, value]) => `${key}=${value ?? 'n/a'}`).join('; ')}`,
        `Limitations: ${candidate.limitations}`,
        ''
      );
    }
  } else {
    lines.push('Recommendations were not generated because one or more analysis agents did not complete successfully.', '');
  }

  lines.push('## Method notes', '', ...analysis.notes.map((note) => `- ${note}`));
  lines.push(
    '',
    `Model used: ${options.model}. Token usage: ${options.tokens.input} input / ${options.tokens.output} output.`,
    '> Demo analysis of synthetic records only. Not financial advice. Recommendations are for human review; no prices, orders, or stock records are changed.',
    ''
  );
  return lines.join('\n');
}
