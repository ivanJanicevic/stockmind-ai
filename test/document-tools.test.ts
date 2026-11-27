import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import type { Tool } from '@mozaik-ai/core';

import { createDocumentTools } from '../src/agents/document/tools.js';
import {
  checkDraft,
  parseLocalNumber,
  toLocalDate,
  type DocumentDraft,
} from '../src/domain/document-draft.js';

const dataDir = fileURLToPath(new URL('../data', import.meta.url));

function setup() {
  const saved: DocumentDraft[] = [];
  const tools = createDocumentTools({ dataDir, onDraftSaved: (d) => saved.push(d) });
  const tool = (name: string): Tool => {
    const found = tools.find((t) => t.name === name);
    assert.ok(found, `tool ${name} exists`);
    return found;
  };
  return { saved, tool };
}

// faktura-05: the supplier invoiced 22 kg of espresso coffee; the delivery note says 20.
const coffeeInvoice: DocumentDraft = {
  file: 'fakture/faktura-05-kafa.pdf',
  kind: 'invoice',
  number: 'F-ZP-2026-01197',
  date: '2026-11-26',
  supplier: 'Zrno Plus Distribucija d.o.o. (izmišljeno)',
  relatedDocument: 'OT-2026-01197',
  items: [
    {
      line: 19,
      supplierCode: 'ZP-ESP-1000',
      name: 'Espresso kafa u zrnu 1 kg',
      unit: 'kom',
      quantity: 22,
      unitPrice: 2450,
      expiryDate: null,
    },
    {
      line: 24,
      supplierCode: 'ZP-SEC-0005',
      name: 'Šećer u kesicama 5 g',
      unit: 'kut',
      quantity: 4,
      unitPrice: 1600,
      expiryDate: null,
    },
  ],
};

// ---------- number and date formats ----------

test('parseLocalNumber reads numbers as the documents print them', () => {
  assert.equal(parseLocalNumber('2.450,00'), 2450);
  assert.equal(parseLocalNumber('9.100,80'), 9100.8);
  assert.equal(parseLocalNumber('0,25'), 0.25);
  assert.equal(parseLocalNumber('96'), 96);
  assert.equal(parseLocalNumber('1.'), null);
  assert.equal(parseLocalNumber('0%'), null);
  assert.equal(parseLocalNumber('OPT-CC-025'), null);
});

test('toLocalDate turns YYYY-MM-DD into the printed form and rejects bad dates', () => {
  assert.equal(toLocalDate('2026-11-26'), '26.11.2026');
  assert.equal(toLocalDate('2026-02-30'), null);
  assert.equal(toLocalDate('26.11.2026'), null);
});

test('checkDraft does not take a number from the product name as the quantity', () => {
  const lines = ['6. ZP-SEC-0005 Šećer u kesicama 5 g 4 kut 1.600,00 0% 10 7.040,00'];
  const draft: DocumentDraft = {
    ...coffeeInvoice,
    items: [{ ...coffeeInvoice.items[1]!, line: 1, quantity: 5 }],
  };
  const { errors } = checkDraft(draft, { kind: 'invoice', lines });
  assert.ok(errors.some((e) => e.includes('quantity 5 kut')), errors.join('\n'));
});

// ---------- list_documents ----------

test('list_documents lists every invoice and delivery note PDF with its kind', async () => {
  const { tool } = setup();
  const result = (await tool('list_documents').invoke({})) as { documents: { file: string; kind: string }[] };
  // Gemini rejects a tool result that is a JSON list, so it must be an object.
  assert.ok(!Array.isArray(result));
  const docs = result.documents;

  assert.equal(docs.filter((d) => d.kind === 'invoice').length, 7);
  assert.equal(docs.filter((d) => d.kind === 'delivery_note').length, 7);
  assert.deepEqual(
    docs.find((d) => d.file === 'fakture/faktura-04-sokovi.pdf'),
    { file: 'fakture/faktura-04-sokovi.pdf', kind: 'invoice' },
  );
});

// ---------- read_document ----------

test('read_document returns numbered lines, with Coca-Cola at 79,00 on line 19', async () => {
  const { tool } = setup();
  const text = (await tool('read_document').invoke({ file: 'fakture/faktura-04-sokovi.pdf' })) as string;

  assert.match(text, /^File: fakture\/faktura-04-sokovi\.pdf \(invoice, \d+ lines\)/);
  assert.ok(text.includes('\n19| 1. OPT-CC-025 Coca-Cola 0,25 l staklo 96 kom 79,00 '), text);
});

test('read_document refuses files that list_documents did not return', async () => {
  const { tool } = setup();
  await assert.rejects(tool('read_document').invoke({ file: '../package.json' }), /Unknown document/);
  await assert.rejects(
    tool('read_document').invoke({ file: 'fakture/../../package.json' }),
    /Unknown document/,
  );
});

