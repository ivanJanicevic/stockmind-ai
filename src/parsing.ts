// Parse agent JSON answers and verify every value against its source document.

export interface Sourced<T> {
  value: T;
  quote: string;
}

export interface LineItem {
  description: string;
  amount: Sourced<number>;
}

export interface Extraction {
  invoiceNumber: Sourced<string>;
  vendorName: Sourced<string>;
  iban: Sourced<string>;
  bic: Sourced<string> | null;
  currency: Sourced<string>;
  totalAmount: Sourced<number>;
  dueDate: Sourced<string>; // YYYY-MM-DD
  lineItems: LineItem[];
}

export interface AuditIssue {
  field: string;
  problem: string;
  quote: string;
}

export interface Audit {
  verdict: 'ok' | 'review';
  issues: AuditIssue[];
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// Models often wrap JSON in prose or code fences; take the outermost object.
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(text.slice(start, end + 1));
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function sourced<T>(
  v: unknown,
  field: string,
  isValue: (x: unknown) => x is T
): Sourced<T> {
  if (!isObject(v) || !isValue(v.value) || typeof v.quote !== 'string') {
    throw new Error(`field "${field}" must be { value, quote }`);
  }
  return { value: v.value, quote: v.quote };
}

const isString = (x: unknown): x is string =>
  typeof x === 'string' && x.trim() !== '';
const isNumber = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x);

export function parseExtraction(answer: string): Parsed<Extraction> {
  try {
    const raw = extractJson(answer);
    if (!isObject(raw)) throw new Error('answer is not an object');
    if (!Array.isArray(raw.lineItems)) throw new Error('lineItems must be an array');

    return {
      ok: true,
      value: {
        invoiceNumber: sourced(raw.invoiceNumber, 'invoiceNumber', isString),
        vendorName: sourced(raw.vendorName, 'vendorName', isString),
        iban: sourced(raw.iban, 'iban', isString),
        // A missing BIC may come back as null or as an empty value.
        bic:
          raw.bic == null || (isObject(raw.bic) && raw.bic.value === '')
            ? null
            : sourced(raw.bic, 'bic', isString),
        currency: sourced(raw.currency, 'currency', isString),
        totalAmount: sourced(raw.totalAmount, 'totalAmount', isNumber),
        dueDate: sourced(raw.dueDate, 'dueDate', isString),
        lineItems: raw.lineItems.map((item: unknown, i: number) => {
          if (!isObject(item) || !isString(item.description)) {
            throw new Error(`lineItems[${i}] needs a description`);
          }
          return {
            description: item.description,
            amount: sourced(item.amount, `lineItems[${i}].amount`, isNumber),
          };
        }),
      },
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export function parseAudit(answer: string): Parsed<Audit> {
  try {
    const raw = extractJson(answer);
    if (!isObject(raw)) throw new Error('answer is not an object');
    const verdict = raw.verdict;
    if (verdict !== 'ok' && verdict !== 'review') {
      throw new Error('verdict must be "ok" or "review"');
    }
    if (!Array.isArray(raw.issues)) throw new Error('issues must be an array');

    const issues = raw.issues.map((issue: unknown, i: number) => {
      if (
        !isObject(issue) ||
        typeof issue.field !== 'string' ||
        typeof issue.problem !== 'string' ||
        typeof issue.quote !== 'string'
      ) {
        throw new Error(`issues[${i}] must be { field, problem, quote }`);
      }
      return { field: issue.field, problem: issue.problem, quote: issue.quote };
    });

    return { ok: true, value: { verdict, issues } };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const compact = (s: string) => s.replace(/\s+/g, '').toUpperCase();

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
function dateInQuote(iso: string, quote: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [, y, mo, d] = m;
  return [`${d}.${mo}.${y}`, `${d}/${mo}/${y}`, iso].some((f) => quote.includes(f));
}

// Returns one message per field whose value can't be traced to the document.
export function unverifiedFields(e: Extraction, source: string): string[] {
  const problems: string[] = [];

  const check = (field: string, s: Sourced<unknown>, matches: boolean) => {
    if (!quoteInSource(s.quote, source)) {
      problems.push(`${field}: quote "${s.quote}" not found in document`);
    } else if (!matches) {
      problems.push(`${field}: value "${s.value}" does not match quote "${s.quote}"`);
    }
  };

  const textMatches = (s: Sourced<string>) =>
    compact(s.quote).includes(compact(s.value));
  const amountMatches = (s: Sourced<number>) =>
    amountsIn(s.quote).some((a) => sameAmount(a, s.value));

  check('invoiceNumber', e.invoiceNumber, textMatches(e.invoiceNumber));
  check('vendorName', e.vendorName, textMatches(e.vendorName));
  check('iban', e.iban, textMatches(e.iban));
  if (e.bic) check('bic', e.bic, textMatches(e.bic));
  check('currency', e.currency, textMatches(e.currency));
  check('totalAmount', e.totalAmount, amountMatches(e.totalAmount));
  check('dueDate', e.dueDate, dateInQuote(e.dueDate.value, e.dueDate.quote));
  e.lineItems.forEach((item, i) =>
    check(`lineItems[${i}].amount`, item.amount, amountMatches(item.amount))
  );

  return problems;
}
