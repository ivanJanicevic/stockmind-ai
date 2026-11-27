import { extractTextItems } from 'unpdf';

/** Text pieces whose baselines differ by less than this (in PDF points) are on the same line. */
const SAME_LINE_TOLERANCE = 2;

interface Piece {
  str: string;
  x: number;
  y: number;
}

/**
 * Reads a text-based PDF and returns its visible lines, top to bottom, page after page.
 * Pieces on the same baseline are joined left to right with a space, so table cells
 * end up as separate words on one line.
 */
export async function extractPdfLines(bytes: Uint8Array): Promise<string[]> {
  const { items } = await extractTextItems(bytes);
  const lines: string[] = [];
  for (const page of items) {
    lines.push(...groupIntoLines(page));
  }
  return lines;
}

function groupIntoLines(pieces: Piece[]): string[] {
  const visible = pieces.filter((p) => p.str.trim() !== '');
  // PDF y grows upward, so the top of the page has the largest y.
  visible.sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: Piece[][] = [];
  for (const piece of visible) {
    const row = rows.at(-1);
    const first = row?.[0];
    if (row && first && Math.abs(first.y - piece.y) < SAME_LINE_TOLERANCE) {
      row.push(piece);
    } else {
      rows.push([piece]);
    }
  }

  return rows.map((row) =>
    row
      .sort((a, b) => a.x - b.x)
      .map((p) => p.str.trim())
      .join(' ')
      .replace(/\s+/g, ' '),
  );
}

/** Prefixes each line with its 1-based number: "14| Coca-Cola 0,25 l ...". */
export function numberLines(lines: readonly string[]): string {
  return lines.map((text, i) => `${i + 1}| ${text}`).join('\n');
}
