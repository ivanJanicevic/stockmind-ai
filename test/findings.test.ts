import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFindings, parseReview } from '../src/findings.js';

const rows = new Map<string, unknown>([
  ['TREND-106', { id: 'TREND-106', name: 'Karamel latte', weeks: [39, 27, 22, 7], changePct: -82.05, flagged: true }],
  ['PNL-AFTER', { id: 'PNL-AFTER', monthlyResult: -16998.72, fixedCosts: 349450 }],
]);

test('findings must cite a known row and only its figures', () => {
  const answer = JSON.stringify({
    findings: [
      { id: 'TREND-106', severity: 'high', headline: 'Karamel latte fell from 39 to 7 a week (-82,05%)', explanation: 'Price unchanged.', action: 'Check the recipe and the menu.' },
      { id: 'TREND-999', severity: 'low', headline: 'Ghost', explanation: '', action: 'x' },
      { id: 'PNL-AFTER', severity: 'high', headline: 'Loss of 17.500,00 RSD a month', explanation: '', action: 'Cut costs.' },
      { id: 'PNL-AFTER', severity: 'high', headline: 'Run-rate loss of 16.998,72 RSD a month', explanation: 'Fixed costs 349.450,00.', action: 'Review rent and electricity.' },
    ],
  });
  const parsed = parseFindings(answer, rows);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.accepted.map((f) => f.id), ['TREND-106', 'PNL-AFTER']);
  assert.deepEqual(parsed.value.rejected.map((r) => r.reason), ['cites unknown row id "TREND-999"', 'figures not in row PNL-AFTER: 17.500,00']);
});

test('review actions must cite known items and only their figures', () => {
  const items = new Map<string, unknown>([...rows, ['AP-F-OPT-2026-0931', { id: 'AP-F-OPT-2026-0931', decision: 'held', impactRsd: 806.4 }]]);
  const answer = JSON.stringify({
    summary: 'Margins and invoices need attention.',
    actions: [
      { itemIds: ['AP-F-OPT-2026-0931'], action: 'Ask for a credit note of 806,40 RSD', why: 'Price above agreed.' },
      { itemIds: ['NOPE'], action: 'Do something', why: '' },
      { itemIds: ['PNL-AFTER'], action: 'Save 50.000,00 RSD', why: '' },
    ],
  });
  const parsed = parseReview(answer, items);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.equal(parsed.value.review.actions.length, 1);
  assert.equal(parsed.value.rejected.length, 2);
  assert.equal(parseReview('not json', items).ok, false);
});
