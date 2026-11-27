// Accounts payable: three-way match of each supplier invoice against its
// delivery note and the agreed purchase prices, then the payment decision.
// All of this is deterministic; the clerk agents only read the documents.

import { FILES, readText, ref, type Purchase } from './data/load.js';
import { verifyInvoice, verifyNote, type InvoiceDoc, type NoteDoc } from './documents.js';
import { round2 } from './analytics.js';
import { compact } from './parsing.js';

export interface Check {
  name: string;
  ok: boolean;
  blocking: boolean; // a failed blocking check holds the payment
  detail: string;
  impactRsd: number; // amount at stake, incl. VAT (0 if none)
  sources: string[];
}

export interface Claim {
  to: string;
  subject: string;
  body: string;
}

// An earlier version of a case's invoice, kept when the supplier sends a
// corrected invoice: what it was, why it was held, and the claim it got.
export interface Revision {
  version: number;
  invoiceNo: string;
  supplier: string;
  invoicePdf: string;
  decision: Decision;
  problems: string[];
  atStakeRsd: number;
  claim?: Claim;
}

// Shared runtime state: one case per invoice + delivery-note pair.
export interface ApCase {
  id: string; // "04" from faktura-04-…
  invoiceFile: string;
  noteFile: string;
  invoicePdf: string; // the document of record, e.g. data/fakture/faktura-04-….pdf
  invoiceRef: string; // its text layer, as cited in checks, e.g. text/faktura-04-….txt
  version: number; // 1, then +1 for every corrected invoice
  // Set once the supplier sent a corrected invoice: the held original it
  // replaces (agreed lines in the purchase register are keyed by its number).
  corrects?: { invoiceNo: string; pib: string };
  history: Revision[];
  invoiceText: string;
  noteText: string;
  invoice?: InvoiceDoc;
  note?: NoteDoc;
  checks: Check[];
  errors: string[]; // agent failures: unparseable answer, timeout
  claim?: Claim;
  claimError?: string;
  done: boolean;
}

export type Decision = 'ready' | 'approved' | 'needs_approval' | 'held';

export interface Supplier {
  naziv: string;
  pib: string;
  racun: string;
  email: string;
  telefon: string;
}

export interface Master {
  platilac: { naziv: string; pib: string; racun: string };
  dobavljaci: Supplier[];
}

export const loadMaster = (): Master => JSON.parse(readText(FILES.suppliers)) as Master;

