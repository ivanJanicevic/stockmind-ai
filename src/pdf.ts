// Text layer of a PDF, with no dependencies (node:zlib only), for documents
// uploaded in the dashboard (a corrected supplier invoice). It handles what
// invoicing tools such as ReportLab write: Flate / ASCII85 streams, fonts with
// a ToUnicode map or WinAnsi encoding, and text placed with Tm / Td / T*.
// Text drawn on the same baseline becomes one line, left to right, so a table
// row comes out as one line like in data/text/*.txt. Anything else (scanned
// images, encrypted files, exotic encodings) yields little or no text, and
// the upload is then rejected: it never reaches the payment decision.

import { inflateSync } from 'node:zlib';

interface PdfObject {
  dict: string;
  stream?: Buffer;
}

function parseObjects(pdf: Buffer): Map<number, PdfObject> {
  const s = pdf.toString('latin1');
  const objects = new Map<number, PdfObject>();
  const re = /(\d+)\s+0\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endobj', start);
    if (end < 0) break;
    const body = s.slice(start, end);
    const at = body.search(/\bstream\r?\n/);
    if (at < 0) {
      objects.set(Number(m[1]), { dict: body });
    } else {
      const dataStart = start + at + (body[at + 6] === '\r' ? 8 : 7);
      const dataEnd = s.lastIndexOf('endstream', end);
      objects.set(Number(m[1]), { dict: body.slice(0, at), stream: pdf.subarray(dataStart, Math.max(dataStart, dataEnd)) });
    }
    re.lastIndex = end;
  }
  return objects;
}

function ascii85(data: Buffer): Buffer {
  const text = data.toString('latin1').replace(/\s/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
  const out: number[] = [];
  let group: number[] = [];
  const flush = (n: number) => {
    let v = 0;
    for (const d of group) v = v * 85 + d;
    out.push(...[v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, n));
  };
  for (const ch of text) {
    if (ch === 'z' && group.length === 0) {
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

function decodeStream(obj: PdfObject): Buffer {
  let data = obj.stream ?? Buffer.alloc(0);
  const filters = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(obj.dict)?.[1]?.match(/\/\w+/g) ?? [];
  for (const f of filters) {
    if (f === '/FlateDecode') data = inflateSync(data);
    else if (f === '/ASCII85Decode') data = ascii85(data);
    else throw new Error(`unsupported PDF filter ${f}`);
  }
  return data;
}

const refOf = (dict: string, key: string) => {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(dict);
  return m ? Number(m[1]) : undefined;
};

// Windows-1252 bytes 0x80-0x9F (the rest of WinAnsi is Latin-1).
const WIN_ANSI: Record<number, string> = { 0x8a: 'Š', 0x8e: 'Ž', 0x9a: 'š', 0x9e: 'ž', 0x84: '„', 0x93: '“', 0x94: '”', 0x96: '–', 0x97: '—', 0x80: '€' };

interface Font {
  bytes: number; // code length
  map: Map<number, string> | undefined; // ToUnicode, if present
}

function parseCMap(text: string): Font {
  const map = new Map<number, string>();
  const hex = (h: string) => parseInt(h, 16);
  const uni = (h: string) => String.fromCodePoint(...(h.match(/.{4}/g) ?? []).map(hex));
  const bytes = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(text)?.[1]?.length ?? 2;
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code, u] of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(hex(code!), uni(u!));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, rest] of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      const list = rest!.startsWith('[') ? [...rest!.matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => x[1]!) : undefined;
      for (let c = hex(lo!); c <= hex(hi!); c++) {
        if (list) map.set(c, uni(list[c - hex(lo!)] ?? ''));
        else map.set(c, String.fromCodePoint(hex(rest!.slice(1, -1)) + c - hex(lo!)));
      }
    }
  }
  return { bytes: bytes / 2, map };
}

function decodeText(raw: Buffer, font: Font | undefined): string {
  if (!font?.map) return [...raw].map((b) => WIN_ANSI[b] ?? String.fromCharCode(b)).join('');
  let out = '';
  for (let i = 0; i + font.bytes <= raw.length; i += font.bytes) {
    const code = font.bytes === 2 ? raw.readUInt16BE(i) : raw[i]!;
    out += font.map.get(code) ?? '';
  }
  return out.replace(/\0/g, '');
}

type Token = { t: 'num'; v: number } | { t: 'str'; v: Buffer } | { t: 'name'; v: string } | { t: 'op'; v: string } | { t: 'arr'; v: Token[] };

