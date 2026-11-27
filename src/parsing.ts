// Shared helpers for parsing agent JSON answers and checking that every value
// and figure can be traced to a source.

export interface Sourced<T> {
  value: T;
  quote: string;
}

// A short drafted message (claims writer).
export interface Verification {
  subject: string;
  body: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// Models often wrap JSON in prose or code fences; take the outermost object.
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(text.slice(start, end + 1));
}

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function sourced<T>(
  v: unknown,
  field: string,
  isValue: (x: unknown) => x is T
): Sourced<T> {
  if (!isObject(v) || !isValue(v.value) || typeof v.quote !== 'string') {
    throw new Error(`field "${field}" must be { value, quote }`);
  }
  return { value: v.value, quote: v.quote };
}

export const isString = (x: unknown): x is string =>
  typeof x === 'string' && x.trim() !== '';
export const isNumber = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x);

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
export const compact = (s: string) => s.replace(/\s+/g, '').toUpperCase();

export function quoteInSource(quote: string, source: string): boolean {
  return quote.trim() !== '' && squash(source).includes(squash(quote));
}

// Parses amounts written as 1.428,00 / 1,428.00 / 1428.00 / 330,00.
export function amountsIn(text: string): number[] {
  const matches = text.match(/\d[\d.,\s]*\d|\d/g) ?? [];
  return matches.map((m) => {
    const digits = m.replace(/\s/g, '');
    const decimal = /[.,](\d{2})$/.exec(digits);
    const whole = (decimal ? digits.slice(0, -3) : digits).replace(/[.,]/g, '');
    return Number(decimal ? `${whole}.${decimal[1]}` : whole);
  });
}

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;

// YYYY-MM-DD -> also accept DD.MM.YYYY and DD/MM/YYYY in the quote.
export function dateInQuote(iso: string, quote: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [, y, mo, d] = m;
  return [`${d}.${mo}.${y}`, `${d}/${mo}/${y}`, iso].some((f) => quote.includes(f));
}

export function parseVerification(answer: string): Parsed<Verification> {
  try {
    const raw = extractJson(answer);
    if (!isObject(raw) || !isString(raw.subject) || !isString(raw.body)) {
      throw new Error('answer must be { subject, body } with non-empty strings');
    }
    return { ok: true, value: { subject: raw.subject, body: raw.body } };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

// Figures in free text (IBAN-like codes, amounts, numbers with 3+ digits) that
// can't be found in the allowed sources. Used to stop an agent's draft from
// introducing numbers that came from nowhere.
export function unsourcedFigures(text: string, allowed: string): string[] {
  const figure = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b|\d[\d.,]*\d|\d/g;
  const isMoney = (token: string) => /[.,]\d{2}$/.test(token);
  const allowedCompact = compact(allowed);
  // Only amounts written with cents count as money, so "EUR 600,00" can't be
  // excused by a quantity like "Croissants (600)".
  const allowedMoney = (allowed.match(figure) ?? []).filter(isMoney).flatMap(amountsIn);

  return (text.match(figure) ?? []).filter((token) => {
    if ((token.match(/\d/g) ?? []).length < 3) return false; // "5 days", "2 boxes"
    if (allowedCompact.includes(compact(token))) return false;
    if (!isMoney(token)) return true;
    return !amountsIn(token).every((a) => allowedMoney.some((b) => sameAmount(a, b)));
  });
}