const ACCOUNT = /^\d{3}-\d{13}-\d{2}$/;
const SHORT_EXPIRY_DAYS = 7;
const daysFrom = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const withVat = (net: number, vatRate: number) => net * (1 + vatRate / 100);
const money = (n: number) => n.toLocaleString('sr-RS', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Pairs faktura-NN-x.txt with otpremnica-NN-x.txt.
export function loadCases(files: string[]): ApCase[] {
  return files
    .filter((f) => f.startsWith('faktura-'))
    .sort()
    .map((invoiceFile) => {
      const noteFile = invoiceFile.replace(/^faktura-/, 'otpremnica-');
      return {
        id: /faktura-(\d+)/.exec(invoiceFile)![1]!,
        invoiceFile,
        noteFile,
        invoicePdf: `data/fakture/${invoiceFile.replace(/\.txt$/, '.pdf')}`,
        invoiceRef: `text/${invoiceFile}`,
        version: 1,
        history: [],
        invoiceText: readText(`text/${invoiceFile}`),
        noteText: readText(`text/${noteFile}`),
        checks: [],
        errors: [],
        done: false,
      };
    });
}

export const findSupplier = (master: Master, pib: string) => master.dobavljaci.find((s) => s.pib === pib.trim());

export function matchInvoice(c: ApCase, purchases: Purchase[], master: Master): Check[] {
  const inv = c.invoice!;
  const note = c.note!;
  const invSrc = c.invoiceRef;
  const noteSrc = `text/${c.noteFile}`;
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string, sources: string[], impactRsd = 0, blocking = true) =>
    checks.push({ name, ok, blocking, detail, impactRsd: round2(impactRsd), sources });

  const invoiceProblems = verifyInvoice(inv, c.invoiceText);
  const noteProblems = verifyNote(note, c.noteText);
  add('invoice_sources', !invoiceProblems.length, invoiceProblems.join('; ') || 'every extracted value matches a quote in the invoice', [invSrc]);
  add('note_sources', !noteProblems.length, noteProblems.join('; ') || 'every extracted value matches a quote in the delivery note', [noteSrc]);

  const supplier = findSupplier(master, inv.supplierPib.value);
  add('known_supplier', !!supplier, supplier ? `PIB ${inv.supplierPib.value} = ${supplier.naziv}` : `PIB ${inv.supplierPib.value} not in supplier master`, [invSrc, FILES.suppliers]);
  add(
    'bank_account',
    !!supplier && ACCOUNT.test(inv.supplierAccount.value) && inv.supplierAccount.value === supplier.racun,
    supplier ? `invoice account ${inv.supplierAccount.value}, master ${supplier.racun}` : `invoice account ${inv.supplierAccount.value}, no master record`,
    [invSrc, FILES.suppliers]
  );
  add('same_supplier', compact(note.supplierPib.value) === compact(inv.supplierPib.value), `invoice PIB ${inv.supplierPib.value}, delivery note PIB ${note.supplierPib.value}`, [invSrc, noteSrc]);
  add('note_reference', compact(inv.deliveryNote.value) === compact(note.noteNumber.value), `invoice refers to ${inv.deliveryNote.value}, delivery note is ${note.noteNumber.value}`, [invSrc, noteSrc]);

  // A corrected invoice is matched against the agreed lines of the invoice it
  // replaces, and must say on the document which one that is, from the same supplier.
  const registerNo = c.corrects?.invoiceNo ?? inv.invoiceNumber.value;
  if (c.corrects) {
    const earlier = [...new Set([c.corrects.invoiceNo, ...c.history.map((h) => h.invoiceNo)])];
    const named = earlier.find((no) => compact(c.invoiceText).includes(compact(no)));
    const ok = !!named && compact(inv.supplierPib.value) === compact(c.corrects.pib) && !earlier.some((no) => compact(no) === compact(inv.invoiceNumber.value));
    add(
      'replaces_original',
      ok,
      ok
        ? `${inv.invoiceNumber.value} states it replaces ${named}; same supplier PIB ${c.corrects.pib}`
        : `a corrected invoice must have a new number, name the invoice it replaces (${earlier.join(' or ')}) and come from the same supplier (PIB ${c.corrects.pib}); got ${inv.invoiceNumber.value}, PIB ${inv.supplierPib.value}${named ? '' : ', no reference to the original'}`,
      [invSrc]
    );
  }
  const register = purchases.filter((p) => compact(p.invoiceNo) === compact(registerNo));
  add('in_purchase_register', register.length > 0, register.length ? `${register.length} agreed lines for ${registerNo}` : `${registerNo} not in the purchase register`, [FILES.purchases]);

  // Dates are cross-checked, not just found somewhere in the document: the
  // delivery date must be the register's receipt date (it drives the expiry
  // check) and the due date can't be before the issue date.
  if (register[0]) {
    add('delivery_date', note.deliveryDate.value === register[0].date, `delivery note dated ${note.deliveryDate.value}, received ${register[0].date} in the purchase register`, [noteSrc, ref(FILES.purchases, register[0].line)]);
  }
  add('due_date', inv.dueDate.value >= inv.issueDate.value, `issued ${inv.issueDate.value}, due ${inv.dueDate.value}`, [invSrc]);

  for (const line of inv.lines) {
    const delivered = note.lines.find((n) => n.code === line.code);
    const agreed = register.find((p) => p.supplierCode === line.code);
    const lineRef = [invSrc, ...(delivered ? [noteSrc] : []), ...(agreed ? [ref(FILES.purchases, agreed.line)] : [])];
    const label = `${line.code} ${line.name}`;

    if (!delivered) {
      add(`not_delivered ${line.code}`, false, `${label}: invoiced ${line.quantity} ${line.unit} but not on the delivery note`, lineRef, line.lineTotal);
    } else if (delivered.quantity !== line.quantity) {
      add(
        `quantity ${line.code}`,
        false,
        `${label}: invoiced ${line.quantity}, delivered ${delivered.quantity} ${line.unit}`,
        lineRef,
        withVat((line.quantity - delivered.quantity) * line.unitPrice, line.vatRate)
      );
    }

    if (!agreed) {
      add(`no_agreed_price ${line.code}`, false, `${label}: no agreed price in the purchase register`, lineRef);
    } else if (Math.abs(agreed.price - line.unitPrice) >= 0.005) {
      add(
        `price ${line.code}`,
        false,
        `${label}: invoiced ${money(line.unitPrice)}, agreed ${money(agreed.price)} per ${line.unit} (excl. VAT)`,
        lineRef,
        withVat((line.unitPrice - agreed.price) * line.quantity, line.vatRate)
      );
    }

    if (agreed && agreed.vatRate !== line.vatRate) {
      add(`vat_rate ${line.code}`, false, `${label}: invoiced VAT ${line.vatRate}%, register ${agreed.vatRate}%`, lineRef);
    }

    const expected = withVat(line.quantity * line.unitPrice, line.vatRate);
    if (Math.abs(expected - line.lineTotal) > 0.01) {
      add(`line_total ${line.code}`, false, `${label}: ${line.quantity} × ${money(line.unitPrice)} + ${line.vatRate}% VAT = ${money(expected)}, invoice says ${money(line.lineTotal)}`, [invSrc]);
    }

    if (delivered?.expiryDate) {
      const days = daysFrom(note.deliveryDate.value, delivered.expiryDate);
      if (days < 0) {
        add(`expired ${line.code}`, false, `${label}: expired ${delivered.expiryDate}, delivered ${note.deliveryDate.value}`, lineRef, line.lineTotal);
      } else if (days <= SHORT_EXPIRY_DAYS) {
        add(`short_expiry ${line.code}`, false, `${label}: expires ${delivered.expiryDate}, ${days} days after delivery`, lineRef, 0, false);
      }
    }
  }

  for (const n of note.lines) {
    if (!inv.lines.some((l) => l.code === n.code)) {
      add(`not_invoiced ${n.code}`, false, `${n.code} ${n.name}: delivered ${n.quantity} ${n.unit} but not invoiced`, [noteSrc], 0, false);
    }
  }

  const sum = inv.lines.reduce((s, l) => s + l.lineTotal, 0);
  add('invoice_total', Math.abs(sum - inv.totalAmount.value) <= 0.01, `lines ${money(sum)} vs total to pay ${money(inv.totalAmount.value)}`, [invSrc]);
  return checks;
}

