import { test } from 'node:test';
import assert from 'node:assert/strict';

import { amountsIn, dateInQuote, extractJson, parseVerification, quoteInSource, unsourcedFigures } from '../src/parsing.js';
import { readDoc } from './ideal.js';

const invoice04 = readDoc('faktura-04-sokovi.txt');
const note03 = readDoc('otpremnica-03-zamka-kolicina-rok.txt');

test('amountsIn reads Serbian and English formats', () => {
  assert.deepEqual(amountsIn('33.408,00'), [33408]);
  assert.deepEqual(amountsIn('1,428.00'), [1428]);
  assert.deepEqual(amountsIn('806,40'), [806.4]);
});

test('quoteInSource ignores whitespace differences only', () => {
  assert.equal(quoteInSource('Za uplatu   RSD: 33.408,00', invoice04), true);
  assert.equal(quoteInSource('Za uplatu RSD: 33.480,00', invoice04), false);
  assert.equal(quoteInSource('', invoice04), false);
});

test('dateInQuote accepts the printed Serbian date', () => {
  assert.equal(dateInQuote('2026-11-20', '2 MD-MB-1000 Biljni napitak ovas 1 l kom 12 20.11.2026'), true);
  assert.equal(dateInQuote('2026-11-21', '20.11.2026'), false);
});

test('extractJson tolerates prose and code fences', () => {
  assert.deepEqual(extractJson('Here:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => extractJson('no json'));
});

test('parseVerification needs subject and body', () => {
  assert.deepEqual(parseVerification('{"subject":"s","body":"b"}'), { ok: true, value: { subject: 's', body: 'b' } });
  assert.equal(parseVerification('{"subject":"s"}').ok, false);
});

test('unsourcedFigures flags only figures missing from the sources', () => {
  const ok = 'Račun F-OPT-2026-0931 na 33.408,00 RSD (33,408.00), Coca-Cola 96 kom po 79,00, rok 11.12.2026.';
  assert.deepEqual(unsourcedFigures(ok, invoice04), []);
  assert.deepEqual(unsourcedFigures('Molimo knjižno odobrenje od 1.500,00 RSD.', invoice04), ['1.500,00']);
});

test('unsourcedFigures does not excuse an amount by a matching quantity', () => {
  // note 03 has "kom 12" and "kom 24" but no money amounts
  assert.deepEqual(unsourcedFigures('Vratićemo 12 komada, odobrenje 12,00 RSD.', note03), ['12,00']);
});

test('review fixes: figures match whole tokens, grouped whole numbers are accepted', () => {
  const invoice05 = readDoc('faktura-05-kafa.txt');
  assert.deepEqual(unsourcedFigures('Odobrenje 4.680,00 RSD.', invoice05), ['4.680,00']); // "64.680,00" is printed
  assert.deepEqual(unsourcedFigures('Iznos 64.680,00 RSD.', invoice05), []);
  assert.deepEqual(unsourcedFigures('Rent up 14,250 RSD (14.250).', '{"delta":14250}'), []);
  assert.deepEqual(unsourcedFigures('Rent up 15,250 RSD.', '{"delta":14250}'), ['15,250']);
});
