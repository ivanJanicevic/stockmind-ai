export type DocumentKind = 'invoice' | 'delivery_note';

/** One line item read from an invoice or a delivery note. */
export interface DraftItem {
  /** Line number from read_document where this item is printed. */
  line: number;
  supplierCode: string | null;
  name: string;
  /** null when the document prints no unit for this item. */
  unit: string | null;
  quantity: number;
  /** Price per unit without VAT; null when the document has no prices (delivery notes). */
  unitPrice: number | null;
  /** YYYY-MM-DD; null when the document prints no expiry date for this item. */
  expiryDate: string | null;
}

/** What the Document agent read from one PDF, before a person confirms it. */
export interface DocumentDraft {
  file: string;
  kind: DocumentKind;
  number: string;
  /** YYYY-MM-DD */
  date: string;
  supplier: string;
  /** The delivery note on an invoice, the purchase order on a delivery note. */
  relatedDocument: string | null;
  items: DraftItem[];
}

export interface DocumentSource {
  kind: DocumentKind;
  lines: readonly string[];
}

export interface DraftCheck {
  /** Values that are not in the document. Any error means the draft is not saved. */
  errors: string[];
  /** Things a person should look at. The draft is still saved. */
  warnings: string[];
  /** The draft as it will be saved: expiry dates that could not be found are set to null. */
  draft: DocumentDraft;
}

/**
 * Turns whatever the model sent into a DocumentDraft without throwing:
 * a missing optional field becomes null, a missing list becomes empty.
 */
export function normalizeDraft(raw: unknown): DocumentDraft {
  const r = asRecord(raw);
  return {
    file: asText(r.file),
    kind: r.kind === 'delivery_note' ? 'delivery_note' : 'invoice',
    number: asText(r.number),
    date: asText(r.date),
    supplier: asText(r.supplier),
    relatedDocument: asOptionalText(r.relatedDocument),
    items: Array.isArray(r.items) ? r.items.map(normalizeItem) : [],
  };
}

function normalizeItem(raw: unknown): DraftItem {
  const r = asRecord(raw);
  return {
    line: typeof r.line === 'number' ? r.line : Number(r.line),
    supplierCode: asOptionalText(r.supplierCode),
    name: asText(r.name),
    unit: asOptionalText(r.unit),
    quantity: typeof r.quantity === 'number' ? r.quantity : Number(r.quantity),
    unitPrice: typeof r.unitPrice === 'number' ? r.unitPrice : null,
    expiryDate: asOptionalText(r.expiryDate),
  };
}

/**
 * Checks every value in a draft against the document it claims to come from.
 *
 * Errors (draft not saved): a number, code or document number that is not printed where
 * the draft says it is. Warnings (draft saved): an expiry date or unit that could not be
 * matched. A missing unit or expiry date is normal and produces neither.
 */
export function checkDraft(draft: DocumentDraft, source: DocumentSource): DraftCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = source.lines.join('\n');

  if (draft.kind !== source.kind) {
    errors.push(`kind is "${draft.kind}", but ${draft.file} is a ${source.kind}`);
  }
  if (draft.number.trim() === '' || !text.includes(draft.number)) {
    errors.push(`number "${draft.number}" is not printed in ${draft.file}`);
  }

  const date = toLocalDate(draft.date);
  if (date === null) {
    errors.push(`date "${draft.date}" is not a YYYY-MM-DD date`);
  } else if (!text.includes(date)) {
    errors.push(`date ${draft.date} (printed as ${date}) is not in ${draft.file}`);
  }

  if (draft.relatedDocument !== null && !text.includes(draft.relatedDocument)) {
    errors.push(`relatedDocument "${draft.relatedDocument}" is not printed in ${draft.file}`);
  }

  if (draft.items.length === 0) {
    errors.push('items is empty');
  }

  const usedLines = new Set<number>();
  const items = draft.items.map((item, i): DraftItem => {
    const at = `items[${i}] (line ${item.line})`;
    const lineText = Number.isInteger(item.line) ? source.lines[item.line - 1] : undefined;
    if (lineText === undefined) {
      errors.push(`${at}: there is no line ${item.line}; the document has ${source.lines.length} lines`);
      return item;
    }
    if (usedLines.has(item.line)) {
      errors.push(`${at}: line ${item.line} is used by another item`);
    }
    usedLines.add(item.line);

    const tokens = lineText.split(' ');
    const problems: string[] = [];
    if (item.supplierCode !== null && !tokens.includes(item.supplierCode)) {
      problems.push(`supplierCode ${item.supplierCode}`);
    }

    const unitPrinted = item.unit !== null && tokens.some((t) => sameUnit(t, item.unit));
    if (unitPrinted) {
      // The unit is on the line, so the quantity must be the number right next to it.
      if (!quantityNextToUnit(tokens, item.quantity, item.unit!)) {
        problems.push(`quantity ${item.quantity} ${item.unit}`);
      }
    } else {
      // No unit to anchor on: the quantity only has to be printed somewhere on the line.
      if (!tokens.some((t) => sameNumber(parseLocalNumber(t), item.quantity))) {
        problems.push(`quantity ${item.quantity}`);
      }
      if (item.unit !== null) {
        warnings.push(`${at}: unit "${item.unit}" is not printed on that line; check the quantity by hand`);
      }
    }

    if (item.unitPrice !== null && !tokens.some((t) => sameNumber(parseLocalNumber(t), item.unitPrice))) {
      problems.push(`unitPrice ${item.unitPrice}`);
    }
    if (problems.length > 0) {
      errors.push(`${at}: ${problems.join(', ')} not found on that line: "${lineText}"`);
    }

    if (item.expiryDate !== null) {
      const expiry = toLocalDate(item.expiryDate);
      if (expiry === null || !tokens.includes(expiry)) {
        warnings.push(`${at}: expiry date "${item.expiryDate}" is not printed on that line; saved without it`);
        return { ...item, expiryDate: null };
      }
    }
    return item;
  });

  return { errors, warnings, draft: { ...draft, items } };
}

/**
 * Reads a number written the Serbian way: "2.450,00" -> 2450, "0,25" -> 0.25, "96" -> 96.
 * Returns null for anything else ("1.", "0%", "OPT-CC-025").
 */
export function parseLocalNumber(token: string): number | null {
  if (!/^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/.test(token)) return null;
  return Number(token.replace(/\./g, '').replace(',', '.'));
}

/** "2026-11-26" -> "26.11.2026", the way the documents print dates; null if not a real date. */
export function toLocalDate(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  return `${day}.${month}.${year}`;
}

/**
 * The quantity must sit right next to its unit: "22 kom" on invoices, "kom 96" on
 * delivery notes. This keeps "0% 20" (the VAT rate) or "5 g" in a product name from
 * passing as the quantity.
 */
function quantityNextToUnit(tokens: readonly string[], quantity: number, unit: string): boolean {
  return tokens.some((token, i) => {
    if (!sameNumber(parseLocalNumber(token), quantity)) return false;
    return sameUnit(tokens[i + 1], unit) || sameUnit(tokens[i - 1], unit);
  });
}

function sameUnit(token: string | undefined, unit: string | null): boolean {
  return token !== undefined && unit !== null && token.toLowerCase() === unit.toLowerCase();
}

function sameNumber(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && Math.abs(a - b) < 0.005;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
