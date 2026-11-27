import type { DocumentRow } from '../../db/documents.js';
import type { FindingRow } from '../../db/findings.js';

const rsd = new Intl.NumberFormat('sr-RS', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = new Intl.NumberFormat('sr-RS', { maximumFractionDigits: 3 });

/** What the procurement agent posts in the network: its findings for one invoice, with sources. */
export function findingsMessage(invoice: DocumentRow, receipt: DocumentRow, findings: FindingRow[]): string {
  const head =
    `Nabavka: količine na fakturi ${invoice.broj} (${invoice.dobavljac ?? '?'}) poređene sa prijemnicom ` +
    `${receipt.broj}. Nalaza: ${findings.length}.`;
  if (findings.length === 0) return `${head}\nSve fakturisane količine su primljene.`;

  const lines = findings.map((f, i) => {
    const amount = f.iznos_bez_pdv === null ? '' : `, razlika ${rsd.format(f.iznos_bez_pdv)} RSD bez PDV`;
    return (
      `${i + 1}. fakturisano ${number.format(f.stvarno ?? 0)}, primljeno ${number.format(f.ocekivano ?? 0)}${amount}\n` +
      `   ${f.opis}${f.predlog ? ` Predlog: ${f.predlog}` : ''}\n` +
      `   Izvor: ${f.izvor}`
    );
  });
  return `${head}\n${lines.join('\n')}\nNalazi čekaju proveru Auditora. Ovo nije finansijski savet.`;
}
