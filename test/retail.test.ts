import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeRetailDataset,
  buildLocalRetailEvidence,
  buildRetailEvidenceFacts,
  parseDeliveryLots,
  type RetailDataset,
} from '../src/retail-data.js';
import { parseRetailAnalysis, parseRetailPlan } from '../src/retail-parsing.js';
import { buildRetailCandidates, buildRetailReport } from '../src/retail-report.js';
import { retailAnalystMessage } from '../src/retail-prompts.js';
import { parseRetailTeamMessage } from '../src/retail-network.js';

function fixture(): RetailDataset {
  const sales: RetailDataset['sales'] = [];
  let row = 2;
  for (let day = 1; day <= 14; day++) {
    const date = `2026-01-${String(day).padStart(2, '0')}`;
    const receipt = day <= 5 ? `combined-${day}` : `coffee-${day}`;
    const espressoQuote = `${date};${receipt};101;Espresso;1;120,00;20;120,00`;
    sales.push({
      date,
      receipt,
      receiptType: 'Promet Prodaja',
      productCode: '101',
      productName: 'Espresso',
      quantity: 1,
      unitPrice: 120,
      vatRate: 20,
      amount: 120,
      row: row++,
      quote: espressoQuote,
    });
    if (day <= 7 || day === 8) {
      const quantity = day <= 7 ? 2 : 1;
      const tonicQuote = `${date};${receipt};201;Tonic;${quantity};240,00;20;${(quantity * 240).toFixed(2)}`;
      sales.push({
        date,
        receipt,
        receiptType: 'Promet Prodaja',
        productCode: '201',
        productName: 'Tonic',
        quantity,
        unitPrice: 240,
        vatRate: 20,
        amount: quantity * 240,
        row: row++,
        quote: tonicQuote,
      });
    }
  }

  const purchase = (
    supplierCode: string,
    productName: string,
    unitCost: number,
    sourceRow: number
  ) => ({
    date: '2026-01-01',
    invoice: 'INV-1',
    deliveryNote: 'D-1',
    supplierCode,
    productName,
    quantity: 10,
    unitCost,
    row: sourceRow,
    quote: `2026-01-01;INV-1;${supplierCode};${productName};${unitCost}`,
  });

  return {
    products: [
      { code: '101', name: 'Espresso', group: 'coffee', salePrice: 120, vatRate: 20, deliveryName: null },
      { code: '201', name: 'Tonic', group: 'drinks', salePrice: 240, vatRate: 20, deliveryName: 'Tonic 0.25' },
    ],
    recipes: [
      { productCode: '101', components: [{ ingredientKey: 'coffee', quantity: 7 }] },
      { productCode: '201', components: [{ deliveryName: 'Tonic 0.25', quantity: 1 }] },
    ],
    ingredients: [
      { key: 'coffee', deliveryName: 'Coffee 1kg', factor: 1000, supplierCodes: ['C-1'] },
    ],
    sales,
    purchases: [
      purchase('C-1', 'Coffee 1kg', 1000, 2),
      purchase('T-1', 'Tonic 0.25', 50, 3),
    ],
    expenses: [{
      month: '2026-01',
      category: 'Rent',
      description: 'Monthly rent',
      amount: 100,
      row: 2,
      quote: '2026-01;Rent;100',
    }],
    deliveryLots: [
      {
        deliveryNote: 'D-1',
        deliveryDate: '2026-01-01',
        itemCode: 'C-1',
        productName: 'Coffee 1kg',
        unit: 'kom',
        quantity: 1,
        expiryDate: '2026-02-01',
        file: 'data/otpremnice/otpremnica-01-test.pdf',
        quote: '1 C-1 Coffee 1kg kom 1 01.02.2026',
      },
      {
        deliveryNote: 'D-1',
        deliveryDate: '2026-01-01',
        itemCode: 'T-1',
        productName: 'Tonic 0.25',
        unit: 'kom',
        quantity: 10,
        expiryDate: '2026-01-20',
        file: 'data/otpremnice/otpremnica-01-test.pdf',
        quote: '2 T-1 Tonic 0.25 kom 10 20.01.2026',
      },
    ],
    invoicePairs: [],
  };
}

