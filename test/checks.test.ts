import { test } from 'node:test';
import assert from 'node:assert/strict';

import { invoices } from '../src/data/invoices.js';
import { vendors } from '../src/data/vendors.js';
import {
  addDuplicateChecks,
  caseChecks,
  decide,
  ibanChecksumValid,
  type InvoiceCase,
} from '../src/checks.js';
import { extractions } from './fixtures.js';

const LIMIT = 5000;

function runBatch(): InvoiceCase[] {
  const cases = invoices.map((doc): InvoiceCase => {
    const extraction = extractions[doc.id]!;
    return {
      doc,
      extraction,
      checks: caseChecks(doc, extraction, vendors),
      audit: { verdict: 'ok', issues: [] },
      errors: [],
      done: true,
    };
  });
  addDuplicateChecks(cases);
  return cases;
}

const failed = (c: InvoiceCase) => c.checks.filter((x) => !x.ok).map((x) => x.name);

test('ibanChecksumValid', () => {
  assert.equal(ibanChecksumValid('DE89 3704 0044 0532 0130 00'), true);
  assert.equal(ibanChecksumValid('FR1420041010050500013M02606'), true);
  assert.equal(ibanChecksumValid('FR1420041010050500013M02607'), false);
  assert.equal(ibanChecksumValid('not an iban'), false);
});

test('sample batch: each document gets the expected decision', () => {
  const byId = Object.fromEntries(runBatch().map((c) => [c.doc.id, c]));

  assert.equal(decide(byId['INV-1001']!, LIMIT), 'ready');
  assert.deepEqual(failed(byId['INV-1001']!), []);

  assert.equal(decide(byId['INV-1002']!, LIMIT), 'blocked');
  assert.deepEqual(failed(byId['INV-1002']!), ['bank_details_match']);

  assert.equal(decide(byId['INV-1003']!, LIMIT), 'blocked');
  assert.deepEqual(failed(byId['INV-1003']!), ['iban_checksum', 'bank_details_match']);

  assert.equal(decide(byId['INV-1004']!, LIMIT), 'needs_approval');
  assert.deepEqual(failed(byId['INV-1004']!), []);

  assert.equal(decide(byId['INV-1005']!, LIMIT), 'blocked');
  assert.deepEqual(failed(byId['INV-1005']!), ['not_duplicate']);

  assert.equal(decide(byId['INV-1006']!, LIMIT), 'ready');
});

test('auditor review or agent error blocks an otherwise clean case', () => {
  const clean = runBatch().find((c) => c.doc.id === 'INV-1006')!;
  assert.equal(
    decide({ ...clean, audit: { verdict: 'review', issues: [] } }, LIMIT),
    'blocked'
  );
  assert.equal(decide({ ...clean, errors: ['timeout'] }, LIMIT), 'blocked');
  const { audit: _audit, ...noAudit } = clean;
  assert.equal(decide(noAudit, LIMIT), 'blocked');
});