// ---------- save_document_draft ----------

test('save_document_draft saves a draft whose values are all on the stated lines', async () => {
  const { saved, tool } = setup();
  const result = await tool('save_document_draft').invoke(coffeeInvoice);

  assert.deepEqual(result, {
    saved: true,
    file: coffeeInvoice.file,
    number: 'F-ZP-2026-01197',
    items: 2,
    warnings: [],
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0]!.items[0]!.quantity, 22);
});

// Line 19 is "1. ZP-ESP-1000 Espresso kafa u zrnu 1 kg 22 kom 2.450,00 0% 20 64.680,00":
// 20 is printed, but as the VAT rate, not next to "kom".
test('save_document_draft rejects a quantity that is only printed as the VAT rate', async () => {
  const { saved, tool } = setup();
  const draft: DocumentDraft = {
    ...coffeeInvoice,
    items: [{ ...coffeeInvoice.items[0]!, quantity: 20 }],
  };
  const result = (await tool('save_document_draft').invoke(draft)) as { saved: boolean; errors: string[] };

  assert.equal(result.saved, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]!, /items\[0\] \(line 19\): quantity 20 kom not found on that line/);
  assert.equal(saved.length, 0);
});

test('save_document_draft checks the header: kind, number and date', async () => {
  const { tool } = setup();
  const draft: DocumentDraft = {
    ...coffeeInvoice,
    kind: 'delivery_note',
    number: 'F-ZP-2026-99999',
    date: '2026-11-27',
  };
  const result = (await tool('save_document_draft').invoke(draft)) as { saved: boolean; errors: string[] };

  assert.equal(result.saved, false);
  assert.equal(result.errors.length, 3, result.errors.join('\n'));
});

// otpremnica-04, line 16: "3 OPT-FA-025 Fanta pomorandža 0,25 l staklo kom 48 18.12.2026 2 gajbe x 24"
const fantaNote: DocumentDraft = {
  file: 'otpremnice/otpremnica-04-sokovi.pdf',
  kind: 'delivery_note',
  number: 'OPT-2026-11-0931',
  date: '2026-11-26',
  supplier: 'Osvežavajuća Pića Trade d.o.o. (izmišljeno)',
  relatedDocument: 'NAR-PS-2026-0420',
  items: [
    {
      line: 16,
      supplierCode: 'OPT-FA-025',
      name: 'Fanta pomorandža 0,25 l staklo',
      unit: 'kom',
      quantity: 48,
      unitPrice: null,
      expiryDate: '2026-12-18',
    },
  ],
};

test('save_document_draft reads expiry dates from a delivery note', async () => {
  const { saved, tool } = setup();
  const ok = await tool('save_document_draft').invoke(fantaNote);
  assert.deepEqual(ok, {
    saved: true,
    file: fantaNote.file,
    number: 'OPT-2026-11-0931',
    items: 1,
    warnings: [],
  });
  assert.equal(saved[0]!.items[0]!.expiryDate, '2026-12-18');
});

test('save_document_draft keeps an item whose expiry date is wrong, without the date', async () => {
  const { saved, tool } = setup();
  const result = (await tool('save_document_draft').invoke({
    ...fantaNote,
    items: [{ ...fantaNote.items[0]!, expiryDate: '2027-12-18' }],
  })) as { saved: boolean; warnings: string[] };

  assert.equal(result.saved, true);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /expiry date "2027-12-18" is not printed on that line/);
  assert.equal(saved[0]!.items[0]!.expiryDate, null);
});

test('save_document_draft accepts an item with no unit and no expiry date', async () => {
  const { saved, tool } = setup();
  const { unit: _unit, expiryDate: _expiry, ...withoutOptional } = fantaNote.items[0]!;
  const result = (await tool('save_document_draft').invoke({
    ...fantaNote,
    items: [withoutOptional], // the model left both fields out entirely
  })) as { saved: boolean; warnings: string[] };

  assert.equal(result.saved, true);
  assert.deepEqual(result.warnings, []);
  assert.equal(saved[0]!.items[0]!.unit, null);
  assert.equal(saved[0]!.items[0]!.expiryDate, null);
});

test('save_document_draft saves with a warning when the unit is not printed on the line', async () => {
  const { saved, tool } = setup();
  const result = (await tool('save_document_draft').invoke({
    ...fantaNote,
    items: [{ ...fantaNote.items[0]!, unit: 'gajba' }],
  })) as { saved: boolean; warnings: string[] };

  assert.equal(result.saved, true);
  assert.match(result.warnings[0]!, /unit "gajba" is not printed on that line/);
  assert.equal(saved.length, 1);
});