test('delivery-note parser extracts dated lot rows and quotes', () => {
  const [lot] = parseDeliveryLots([{
    file: 'data/otpremnice/otpremnica-01-test.pdf',
    text: [
      'OTPREMNICA br. D-1',
      'Datum                        01.01.2026',
      'otpremnice:',
      'R.br    Šifra    Naziv artikla    JM    Količina    Rok trajanja',
      '1       C-1      Coffee 1kg       kom   6           04.02.2026',
    ].join('\n'),
  }]);

  assert.ok(lot);
  assert.equal(lot.deliveryNote, 'D-1');
  assert.equal(lot.deliveryDate, '2026-01-01');
  assert.equal(lot.quantity, 6);
  assert.equal(lot.expiryDate, '2026-02-04');
  assert.match(lot.quote, /Coffee 1kg/);
});

test('analyst prompts carry role-specific local evidence and source quotes', () => {
  const data = fixture();
  const analysis = analyzeRetailDataset(data);
  const evidence = buildLocalRetailEvidence(data, analysis);
  const teamEvidence = buildRetailEvidenceFacts(data, analysis);
  const message = retailAnalystMessage(analysis.periodStart, analysis.periodEnd, evidence.sales);

  assert.ok(evidence.sales.includes(data.sales[0]!.quote));
  assert.ok(evidence.inventory.includes(data.deliveryLots[0]!.quote));
  assert.ok(evidence.finance.includes(data.purchases[0]!.quote));
  assert.ok(message.includes('<source_evidence>'));
  assert.ok(message.includes('<shared_team_state>'));
  assert.ok(message.includes(data.sales[0]!.quote));
  assert.ok(teamEvidence.has('sales:overview'));
});

test('deterministic analysis detects declining demand, a recorded stock gap, and co-purchases', () => {
  const data = fixture();
  const analysis = analyzeRetailDataset(data);
  const tonic = analysis.products.find((product) => product.code === '201');
  const stock = analysis.inventory.find((item) => item.deliveryName === 'Tonic 0.25');

  assert.equal(tonic?.weeks[0]?.units, 14);
  assert.equal(tonic?.weeks[1]?.units, 1);
  assert.equal(tonic?.trendPercent, -92.86);
  assert.equal(stock?.received, 10);
  assert.equal(stock?.consumed, 15);
  assert.equal(stock?.recordedShortfall, 5);

  const candidates = buildRetailCandidates(data, analysis);
  assert.ok(candidates.some((candidate) => candidate.type === 'promotion_test' && candidate.target === 'Tonic'));
  assert.ok(candidates.some((candidate) => candidate.type === 'inventory_check' && candidate.target === 'Tonic 0.25'));
  assert.ok(candidates.some((candidate) => candidate.type === 'bundle_test'));
});

test('report shows paired receipt source rows for bundle candidates', () => {
  const data = fixture();
  const analysis = analyzeRetailDataset(data);
  const candidates = buildRetailCandidates(data, analysis);
  const report = buildRetailReport(data, analysis, {
    candidates,
    agentResults: [],
    errors: [],
    model: 'test',
    tokens: { input: 0, output: 0 },
  });

  assert.match(report, /sales receipts: 14; refund receipts: 0/);
  assert.match(report, /basket:101\+201: data\/promet_2026-11-26_do_2026-12-25\.csv rows [\d, -]+ \(paired receipt IDs\)/);
});

