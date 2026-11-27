import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

import { numbersIn, parseInvoice, parseNote, verifyInvoice, verifyNote } from '../src/documents.js';
import { idealInvoice, idealNote, readDoc } from './ideal.js';

const files = readdirSync(new URL('../data/text/', import.meta.url));
const invoices = files.filter((f) => f.startsWith('faktura-'));
const notes = files.filter((f) => f.startsWith('otpremnica-'));

test('numbersIn reads table rows column by column', () => {
  assert.deepEqual(numbersIn('1. OPT-CC-025 Coca-Cola 0,25 l staklo 96 kom 79,00 0% 20 9.100,80'), [0.25, 96, 79, 0, 20, 9100.8]);
  assert.deepEqual(numbersIn('Za uplatu RSD: 33.408,00'), [33408]);
});

test('all 7 invoices and 7 delivery notes are present', () => {
  assert.equal(invoices.length, 7);
  assert.equal(notes.length, 7);
});

test('a correct extraction of every document verifies (no false holds)', () => {
  for (const f of invoices) {
    const doc = idealInvoice(readDoc(f));
    assert.ok(doc.lines.length >= 4, f);
    assert.deepEqual(verifyInvoice(doc, readDoc(f)), [], f);
  }
  for (const f of notes) {
    const doc = idealNote(readDoc(f));
    assert.ok(doc.lines.length >= 4, f);
    assert.deepEqual(verifyNote(doc, readDoc(f)), [], f);
  }
});

test('answers round-trip through the parsers', () => {
  const inv = idealInvoice(readDoc('faktura-04-sokovi.txt'));
  const parsed = parseInvoice('```json\n' + JSON.stringify(inv) + '\n```');
  assert.ok(parsed.ok);
  if (parsed.ok) assert.deepEqual(parsed.value, inv);
  const note = idealNote(readDoc('otpremnica-03-zamka-kolicina-rok.txt'));
  const parsedNote = parseNote(JSON.stringify(note));
  assert.ok(parsedNote.ok);
  if (parsedNote.ok) assert.equal(parsedNote.value.lines[1]!.expiryDate, '2026-11-20');
  assert.equal(parseInvoice('{"lines": []}').ok, false);
});

test('altered or invented values are rejected', () => {
  const text = readDoc('faktura-04-sokovi.txt');
  const doc = idealInvoice(text);
  const cheaper = { ...doc, lines: doc.lines.map((l, i) => (i === 0 ? { ...l, unitPrice: 72 } : l)) };
  assert.match(verifyInvoice(cheaper, text).join(), /lines\[0\] OPT-CC-025: 72 not printed/);
  const foreign = { ...doc, totalAmount: { value: 33408, quote: 'Za uplatu RSD: 33.408,01' } };
  assert.match(verifyInvoice(foreign, text).join(), /totalAmount: quote .* not found/);
  // "1" appears in the row ("1 l") but not as a price: still rejected.
  const milk = readDoc('faktura-06-mleko.txt');
  const milkDoc = idealInvoice(milk);
  const lying = { ...milkDoc, lines: milkDoc.lines.map((l, i) => (i === 1 ? { ...l, unitPrice: 1 } : l)) };
  assert.match(verifyInvoice(lying, milk).join(), /lines\[1\] MD-MB-3510: 1 not printed/);
  const wrongPib = { ...doc, supplierPib: { value: '100000099', quote: 'PIB: 100000050' } };
  assert.match(verifyInvoice(wrongPib, text).join(), /supplierPib/);
});