export const blockingFailures = (c: ApCase) => c.checks.filter((x) => !x.ok && x.blocking);

// --approve only releases invoices above the agent's limit; it never
// overrides a failed check or an agent error.
export function decide(c: ApCase, limitRsd: number, approved: ReadonlySet<string> = new Set()): Decision {
  if (!c.invoice || !c.note || c.errors.length > 0 || blockingFailures(c).length > 0) return 'held';
  if (c.invoice.totalAmount.value > limitRsd) {
    return approved.has(c.invoice.invoiceNumber.value.toUpperCase()) || approved.has(c.id) ? 'approved' : 'needs_approval';
  }
  return 'ready';
}

export interface MissingDocument {
  invoiceNo: string;
  supplier: string;
  date: string;
  totalInclVat: number;
  sources: string[];
}

// Invoices in the purchase register with no invoice document to check.
export function missingDocuments(purchases: Purchase[], cases: ApCase[]): MissingDocument[] {
  const numbers = [...new Set(purchases.map((p) => p.invoiceNo))];
  return numbers
    .filter((no) => !cases.some((c) => c.invoiceText.includes(no)))
    .map((no) => {
      const rows = purchases.filter((p) => p.invoiceNo === no);
      return {
        invoiceNo: no,
        supplier: rows[0]!.supplier,
        date: rows[0]!.date,
        totalInclVat: round2(rows.reduce((s, p) => s + p.totalInclVat, 0)),
        sources: rows.map((p) => ref(FILES.purchases, p.line)),
      };
    });
}