test('retail agent output accepts source-backed figures and rejects unsupported claims', () => {
  const evidenceFacts = new Map([
    ['sales:201:weekly-trend', '{"date":"2026-01-01","units":2}'],
    ['inventory:kisela-voda', '{"expired":55}'],
  ]);
  const evidence = new Set(evidenceFacts.keys());
  const valid = {
    summary: 'Demand is declining.',
    findings: [{
      title: 'Review the trend',
      detail: 'The product is appearing less often in recent receipts.',
      evidenceIds: ['sales:201:weekly-trend'],
    }],
  };
  assert.equal(parseRetailAnalysis(JSON.stringify(valid), evidence, evidenceFacts).ok, true);

  const sourcedNumber = structuredClone(valid);
  sourcedNumber.summary = 'The source period includes 2026.';
  sourcedNumber.findings[0]!.detail = 'The recorded quantity is 2 units.';
  assert.equal(parseRetailAnalysis(JSON.stringify(sourcedNumber), evidence, evidenceFacts).ok, true);

  const computedNumber = structuredClone(valid);
  computedNumber.findings[0]!.detail = '55 units were recorded as expired.';
  computedNumber.findings[0]!.evidenceIds = ['inventory:kisela-voda'];
  assert.equal(parseRetailAnalysis(JSON.stringify(computedNumber), evidence, evidenceFacts).ok, true);

  const numeric = structuredClone(valid);
  numeric.findings[0]!.detail = 'Demand fell by 25 percent.';
  assert.equal(parseRetailAnalysis(JSON.stringify(numeric), evidence, evidenceFacts).ok, false);

  const unsupportedSummary = structuredClone(valid);
  unsupportedSummary.summary = 'The sales data was recorded in 1999.';
  assert.equal(parseRetailAnalysis(JSON.stringify(unsupportedSummary), evidence, evidenceFacts).ok, false);

  const fabricatedEvidence = structuredClone(valid);
  fabricatedEvidence.findings[0]!.evidenceIds = ['sales:unknown'];
  assert.equal(parseRetailAnalysis(JSON.stringify(fabricatedEvidence), evidence, evidenceFacts).ok, false);
});

test('planner figures must match candidate metrics and cannot invent candidates or evidence', () => {
  const candidate = {
    id: 'candidate:promotion:201',
    type: 'promotion_test' as const,
    target: 'Tonic',
    reason: 'Demand declined.',
    evidenceIds: ['sales:201:weekly-trend'],
    metrics: { trendPercent: -92.86 },
    limitations: 'No promotion history.',
  };
  const valid = {
    summary: 'The measured demand change is 92.86%.',
    recommendations: [{
      candidateId: candidate.id,
      rationale: 'Demand changed by 92.86%; use a short, owner-reviewed test and record the results.',
      evidenceIds: candidate.evidenceIds,
    }],
  };
  assert.equal(parseRetailPlan(JSON.stringify(valid), [candidate]).ok, true);

  const invented = structuredClone(valid);
  invented.recommendations[0]!.candidateId = 'candidate:unknown';
  assert.equal(parseRetailPlan(JSON.stringify(invented), [candidate]).ok, false);

  const numeric = structuredClone(valid);
  numeric.recommendations[0]!.rationale = 'Offer 20% off.';
  assert.equal(parseRetailPlan(JSON.stringify(numeric), [candidate]).ok, false);
});

test('network team messages require the matching dataset, evidence and grounded figures', () => {
  const evidenceFacts = new Map([
    ['sales:201:weekly-trend', '{"units":2,"trendPercent":-25}'],
  ]);
  const message = {
    protocol: 'stockmind.team.v1',
    messageId: 'message-1',
    runId: 'run-1',
    datasetKey: 'dataset-1',
    role: 'sales',
    status: 'completed',
    summary: 'Demand is declining.',
    findings: [{
      title: 'Recent demand is lower',
      detail: 'Sales declined by 25%.',
      evidenceIds: ['sales:201:weekly-trend'],
    }],
  };
  assert.ok(parseRetailTeamMessage(JSON.stringify(message), 'dataset-1', evidenceFacts));

  const unsupportedFigure = structuredClone(message);
  unsupportedFigure.findings[0]!.detail = 'Sales declined by 40%.';
  assert.equal(parseRetailTeamMessage(JSON.stringify(unsupportedFigure), 'dataset-1', evidenceFacts), undefined);
  assert.equal(parseRetailTeamMessage(JSON.stringify(message), 'different-dataset', evidenceFacts), undefined);

  const unknownEvidence = structuredClone(message);
  unknownEvidence.findings[0]!.evidenceIds = ['sales:unknown'];
  assert.equal(parseRetailTeamMessage(JSON.stringify(unknownEvidence), 'dataset-1', evidenceFacts), undefined);
});
