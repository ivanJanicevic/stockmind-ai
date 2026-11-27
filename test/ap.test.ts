import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

import { loadPurchases } from '../src/data/load.js';
import { blockingFailures, decide, loadCases, loadMaster, matchInvoice, missingDocuments, type ApCase } from '../src/ap.js';
import { idealInvoice, idealNote } from './ideal.js';

const purchases = loadPurchases();
const master = loadMaster();
const LIMIT = 50_000;

// What the runtime does once both clerks answered correctly.
function runDesk(): Map<string, ApCase> {
  const cases = loadCases(readdirSync(new URL('../data/text/', import.meta.url)));
  for (const c of cases) {
    c.invoice = idealInvoice(c.invoiceText);
    c.note = idealNote(c.noteText);
    c.checks = matchInvoice(c, purchases, master);
    c.done = true;
  }
  return new Map(cases.map((c) => [c.invoice!.invoiceNumber.value, c]));
}

const failed = (c: ApCase) => blockingFailures(c).map((x) => [x.name, x.impactRsd]);

test('three-way match finds every planted invoice trap', () => {
  const desk = runDesk();
  assert.deepEqual(failed(desk.get('F-ZP-2026-01184')!), []);
  assert.deepEqual(failed(desk.get('F-MD-2026-55271')!), [['expired MD-MB-1000', 3744]]);
  assert.deepEqual(failed(desk.get('F-OPT-2026-0931')!), [['price OPT-CC-025', 806.4]]);
  assert.deepEqual(failed(desk.get('F-ZP-2026-01197')!), [['quantity ZP-ESP-1000', 5880]]);
  assert.deepEqual(failed(desk.get('F-MD-2026-55302')!), []);
  assert.deepEqual(failed(desk.get('F-OPT-2026-0988')!), [['quantity OPT-SP-025', 2016]]);
  assert.deepEqual(failed(desk.get('F-HS-2026-0412')!), [['quantity HS-JL-050', 2880]]);
});

test('short expiry is a warning, not a hold', () => {
  const c = runDesk().get('F-MD-2026-55271')!;
  const warning = c.checks.find((x) => x.name === 'short_expiry MD-SL-0500')!;
  assert.equal(warning.blocking, false);
  assert.match(warning.detail, /3 days after delivery/);
});

test('payment decisions and human approval', () => {
  const desk = runDesk();
  const decisions = Object.fromEntries([...desk].map(([no, c]) => [no, decide(c, LIMIT)]));
  assert.deepEqual(decisions, {
    'F-ZP-2026-01184': 'needs_approval',
    'F-MD-2026-55271': 'held',
    'F-OPT-2026-0931': 'held',
    'F-ZP-2026-01197': 'held',
    'F-MD-2026-55302': 'ready',
    'F-OPT-2026-0988': 'held',
    'F-HS-2026-0412': 'held',
  });
  const approved = new Set(['F-ZP-2026-01184', 'F-ZP-2026-01197']);
  assert.equal(decide(desk.get('F-ZP-2026-01184')!, LIMIT, approved), 'approved');
  assert.equal(decide(desk.get('F-ZP-2026-01197')!, LIMIT, approved), 'held'); // approval can't override a hold
});

test('a wrong bank account or unknown supplier holds the invoice', () => {
  const c = runDesk().get('F-MD-2026-55302')!;
  c.invoice = { ...c.invoice!, supplierAccount: { value: '000-0000000000099-00', quote: 'Tekući račun: 000-0000000000003-00' } };
  assert.ok(failed({ ...c, checks: matchInvoice(c, purchases, master) }).some(([name]) => name === 'bank_account'));
});

test('review fixes: wrong delivery date or due date holds the invoice', () => {
  const c = runDesk().get('F-MD-2026-55271')!;
  c.note = { ...c.note!, deliveryDate: { value: '2026-11-20', quote: '20.11.2026' } };
  assert.ok(failed({ ...c, checks: matchInvoice(c, purchases, master) }).some(([name]) => name === 'delivery_date'));
  const d = runDesk().get('F-MD-2026-55302')!;
  d.invoice = { ...d.invoice!, dueDate: { value: '2026-11-01', quote: '01.11.2026' } };
  assert.ok(failed({ ...d, checks: matchInvoice(d, purchases, master) }).some(([name]) => name === 'due_date'));
});

test('register invoices without a document are reported, not paid', () => {
  const cases = [...runDesk().values()];
  assert.deepEqual(
    missingDocuments(purchases, cases).map((m) => [m.invoiceNo, m.totalInclVat]),
    [['R-47/2026', 8668], ['F-ZP-2026-01262', 44040], ['F-MD-2026-55390', 15523.2]]
  );
});
