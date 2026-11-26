import type { SourceDocument } from './data/invoices.js';
import type { Vendor } from './data/vendors.js';
import {
  unverifiedFields,
  type Audit,
  type Extraction,
  type Verification,
} from './parsing.js';

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
  verification?: Verification & { to: string; phone: string };
  verificationError?: string;
  errors: string[]; // agent failures: unparseable answer, timeout
  done: boolean;
}

export type Decision = 'ready' | 'approved' | 'needs_approval' | 'blocked';

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

// Sender domain of an email document ("From: name@domain"), if any.
export function senderDomain(text: string): string | undefined {
  return /^From:.*@([a-z0-9.-]+\.[a-z]{2,})/im.exec(text)?.[1]?.toLowerCase();
}

// Checks that need only this document and the vendor master.
export function caseChecks(
  doc: SourceDocument,
  e: Extraction,
  vendors: Vendor[]
): Check[] {
  const unverified = unverifiedFields(e, doc.text);
  const vendor = findVendor(e.vendorName.value, vendors);
  const lineSum = e.lineItems.reduce((sum, item) => sum + item.amount.value, 0);
  const sender = senderDomain(doc.text);

  const checks: Check[] = [
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

  // Emails only: a lookalike sender domain is a classic payment-fraud signal.
  if (sender) {
    checks.push({
      name: 'sender_domain',
      ok: vendor !== undefined && (sender === vendor.emailDomain || sender.endsWith(`.${vendor.emailDomain}`)),
      detail: vendor
        ? `sent from ${sender}, vendor master domain ${vendor.emailDomain}`
        : `sent from ${sender}, no vendor master record to compare`,
    });
  }

  return checks;
}

// Bank details look wrong or may be fraudulent: confirm with the vendor
// through the contact in the vendor master, never the document's sender.
// Returns the vendor to contact, or undefined if no verification is needed.
const VERIFY_ON = new Set(['iban_checksum', 'bank_details_match', 'sender_domain']);

export function needsVerification(c: InvoiceCase, vendors: Vendor[]): Vendor | undefined {
  if (!c.extraction || !c.checks.some((check) => !check.ok && VERIFY_ON.has(check.name))) {
    return undefined;
  }
  return findVendor(c.extraction.vendorName.value, vendors);
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

// Human approval (--approve) only releases payments above the agent limit;
// it never overrides a failed check or an auditor concern.
export function decide(
  c: InvoiceCase,
  approvalLimit: number,
  approved: ReadonlySet<string> = new Set()
): Decision {
  if (!c.extraction || !c.audit || c.errors.length > 0) return 'blocked';
  if (c.checks.some((check) => !check.ok)) return 'blocked';
  if (c.audit.verdict !== 'ok') return 'blocked';
  if (c.extraction.totalAmount.value > approvalLimit) {
    return approved.has(c.doc.id) ? 'approved' : 'needs_approval';
  }
  return 'ready';
}
