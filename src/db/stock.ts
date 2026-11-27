import type { DatabaseSync } from 'node:sqlite';

import type { Lot } from '../domain/stock.js';

/** Every confirmed receipt line, dated by its delivery note (the day the goods came in). */
export function receivedLots(db: DatabaseSync): Lot[] {
  const rows = db
    .prepare(
      `SELECT s.id AS itemId, p.id AS receiptId, p.broj AS receipt, o.broj AS deliveryNote,
              o.datum_dokumenta AS receivedOn, s.sifra_dobavljaca AS supplierCode, s.naziv AS name,
              s.jm AS unit, COALESCE(s.kolicina_primljena, s.kolicina) AS quantity,
              s.rok_trajanja AS expiry, s.izvor AS source
         FROM stavka_dokumenta s
         JOIN prometni_dokument p ON p.id = s.dokument_id AND p.vrsta = 'PRIJEMNICA'
         JOIN prometni_dokument o ON o.id = p.povezani_dokument_id
        ORDER BY o.datum_dokumenta, s.id`,
    )
    .all();
  return rows as unknown as Lot[];
}

/** Delivery notes read into the database but not confirmed yet. */
export function unconfirmedDeliveryNotes(db: DatabaseSync): { number: string; file: string | null }[] {
  return db
    .prepare(
      `SELECT o.broj AS number, o.izvorni_fajl AS file
         FROM prometni_dokument o
        WHERE o.vrsta = 'OTPREMNICA'
          AND NOT EXISTS (SELECT 1 FROM prometni_dokument p WHERE p.vrsta = 'PRIJEMNICA' AND p.povezani_dokument_id = o.id)
        ORDER BY o.broj`,
    )
    .all() as unknown as { number: string; file: string | null }[];
}
