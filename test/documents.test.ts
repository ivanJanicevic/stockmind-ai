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
  assert.match(verifyInvoice(cheaper, text).join(), /OPT-CC-025 Coca-Cola 0,25 l staklo: read 72,00, which is not printed/);
  const foreign = { ...doc, totalAmount: { value: 33408, quote: 'Za uplatu RSD: 33.408,01' } };
  assert.match(verifyInvoice(foreign, text).join(), /Total to pay: the quoted text .* is not on the document/);
  // "1" appears in the row ("1 l") but not as a price: still rejected.
  const milk = readDoc('faktura-06-mleko.txt');
  const milkDoc = idealInvoice(milk);
  const lying = { ...milkDoc, lines: milkDoc.lines.map((l, i) => (i === 1 ? { ...l, unitPrice: 1 } : l)) };
  assert.match(verifyInvoice(lying, milk).join(), /MD-MB-3510 .*: read 1,00, which is not printed/);
  const wrongPib = { ...doc, supplierPib: { value: '100000099', quote: 'PIB: 100000050' } };
  assert.match(verifyInvoice(wrongPib, text).join(), /Supplier PIB/);
});

test('review fixes: shortened, merged or column-shifted quotes are rejected', () => {
  const text = readDoc('otpremnica-03-zamka-kolicina-rok.txt');
  const doc = idealNote(text);
  // Hiding the expiry column by shortening the quote (would let expired goods through).
  const hidden = { ...doc, lines: doc.lines.map((l, i) => (i === 1 ? { ...l, expiryDate: '', quote: '2 MD-MB-1000 Biljni napitak ovas 1 l kom 12' } : l)) };
  assert.match(verifyNote(hidden, text).join(), /not a whole row/);
  // Full row but expiry left empty.
  const empty = { ...doc, lines: doc.lines.map((l, i) => (i === 1 ? { ...l, expiryDate: '' } : l)) };
  assert.match(verifyNote(empty, text).join(), /prints an expiry date but none was read/);

  const beer = readDoc('otpremnica-08-pivo.txt');
  const beerDoc = idealNote(beer);
  // "6 gajbi x 20" in the note column: quantity must be the "kom 120" column.
  const shifted = { ...beerDoc, lines: beerDoc.lines.map((l, i) => (i === 0 ? { ...l, quantity: 20 } : l)) };
  assert.match(verifyNote(shifted, beer).join(), /read quantity "kom 20", the delivery note prints "kom 120"/);
});

test('a pack size read as the unit is explained in plain words', () => {
  // Seen in a real run: "Espresso kafa u zrnu 1 kg … 22 kom" read as name "Espresso kafa u zrnu", unit "kg".
  const text = readDoc('faktura-05-kafa.txt');
  const doc = idealInvoice(text);
  const misread = { ...doc, lines: doc.lines.map((l, i) => (i === 0 ? { ...l, name: 'Espresso kafa u zrnu', unit: 'kg' } : l)) };
  assert.deepEqual(verifyInvoice(misread, text), ['ZP-ESP-1000 Espresso kafa u zrnu: read quantity "22 kg", the invoice prints "22 kom"']);
});

test('review fixes: a plain hyphen for an en dash still matches', () => {
  const text = readDoc('faktura-08-pivo.txt');
  const doc = idealInvoice(text);
  const hyphen = { ...doc, lines: doc.lines.map((l) => ({ ...l, quote: l.quote.replace('–', '-') })) };
  assert.deepEqual(verifyInvoice(hyphen, text), []);
});
