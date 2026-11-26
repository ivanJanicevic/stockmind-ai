import type { Decision, InvoiceCase } from './checks.js';
import { findVendor } from './checks.js';
import type { Vendor } from './data/vendors.js';

export const DISCLAIMER =
  'Draft for human review only. Not financial advice. No payment has been sent. All data is synthetic.';

const LABEL: Record<Decision, string> = {
  ready: 'Ready — included in SEPA draft',
  approved: 'Approved by human — included in SEPA draft',
  needs_approval: 'Needs human approval — above agent limit',
  blocked: 'Blocked — needs review',
};

const money = (n: number) => `EUR ${n.toFixed(2)}`;
// Quotes can span lines or contain pipes; keep table cells on one line.
const q = (s: string) => `"${s.replace(/\s+/g, ' ').replace(/\|/g, '\\|')}"`;

export interface ReportOptions {
  approvalLimit: number;
  draftFile: string | null;
  usage?: string;
  vendors: Vendor[];
}

export function buildReport(
  cases: InvoiceCase[],
  decisions: ReadonlyMap<string, Decision>,
  options: ReportOptions
): string {
  const label = (c: InvoiceCase) => LABEL[decisions.get(c.doc.id) ?? 'blocked'];
  // Prefer the vendor master spelling over however the document wrote it.
  const vendorName = (c: InvoiceCase) => {
    const name = c.extraction?.vendorName.value;
    return name ? (findVendor(name, options.vendors)?.name ?? name) : '?';
  };

  const lines: string[] = [
    '# Payment run review',
    '',
    `> ${DISCLAIMER}`,
    '',
    `Agent approval limit: ${money(options.approvalLimit)}. SEPA draft: ${options.draftFile ?? 'none (no payments ready)'}.`,
    ...(options.usage ? ['', `Run: ${options.usage}.`] : []),
    '',
    '| Document | Vendor | Amount | Decision |',
    '| --- | --- | --- | --- |',
  ];

  for (const c of cases) {
    const e = c.extraction;
    lines.push(
      `| ${c.doc.id} (${c.doc.file}) | ${vendorName(c)} | ${e ? money(e.totalAmount.value) : '?'} | ${label(c)} |`
    );
  }

  for (const c of cases) {
    const e = c.extraction;
    lines.push('', `## ${c.doc.id} — ${label(c)}`, '', `Source: \`${c.doc.file}\``, '');

    if (e) {
      lines.push(
        '| Field | Value | Source quote |',
        '| --- | --- | --- |',
        `| Invoice number | ${e.invoiceNumber.value} | ${q(e.invoiceNumber.quote)} |`,
        `| Vendor | ${e.vendorName.value} | ${q(e.vendorName.quote)} |`,
        `| IBAN | ${e.iban.value} | ${q(e.iban.quote)} |`,
        `| BIC | ${e.bic?.value ?? '—'} | ${e.bic ? q(e.bic.quote) : '—'} |`,
        `| Amount | ${money(e.totalAmount.value)} | ${q(e.totalAmount.quote)} |`,
        `| Due date | ${e.dueDate.value} | ${q(e.dueDate.quote)} |`,
        ''
      );
    }

    for (const error of c.errors) lines.push(`- ❌ agent: ${error}`);
    for (const check of c.checks) {
      lines.push(`- ${check.ok ? '✅' : '❌'} ${check.name}: ${check.detail}`);
    }
    if (c.audit) {
      lines.push(`- ${c.audit.verdict === 'ok' ? '✅' : '❌'} auditor verdict: ${c.audit.verdict}`);
      for (const issue of c.audit.issues) {
        lines.push(`  - ${issue.field}: ${issue.problem} (source: ${q(issue.quote)})`);
      }
    }
    if (decisions.get(c.doc.id) === 'approved') {
      lines.push('- 👤 released above the agent limit by a human approver (`--approve`)');
    }

    if (c.verification) {
      lines.push(
        '',
        '### Vendor verification request (draft, not sent)',
        '',
        `To: ${c.verification.to} (vendor master contact, not the document sender) · call-back: ${c.verification.phone}`,
        '',
        `Subject: ${c.verification.subject}`,
        '',
        ...c.verification.body.split('\n').map((line) => `> ${line}`)
      );
    } else if (c.verificationError) {
      lines.push(`- ❌ verifier: ${c.verificationError}`);
    }
  }

  lines.push('', `> ${DISCLAIMER}`, '');
  return lines.join('\n');
}
