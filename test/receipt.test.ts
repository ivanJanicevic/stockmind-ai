import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDatabase } from '../src/db/database.js';
import { createReceipt, documentItems, findDocument, saveDeliveryNote } from '../src/db/documents.js';
import type { DocumentDraft } from '../src/domain/document-draft.js';
import { parseConfirmation, type Confirmation } from '../src/domain/receipt-confirmation.js';

const coffeeNote: DocumentDraft = {
  file: 'otpremnice/otpremnica-05-kafa.pdf',
  kind: 'delivery_note',
  number: 'OT-2026-01197',
  date: '2026-11-26',
  supplier: 'Zrno Plus Distribucija d.o.o. (izmišljeno)',
  relatedDocument: null,
  items: [
    {
      line: 14,
      supplierCode: 'ZP-ESP-1000',
      name: 'Espresso kafa u zrnu 1 kg',
      unit: 'kom',
      quantity: 20,
      unitPrice: null,
      expiryDate: '2027-05-31',
    },
    {
      line: 19,
      supplierCode: 'ZP-SEC-0005',
      name: 'Šećer u kesicama 5 g',
      unit: 'kut',
      quantity: 4,
      unitPrice: null,
      expiryDate: null,
    },
  ],
};

const confirm = (text: string): Confirmation => {
  const parsed = parseConfirmation(text);
  assert.ok(parsed?.ok, `"${text}" parses`);
  return parsed.value;
};

// ---------- the owner's message ----------

test('parseConfirmation reads a plain confirmation', () => {
  const parsed = parseConfirmation('potvrdi OT-2026-01197');
  assert.deepEqual(parsed, { ok: true, value: { deliveryNote: 'OT-2026-01197', corrections: new Map() } });
});

test('parseConfirmation reads corrected quantities, also with a decimal comma', () => {
  const value = confirm('Potvrdi HSD-11/2026-0412  HS-JL-050=118 HS-KEG-030=3,5');
  assert.equal(value.deliveryNote, 'HSD-11/2026-0412');
  assert.deepEqual([...value.corrections], [['HS-JL-050', 118], ['HS-KEG-030', 3.5]]);
});

test('parseConfirmation ignores other messages and explains bad ones', () => {
  assert.equal(parseConfirmation('dobar dan'), null);
  assert.equal(parseConfirmation('potvrdi')?.ok, false);
  assert.equal(parseConfirmation('potvrdi OT-1 ZP-ESP-1000=dvadeset')?.ok, false);
  assert.equal(parseConfirmation('potvrdi OT-1 ZP-ESP-1000=19 ZP-ESP-1000=18')?.ok, false);
});

// ---------- delivery note in the database ----------

test('saveDeliveryNote stores the delivery note as a draft, once', () => {
  const db = openDatabase(':memory:');
  const first = saveDeliveryNote(db, coffeeNote);
  const again = saveDeliveryNote(db, coffeeNote);

  assert.equal(first.created, true);
  assert.deepEqual(again, { id: first.id, created: false });

  const note = findDocument(db, 'OTPREMNICA', 'OT-2026-01197')!;
  assert.equal(note.status, 'NACRT');
  const items = documentItems(db, note.id);
  assert.equal(items.length, 2);
  assert.equal(items[0]!.izvor, 'otpremnice/otpremnica-05-kafa.pdf:14');
  assert.equal(items[0]!.rok_trajanja, '2027-05-31');
});

// ---------- receipt ----------

test('createReceipt confirms every item as delivered when nothing is corrected', () => {
  const db = openDatabase(':memory:');
  saveDeliveryNote(db, coffeeNote);

  const result = createReceipt(db, confirm('potvrdi OT-2026-01197'), 'Vlasnik (peer-1)', '2026-11-27');
  assert.ok(result.ok);
  assert.equal(result.receiptNumber, 'PRIJ-OT-2026-01197');
  assert.deepEqual(result.deviations, []);

  const receipt = findDocument(db, 'PRIJEMNICA', 'PRIJ-OT-2026-01197')!;
  assert.equal(receipt.status, 'POTVRDJEN');
  assert.equal(receipt.potvrdio, 'Vlasnik (peer-1)');
  assert.equal(receipt.datum_dokumenta, '2026-11-27');
  assert.equal(receipt.povezani_dokument_id, findDocument(db, 'OTPREMNICA', 'OT-2026-01197')!.id);
  assert.equal(findDocument(db, 'OTPREMNICA', 'OT-2026-01197')!.status, 'POTVRDJEN');

  const items = documentItems(db, receipt.id);
  assert.deepEqual(
    items.map((i) => [i.sifra_dobavljaca, i.kolicina, i.kolicina_primljena, i.odstupanje]),
    [
      ['ZP-ESP-1000', 20, 20, 0],
      ['ZP-SEC-0005', 4, 4, 0],
    ],
  );
});

test('createReceipt records a corrected quantity as a deviation', () => {
  const db = openDatabase(':memory:');
  saveDeliveryNote(db, coffeeNote);

  const result = createReceipt(db, confirm('potvrdi OT-2026-01197 ZP-ESP-1000=19'), 'Vlasnik', '2026-11-27');
  assert.ok(result.ok);
  assert.deepEqual(
    result.deviations.map((d) => [d.supplierCode, d.delivered, d.received, d.source]),
    [['ZP-ESP-1000', 20, 19, 'otpremnice/otpremnica-05-kafa.pdf:14']],
  );
  const items = documentItems(db, result.receiptId);
  assert.equal(items[0]!.kolicina_primljena, 19);
  assert.equal(items[0]!.odstupanje, 1);
});

test('createReceipt refuses unknown notes, unknown codes and a second confirmation', () => {
  const db = openDatabase(':memory:');
  saveDeliveryNote(db, coffeeNote);

  assert.match(errorOf(createReceipt(db, confirm('potvrdi OT-9999'), 'Vlasnik')), /još nije u bazi/);
  assert.match(errorOf(createReceipt(db, confirm('potvrdi OT-2026-01197 XX-1=1'), 'Vlasnik')), /XX-1 nije na/);
  assert.equal(findDocument(db, 'PRIJEMNICA', 'PRIJ-OT-2026-01197'), undefined);

  assert.ok(createReceipt(db, confirm('potvrdi OT-2026-01197'), 'Vlasnik').ok);
  assert.match(errorOf(createReceipt(db, confirm('potvrdi OT-2026-01197'), 'Vlasnik')), /već potvrđena/);
});

function errorOf(result: ReturnType<typeof createReceipt>): string {
  assert.equal(result.ok, false);
  return result.ok ? '' : result.error;
}
