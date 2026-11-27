import { parseLocalNumber } from './document-draft.js';

/** What the owner said about one delivery note. */
export interface Confirmation {
  /** Delivery note number, e.g. OT-2026-01197. */
  deliveryNote: string;
  /** Supplier code -> quantity actually received, only for items that differ. */
  corrections: Map<string, number>;
}

export type ParsedConfirmation = { ok: true; value: Confirmation } | { ok: false; error: string };

// Messages here go to the owner in the network, so they are in Serbian.
export const CONFIRMATION_HELP =
  'Napiši "potvrdi <broj otpremnice>", a za stavke koje su stigle u drugoj količini dodaj ' +
  '"<šifra>=<količina>", npr. "potvrdi OT-2026-01197 ZP-ESP-1000=19".';

/**
 * Reads an owner's message such as
 *   "potvrdi OT-2026-01197"                       everything arrived as printed
 *   "potvrdi OT-2026-01197 ZP-ESP-1000=19"         one item arrived in another quantity
 * Returns null when the message is not a confirmation at all.
 */
export function parseConfirmation(text: string): ParsedConfirmation | null {
  const tokens = text.trim().split(/\s+/);
  if (tokens[0]?.toLowerCase() !== 'potvrdi') return null;

  const deliveryNote = tokens[1];
  if (deliveryNote === undefined || deliveryNote.includes('=')) {
    return { ok: false, error: `Nedostaje broj otpremnice. ${CONFIRMATION_HELP}` };
  }

  const corrections = new Map<string, number>();
  for (const token of tokens.slice(2)) {
    const [code, rawQuantity, ...rest] = token.split('=');
    const quantity = rawQuantity === undefined ? null : parseLocalNumber(rawQuantity);
    if (!code || quantity === null || quantity < 0 || rest.length > 0) {
      return { ok: false, error: `"${token}" nije u obliku "<šifra>=<količina>". ${CONFIRMATION_HELP}` };
    }
    if (corrections.has(code)) {
      return { ok: false, error: `${code} je naveden dva puta.` };
    }
    corrections.set(code, quantity);
  }

  return { ok: true, value: { deliveryNote, corrections } };
}