function tokenize(src: Buffer): Token[] {
  const s = src.toString('latin1');
  const stack: Token[][] = [[]];
  const push = (tok: Token) => stack[stack.length - 1]!.push(tok);
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) i++;
    else if (ch === '%') while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
    else if (ch === '(') {
      const bytes: number[] = [];
      let depth = 1;
      i++;
      while (i < s.length && depth > 0) {
        const c = s[i]!;
        if (c === '\\') {
          const n = s[i + 1]!;
          const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
          if (n in esc) {
            bytes.push(esc[n]!);
            i += 2;
          } else if (/[0-7]/.test(n)) {
            const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))![0];
            bytes.push(parseInt(oct, 8) & 255);
            i += 1 + oct.length;
          } else if (n === '\r' || n === '\n') {
            i += n === '\r' && s[i + 2] === '\n' ? 3 : 2;
          } else i++;
          continue;
        }
        if (c === '(') depth++;
        if (c === ')' && --depth === 0) break;
        bytes.push(c.charCodeAt(0));
        i++;
      }
      i++;
      push({ t: 'str', v: Buffer.from(bytes) });
    } else if (ch === '<' && s[i + 1] === '<') {
      // inline dictionary (e.g. marked content properties): skip it
      let depth = 0;
      while (i < s.length) {
        if (s.startsWith('<<', i)) {
          depth++;
          i += 2;
        } else if (s.startsWith('>>', i)) {
          i += 2;
          if (--depth === 0) break;
        } else i++;
      }
    } else if (ch === '<') {
      const end = s.indexOf('>', i);
      const hex = s.slice(i + 1, end).replace(/\s/g, '');
      push({ t: 'str', v: Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex') });
      i = end + 1;
    } else if (ch === '[') {
      stack.push([]);
      i++;
    } else if (ch === ']') {
      const arr = stack.pop()!;
      push({ t: 'arr', v: arr });
      i++;
    } else if (ch === '/') {
      const m = /^\/[^\s/[\]()<>{}%]*/.exec(s.slice(i, i + 128))![0];
      push({ t: 'name', v: m.slice(1) });
      i += m.length;
    } else {
      const m = /^[^\s/[\]()<>{}%]+/.exec(s.slice(i, i + 64));
      if (!m) {
        i++;
        continue;
      }
      const word = m[0];
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) push({ t: 'num', v: Number(word) });
      else if (word === 'BI') {
        const end = s.indexOf('EI', i);
        i = end < 0 ? s.length : end + 2; // inline image data: skip
        continue;
      } else push({ t: 'op', v: word });
      i += word.length;
    }
  }
  return stack[0]!;
}

type Matrix = [number, number, number, number, number, number];
const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const ID: Matrix = [1, 0, 0, 1, 0, 0];

interface Run {
  x: number;
  y: number;
  text: string;
  block: number; // BT … ET text object it was drawn in
}

function pageRuns(content: Buffer, fonts: Map<string, Font>): Run[] {
  const runs: Run[] = [];
  const gstack: Matrix[] = [];
  let ctm: Matrix = ID;
  let tm: Matrix = ID;
  let tlm: Matrix = ID;
  let leading = 0;
  let font: Font | undefined;
  let operands: Token[] = [];
  let block = 0;
  const nums = () => operands.filter((o): o is { t: 'num'; v: number } => o.t === 'num').map((o) => o.v);
  const show = (parts: Token[]) => {
    const text = parts.map((p) => (p.t === 'str' ? decodeText(p.v, font) : p.t === 'num' && p.v < -200 ? ' ' : '')).join('');
    if (!text.trim()) return;
    const m = mul(tm, ctm);
    runs.push({ x: m[4], y: m[5], text, block });
  };
  const nextLine = () => {
    tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
    tm = tlm;
  };
  for (const tok of tokenize(content)) {
    if (tok.t !== 'op') {
      operands.push(tok);
      continue;
    }
    const n = nums();
    switch (tok.v) {
      case 'q':
        gstack.push(ctm);
        break;
      case 'Q':
        ctm = gstack.pop() ?? ID;
        break;
      case 'cm':
        if (n.length === 6) ctm = mul(n as Matrix, ctm);
        break;
      case 'BT':
        block++;
        tm = tlm = ID;
        break;
      case 'Tf': {
        const name = operands.find((o) => o.t === 'name');
        font = name ? fonts.get((name as { v: string }).v) : undefined;
        break;
      }
      case 'TL':
        leading = n[0] ?? leading;
        break;
      case 'Tm':
        if (n.length === 6) tm = tlm = n as Matrix;
        break;
      case 'Td':
        tlm = mul([1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0], tlm);
        tm = tlm;
        break;
      case 'TD':
        leading = -(n[1] ?? 0);
        tlm = mul([1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0], tlm);
        tm = tlm;
        break;
      case 'T*':
        nextLine();
        break;
      case 'Tj':
        show(operands.filter((o) => o.t === 'str'));
        break;
      case 'TJ': {
        const arr = operands.find((o) => o.t === 'arr');
        if (arr) show((arr as { v: Token[] }).v);
        break;
      }
      case "'":
        nextLine();
        show(operands.filter((o) => o.t === 'str'));
        break;
      case '"':
        nextLine();
        show(operands.filter((o) => o.t === 'str'));
        break;
    }
    operands = [];
  }
  return runs;
}

