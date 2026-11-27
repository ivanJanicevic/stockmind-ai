import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { pdfText } from '../src/pdf.js';
import { squash } from '../src/parsing.js';

const DATA = new URL('../data/', import.meta.url);
const pdfs = (dir: string) => readdirSync(new URL(`${dir}/`, DATA)).filter((f) => f.endsWith('.pdf'));
const extract = (path: string) => pdfText(readFileSync(new URL(path, DATA)));
const lineSet = (text: string) => new Set(text.split('\n').map(squash));

// data/text/*.txt is the text layer macOS PDFKit gives for the same PDFs.
test('invoice PDFs: the extractor gives the same lines as the committed text layer', () => {
  for (const f of pdfs('fakture')) {
    const got = lineSet(extract(`fakture/${f}`));
    const want = readFileSync(new URL(`text/${f.replace('.pdf', '.txt')}`, DATA), 'utf8').split('\n').map(squash).filter(Boolean);
    assert.deepEqual(want.filter((l) => !got.has(l)), [], f);
  }
});

test('delivery-note PDFs: every table row comes out as one whole line', () => {
  for (const f of pdfs('otpremnice')) {
    const got = lineSet(extract(`otpremnice/${f}`));
    const rows = readFileSync(new URL(`text/${f.replace('.pdf', '.txt')}`, DATA), 'utf8').split('\n').map(squash).filter((l) => /^\d+ [A-Z]{2,}-/.test(l));
    assert.ok(rows.length > 0, f);
    assert.deepEqual(rows.filter((l) => !got.has(l)), [], f);
  }
});

test('the sample corrected invoice reads as the corrected document', () => {
  const text = extract('korekcije/faktura-07-sokovi-dopuna-korekcija.pdf');
  assert.match(text, /^Korigovani račun – zamenjuje račun br\. F-OPT-2026-0988 od 28\.11\.2026$/m);
  assert.match(text, /^Račun broj: F-OPT-2026-1003$/m);
  assert.match(text, /^3\. OPT-SP-025 Sprite 0,25 l staklo 48 kom 70,00 0% 20 4\.032,00$/m);
  assert.match(text, /^Za uplatu RSD: 26\.380,80$/m);
});

test('not a PDF, or a PDF without text, gives an error or no text', () => {
  assert.throws(() => pdfText(Buffer.from('hello')), /not a PDF/);
  assert.equal(pdfText(Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF')), '');
});
