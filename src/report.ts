import { decide, type Decision, type InvoiceCase } from './checks.js';

export const DISCLAIMER =
  'Draft for human review only. Not financial advice. No payment has been sent. All data is synthetic.';

const LABEL: Record<Decision, string> = {
  ready: 'Ready — included in SEPA draft',
  needs_approval: 'Needs human approval — above agent limit',
  blocked: 'Blocked — needs review',
};

const money = (n: number) => `EUR ${n.toFixed(2)}`;
// Quotes can span lines or contain pipes; keep table cells on one line.
const q = (s: string) => `"${s.replace(/\s+/g, ' ').replace(/\|/g, '\\|')}"`;

export function buildReport(
  cases: InvoiceCase[],
  approvalLimit: number,
  draftFile: string | null
): string {
  const lines: string[] = [
    '# Payment run review',
    '',
    `> ${DISCLAIMER}`,
    '',
    `Agent approval limit: ${money(approvalLimit)}. SEPA draft: ${draftFile ?? 'none (no payments ready)'}.`,
    '',
    '| Document | Vendor | Amount | Decision |',
    '| --- | --- | --- | --- |',
  ];

  for (const c of cases) {
    const e = c.extraction;
    lines.push(
      `| ${c.doc.id} (${c.doc.file}) | ${e?.vendorName.value ?? '?'} | ${e ? money(e.totalAmount.value) : '?'} | ${LABEL[decide(c, approvalLimit)]} |`
    );
  }

  for (const c of cases) {
    const e = c.extraction;
    lines.push('', `## ${c.doc.id} — ${LABEL[decide(c, approvalLimit)]}`, '', `Source: \`${c.doc.file}\``, '');

    if (e) {
      lines.push(
        '| Field | Value | Source quote |',
        '| --- | --- | --- |',
        `| Invoice number | ${e.invoiceNumber.value} | ${q(e.invoiceNumber.quote)} |`,
        `| Vendor | ${e.vendorName.value} | ${q(e.vendorName.quote)} |`,
        `| IBAN | ${e.iban.value} | ${q(e.iban.quote)} |`,
        `| BIC | ${e.bic?.value ?? '—'} | ${e.bic ? `${q(e.bic.quote)}` : '—'} |`,
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
  }

  lines.push('', `> ${DISCLAIMER}`, '');
  return lines.join('\n');
}