// A text object with several lines is a paragraph or a label/value cell (as
// in an invoice header): its lines stay together. Single-line text objects on
// the same baseline (within 1.5 pt), like the cells of a table row, are joined
// left to right into one line. Everything is ordered top to bottom.
function toLines(runs: Run[]): string[] {
  const join = (rs: Run[]) =>
    rs
      .sort((a, b) => a.x - b.x)
      .map((r) => r.text.trim())
      .join(' ')
      .replace(/\s+/g, ' ');
  const byY = (rs: Run[]) => {
    const rows: { y: number; runs: Run[] }[] = [];
    for (const r of [...rs].sort((a, b) => b.y - a.y)) {
      const row = rows.find((x) => Math.abs(x.y - r.y) <= 1.5);
      if (row) row.runs.push(r);
      else rows.push({ y: r.y, runs: [r] });
    }
    return rows;
  };
  const blocks = new Map<number, Run[]>();
  for (const r of runs) blocks.set(r.block, [...(blocks.get(r.block) ?? []), r]);
  const items: { y: number; x: number; lines: string[] }[] = [];
  const single: Run[] = [];
  for (const rs of blocks.values()) {
    const rows = byY(rs);
    if (rows.length > 1) items.push({ y: rows[0]!.y, x: Math.min(...rs.map((r) => r.x)), lines: rows.map((row) => join(row.runs)) });
    else single.push(...rs);
  }
  for (const row of byY(single)) items.push({ y: row.y, x: Math.min(...row.runs.map((r) => r.x)), lines: [join(row.runs)] });
  return items.sort((a, b) => (Math.abs(a.y - b.y) > 1.5 ? b.y - a.y : a.x - b.x)).flatMap((i) => i.lines);
}

export function pdfText(pdf: Buffer): string {
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('not a PDF file');
  const objects = parseObjects(pdf);
  if ([...objects.values()].some((o) => /\/Encrypt\b/.test(o.dict))) throw new Error('encrypted PDFs are not supported');
  const fontCache = new Map<number, Font>();
  const fontOf = (id: number): Font => {
    if (!fontCache.has(id)) {
      const dict = objects.get(id)?.dict ?? '';
      const cmap = refOf(dict, 'ToUnicode');
      const obj = cmap !== undefined ? objects.get(cmap) : undefined;
      fontCache.set(id, obj ? parseCMap(decodeStream(obj).toString('latin1')) : { bytes: 1, map: undefined });
    }
    return fontCache.get(id)!;
  };
  const dictOf = (text: string, key: string): string => {
    // /Key << ... >> inline, or /Key n 0 R
    const ref = refOf(text, key);
    if (ref !== undefined) return objects.get(ref)?.dict ?? '';
    const at = text.search(new RegExp(`/${key}\\s*<<`));
    if (at < 0) return '';
    let depth = 0;
    for (let i = text.indexOf('<<', at); i < text.length; i++) {
      if (text.startsWith('<<', i)) {
        depth++;
        i++;
      } else if (text.startsWith('>>', i)) {
        if (--depth === 0) return text.slice(text.indexOf('<<', at) + 2, i);
        i++;
      }
    }
    return '';
  };
  const pages = [...objects.entries()].filter(([, o]) => /\/Type\s*\/Page\b/.test(o.dict)).sort((a, b) => a[0] - b[0]);
  const lines: string[] = [];
  for (const [, page] of pages) {
    const fonts = new Map<string, Font>();
    const fontDict = dictOf(dictOf(page.dict, 'Resources'), 'Font');
    for (const [, name, id] of fontDict.matchAll(/\/([^\s/<>[\]]+)\s+(\d+)\s+0\s+R/g)) fonts.set(name!, fontOf(Number(id)));
    const contents = /\/Contents\s*(\[[^\]]*\]|\d+\s+0\s+R)/.exec(page.dict)?.[1] ?? '';
    const streams = [...contents.matchAll(/(\d+)\s+0\s+R/g)].map((m) => objects.get(Number(m[1])));
    const content = Buffer.concat(streams.filter((o): o is PdfObject => !!o).map(decodeStream));
    lines.push(...toLines(pageRuns(content, fonts)));
  }
  return lines.join('\n');
}
