// Builds the synthetic corrected invoice used to demo the re-check flow:
// data/korekcije/faktura-07-sokovi-dopuna-korekcija.pdf. The supplier
// re-issues F-OPT-2026-0988 (72 Sprite invoiced, 48 delivered) as
// F-OPT-2026-1003 with the delivered quantity. It is the original PDF with its
// text edited, so it keeps the supplier's layout and fonts; every figure is
// recomputed below. Run: npx tsx scripts/make-corrected-invoice.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const SOURCE = 'data/fakture/faktura-07-sokovi-dopuna.pdf';
const TARGET = 'data/korekcije/faktura-07-sokovi-dopuna-korekcija.pdf';

// Sprite: 48 × 70,00 + 20 % VAT = 4.032,00 (was 72 → 6.048,00), so the net
// total drops by 24 × 70,00 = 1.680,00 and the VAT by 336,00.
// Strings are as written in the content stream: "\010" is č and "\002" is š
// in the bold font (F2), "\001" is the en dash.
const EDITS: [from: string, to: string, count: number][] = [
  ['(Ra\\010un broj: F-OPT-2026-0988)', '(Ra\\010un broj: F-OPT-2026-1003)', 1],
  ['(Sprite 0,25 l staklo) Tj T* ET\nQ\nQ\nBT 1 0 0 1 262.2518 64.5 Tm /F3+0 7.5 Tf 9 TL (72)', '(Sprite 0,25 l staklo) Tj T* ET\nQ\nQ\nBT 1 0 0 1 262.2518 64.5 Tm /F3+0 7.5 Tf 9 TL (48)', 1],
  ['(6.048,00)', '(4.032,00)', 1],
  ['(312,00)', '(288,00)', 1],
  ['(23.664,00)', '(21.984,00)', 3],
  ['(4.732,80)', '(4.396,80)', 2],
  ['(28.396,80)', '(26.380,80)', 1],
  ['(dvadesetosamhiljadatristadevedeset\\002est i 80/100 dinara)', '(dvadeset\\002esthiljadatristaosamdeset i 80/100 dinara)', 1],
  ['(Poziv na broj: F-OPT-2026-0988)', '(Poziv na broj: F-OPT-2026-1003)', 1],
  ['(Datum izdavanja:) Tj  T* /F2+0 7.5 Tf 9 TL (28.11.2026)', '(Datum izdavanja:) Tj  T* /F2+0 7.5 Tf 9 TL (01.12.2026)', 1],
  ['(13.12.2026)', '(16.12.2026)', 1],
];
// A new line under the "specimen" title says what this document replaces.
const NOTE = 'BT 1 0 0 1 150 808 Tm /F2+0 9 Tf 10.8 TL (Korigovani ra\\010un \\001 zamenjuje ra\\010un br. F-OPT-2026-0988 od 28.11.2026) Tj T* ET\n';

function ascii85(text: string): Buffer {
  const clean = text.replace(/\s/g, '').replace(/~>$/, '');
  const out: number[] = [];
  let group: number[] = [];
  const flush = (n: number) => {
    let v = 0;
    for (const d of group) v = v * 85 + d;
    out.push(...[v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, n));
  };
  for (const ch of clean) {
    if (ch === 'z' && !group.length) {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) {
      flush(4);
      group = [];
    }
  }
  if (group.length) {
    const n = group.length - 1;
    while (group.length < 5) group.push(84);
    flush(n);
  }
  return Buffer.from(out);
}

const pdf = readFileSync(SOURCE);
const s = pdf.toString('latin1');
const objects = [...s.matchAll(/(\d+) 0 obj\b/g)].map((m) => ({ id: Number(m[1]), start: m.index!, end: s.indexOf('endobj', m.index!) + 'endobj'.length }));
const contentsId = Number(/\/Contents (\d+) 0 R/.exec(s)![1]);
const contents = objects.find((o) => o.id === contentsId)!;
const body = s.slice(contents.start, contents.end);
const head = /stream\r?\n/.exec(body)!;
const raw = body.slice(head.index + head[0].length, body.lastIndexOf('endstream'));
let text = inflateSync(ascii85(raw)).toString('latin1');

for (const [from, to, count] of EDITS) {
  const found = text.split(from).length - 1;
  if (found !== count) throw new Error(`expected ${count}× ${from}, found ${found}`);
  text = text.split(from).join(to);
}
const title = text.indexOf('(PRIMER / SPECIMEN');
const afterTitle = text.indexOf('ET\n', title) + 3;
text = text.slice(0, afterTitle) + '1 0 0 rg\n' + NOTE + text.slice(afterTitle);

const stream = deflateSync(Buffer.from(text, 'latin1'));
const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
const offsets = new Map<number, number>();
let size = parts[0]!.length;
for (const o of objects) {
  offsets.set(o.id, size);
  const chunk =
    o.id === contentsId
      ? Buffer.concat([Buffer.from(`${o.id} 0 obj\n<< /Filter /FlateDecode /Length ${stream.length} >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream\nendobj', 'latin1')])
      : pdf.subarray(o.start, o.end);
  parts.push(chunk, Buffer.from('\n'));
  size += chunk.length + 1;
}
const maxId = Math.max(...objects.map((o) => o.id));
const xref = ['xref', `0 ${maxId + 1}`, '0000000000 65535 f ', ...Array.from({ length: maxId }, (_, i) => `${String(offsets.get(i + 1) ?? 0).padStart(10, '0')} 00000 n `)];
const trailer = /trailer\s*<<([\s\S]*?)>>\s*startxref/.exec(s)![1]!.replace(/\/Size \d+/, `/Size ${maxId + 1}`).replace(/\/Prev \d+/, '');
parts.push(Buffer.from(`${xref.join('\n')}\ntrailer\n<<${trailer}>>\nstartxref\n${size}\n%%EOF\n`, 'latin1'));

mkdirSync('data/korekcije', { recursive: true });
writeFileSync(TARGET, Buffer.concat(parts));
console.log(`wrote ${TARGET}`);
