import { test } from 'node:test';
import assert from 'node:assert/strict';

import { invoices } from '../src/data/invoices.js';
import {
  amountsIn,
  parseAudit,
  parseExtraction,
  quoteInSource,
  unverifiedFields,
} from '../src/parsing.js';
import { extractions } from './fixtures.js';

const doc1001 = invoices.find((d) => d.id === 'INV-1001')!;
const good = extractions['INV-1001']!;

test('amountsIn reads European and English formats', () => {
  assert.deepEqual(amountsIn('EUR 1.428,00'), [1428]);
  assert.deepEqual(amountsIn('EUR 1,428.00'), [1428]);
  assert.deepEqual(amountsIn('EUR 12.400,00'), [12400]);
  assert.deepEqual(amountsIn('EUR 95,50'), [95.5]);
  assert.deepEqual(amountsIn('1428'), [1428]);
});

test('quoteInSource ignores whitespace differences only', () => {
  assert.equal(quoteInSource('Total due:   EUR 1.428,00', doc1001.text), true);
  assert.equal(quoteInSource('Total due: EUR 1.482,00', doc1001.text), false);
  assert.equal(quoteInSource('', doc1001.text), false);
});

test('parseExtraction accepts JSON wrapped in prose or code fences', () => {
  const parsed = parseExtraction('Here you go:\n```json\n' + JSON.stringify(good) + '\n```');
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.value, good);
});

test('parseExtraction treats an empty BIC as missing', () => {
  const parsed = parseExtraction(JSON.stringify({ ...good, bic: { value: '', quote: '' } }));
  assert.equal(parsed.ok && parsed.value.bic, null);
});

test('parseExtraction rejects missing quotes and non-JSON', () => {
  const noQuote = { ...good, totalAmount: { value: 1428 } };
  assert.equal(parseExtraction(JSON.stringify(noQuote)).ok, false);
  assert.equal(parseExtraction('I could not read the invoice.').ok, false);
});

test('all sample fixtures trace to their documents', () => {
  for (const doc of invoices) {
    assert.deepEqual(unverifiedFields(extractions[doc.id]!, doc.text), [], doc.id);
  }
});

test('invented or altered numbers are rejected', () => {
  const invented = { ...good, totalAmount: { value: 1482, quote: 'Total due: EUR 1.428,00' } };
  assert.match(unverifiedFields(invented, doc1001.text).join(), /totalAmount: value/);

  const fakeQuote = { ...good, totalAmount: { value: 1482, quote: 'Total due: EUR 1.482,00' } };
  assert.match(unverifiedFields(fakeQuote, doc1001.text).join(), /totalAmount: quote .* not found/);
});

test('parseAudit validates verdict and issues', () => {
  assert.deepEqual(parseAudit('{"verdict":"ok","issues":[]}'), {
    ok: true,
    value: { verdict: 'ok', issues: [] },
  });
  assert.equal(parseAudit('{"verdict":"maybe","issues":[]}').ok, false);
  assert.equal(parseAudit('{"verdict":"review","issues":[{"field":"iban"}]}').ok, false);
});
