import type { SourceDocument } from './data/invoices.js';
import type { Vendor } from './data/vendors.js';
import { unverifiedFields, type Audit, type Extraction } from './parsing.js';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

// Shared runtime state: one case per source document, filled in by the agents.
export interface InvoiceCase {
  doc: SourceDocument;
  extraction?: Extraction;
  checks: Check[];
  audit?: Audit;
  errors: string[]; // agent failures: unparseable answer, timeout
  done: boolean;
}

export type Decision = 'ready' | 'needs_approval' | 'blocked';

const compact = (s: string) => s.replace(/\s+/g, '').toUpperCase();

// ISO 13616 mod-97 checksum.
export function ibanChecksumValid(iban: string): boolean {
  const s = compact(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const digits = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55)
  );
  let remainder = 0;
  for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  return remainder === 1;
}

export function findVendor(name: string, vendors: Vendor[]): Vendor | undefined {
  const n = name.trim().toLowerCase();
  return vendors.find((v) => v.name.toLowerCase() === n);
}

const money = (n: number) => n.toFixed(2);

// Checks that need only this document and the vendor master.
export function caseChecks(
  doc: SourceDocument,
  e: Extraction,
  vendors: Vendor[]
): Check[] {
  const unverified = unverifiedFields(e, doc.text);
  const vendor = findVendor(e.vendorName.value, vendors);
  const lineSum = e.lineItems.reduce((sum, item) => sum + item.amount.value, 0);

  return [
    {
      name: 'sources',
      ok: unverified.length === 0,
      detail: unverified.length ? unverified.join('; ') : 'every value matches a quote in the document',
    },
    {
      name: 'iban_checksum',
      ok: ibanChecksumValid(e.iban.value),
      detail: `IBAN ${compact(e.iban.value)}`,
    },
    {
      name: 'currency',
      ok: e.currency.value.toUpperCase() === 'EUR',
      detail: `SEPA credit transfers are EUR only, got ${e.currency.value}`,
    },
    {
      name: 'known_vendor',
      ok: vendor !== undefined,
      detail: vendor ? `matched ${vendor.id}` : `"${e.vendorName.value}" not in vendor master`,
    },
    {
      name: 'bank_details_match',
      ok: vendor !== undefined && compact(vendor.iban) === compact(e.iban.value),
      detail: vendor
        ? `vendor master IBAN ${vendor.iban}, document IBAN ${compact(e.iban.value)}`
        : 'no vendor master record to compare',
    },
    {
      name: 'line_items_total',
      ok: e.lineItems.length > 0 && Math.abs(lineSum - e.totalAmount.value) < 0.005,
      detail: `line items ${money(lineSum)} vs total ${money(e.totalAmount.value)}`,
    },
    {
      name: 'amount_positive',
      ok: e.totalAmount.value > 0,
      detail: `total ${money(e.totalAmount.value)}`,
    },
  ];
}

// Checks across the whole batch; run once all extractions are in.
// Only the later document of a duplicate pair is flagged.
export function addDuplicateChecks(cases: InvoiceCase[]): void {
  const seen = new Map<string, string>();
  for (const c of cases) {
    if (!c.extraction) continue;
    const key = `${c.extraction.vendorName.value.toLowerCase()}|${compact(c.extraction.invoiceNumber.value)}`;
    const first = seen.get(key);
    c.checks.push({
      name: 'not_duplicate',
      ok: first === undefined,
      detail: first
        ? `same vendor and invoice number as ${first}`
        : 'first occurrence in this batch',
    });
    if (!first) seen.set(key, c.doc.id);
  }
}

export function decide(c: InvoiceCase, approvalLimit: number): Decision {
  if (!c.extraction || !c.audit || c.errors.length > 0) return 'blocked';
  if (c.checks.some((check) => !check.ok)) return 'blocked';
  if (c.audit.verdict !== 'ok') return 'blocked';
  if (c.extraction.totalAmount.value > approvalLimit) return 'needs_approval';
  return 'ready';
}
