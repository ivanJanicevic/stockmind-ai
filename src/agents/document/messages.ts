import type { ReceiptResult } from '../../db/documents.js';
import { toLocalDate, type DocumentDraft } from '../../domain/document-draft.js';

const printed = (iso: string | null) => (iso ? (toLocalDate(iso) ?? iso) : '');

/** What the Document agent posts in the network for the owner to check against the goods. */
export function deliveryNoteMessage(draft: DocumentDraft): string {
  const lines = draft.items.map((item, i) => {
    const code = item.supplierCode ? `${item.supplierCode} ` : '';
    const unit = item.unit ? ` ${item.unit}` : '';
    const expiry = item.expiryDate ? `, rok ${printed(item.expiryDate)}` : '';
    return `${i + 1}. ${code}${item.name}: ${item.quantity}${unit}${expiry}`;
  });

  const example = draft.items.find((item) => item.supplierCode !== null);
  const correction = example
    ? `\nAko je nešto stiglo u drugoj količini, npr.: potvrdi ${draft.number} ${example.supplierCode}=${Math.max(example.quantity - 1, 0)}`
    : '';

  return (
    `Otpremnica ${draft.number} od ${printed(draft.date)}, ${draft.supplier}, ${draft.items.length} stavki:\n` +
    `${lines.join('\n')}\n` +
    `Izvor: ${draft.file}\n\n` +
    `Ako je sve primljeno kako piše, odgovori: potvrdi ${draft.number}` +
    correction
  );
}

/** The answer after the owner confirmed: what was written to the database. */
export function receiptMessage(result: Extract<ReceiptResult, { ok: true }>, confirmedBy: string): string {
  const head = `Prijemnica ${result.receiptNumber} je upisana u bazu (potvrdio: ${confirmedBy}), ${result.items.length} stavki.`;
  if (result.deviations.length === 0) {
    return `${head}\nSve stavke su primljene kako piše na otpremnici ${result.deliveryNote}.`;
  }
  const deviations = result.deviations.map((d) => {
    const unit = d.unit ? ` ${d.unit}` : '';
    return `- ${d.supplierCode ?? ''} ${d.name}: na otpremnici ${d.delivered}${unit}, primljeno ${d.received}${unit} (${d.source})`;
  });
  return `${head}\nOdstupanja od otpremnice ${result.deliveryNote}:\n${deviations.join('\n')}`;
}
