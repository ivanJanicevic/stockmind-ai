import type { DatabaseSync } from 'node:sqlite';

import type { DocumentDraft } from '../domain/document-draft.js';
import type { Confirmation } from '../domain/receipt-confirmation.js';
import { inTransaction } from './database.js';

export type DocumentType = 'OTPREMNICA' | 'PRIJEMNICA' | 'ULAZNA_FAKTURA';

export interface DocumentRow {
  id: number;
  broj: string;
  vrsta: DocumentType;
  status: 'NACRT' | 'POTVRDJEN' | 'PROKNJIZEN' | 'ODSTUPANJE';
  datum_dokumenta: string;
  dobavljac: string | null;
  povezani_dokument_id: number | null;
  izvorni_fajl: string | null;
  potvrdio: string | null;
  veza_broj: string | null;
}

export interface ItemRow {
  id: number;
  dokument_id: number;
  redni_broj: number;
  sifra_dobavljaca: string | null;
  naziv: string;
  jm: string | null;
  kolicina: number;
  kolicina_primljena: number | null;
  cena: number | null;
  rok_trajanja: string | null;
  odstupanje: number;
  izvor: string;
}

export function findDocument(db: DatabaseSync, vrsta: DocumentType, broj: string): DocumentRow | undefined {
  return db
    .prepare('SELECT * FROM prometni_dokument WHERE vrsta = ? AND broj = ?')
    .get(vrsta, broj) as unknown as DocumentRow | undefined;
}

/** The document read from a given PDF, e.g. 'otpremnice/otpremnica-05-kafa.pdf'. */
export function findDocumentByFile(db: DatabaseSync, vrsta: DocumentType, file: string): DocumentRow | undefined {
  return db
    .prepare('SELECT * FROM prometni_dokument WHERE vrsta = ? AND izvorni_fajl = ?')
    .get(vrsta, file) as unknown as DocumentRow | undefined;
}

/** A stored delivery note or invoice, back in the shape the Document agent saved it in. */
export function draftFromDatabase(db: DatabaseSync, document: DocumentRow): DocumentDraft {
  return {
    file: document.izvorni_fajl ?? '',
    kind: document.vrsta === 'ULAZNA_FAKTURA' ? 'invoice' : 'delivery_note',
    number: document.broj,
    date: document.datum_dokumenta,
    supplier: document.dobavljac ?? '',
    relatedDocument: document.veza_broj,
    items: documentItems(db, document.id).map((item) => ({
      line: Number(item.izvor.split(':').at(-1)),
      supplierCode: item.sifra_dobavljaca,
      name: item.naziv,
      unit: item.jm,
      quantity: item.kolicina,
      unitPrice: item.cena,
      expiryDate: item.rok_trajanja,
    })),
  };
}

export function documentById(db: DatabaseSync, id: number): DocumentRow | undefined {
  return db.prepare('SELECT * FROM prometni_dokument WHERE id = ?').get(id) as unknown as DocumentRow | undefined;
}

export function itemById(db: DatabaseSync, id: number): ItemRow | undefined {
  return db.prepare('SELECT * FROM stavka_dokumenta WHERE id = ?').get(id) as unknown as ItemRow | undefined;
}

export function documentItems(db: DatabaseSync, documentId: number): ItemRow[] {
  return db
    .prepare('SELECT * FROM stavka_dokumenta WHERE dokument_id = ? ORDER BY redni_broj')
    .all(documentId) as unknown as ItemRow[];
}

/**
 * Stores a delivery note the Document agent read as an OTPREMNICA in status NACRT.
 * Each item keeps its source ("otpremnice/otpremnica-05-kafa.pdf:14").
 * Saving the same delivery note again returns the stored one and changes nothing.
 */
export function saveDeliveryNote(db: DatabaseSync, draft: DocumentDraft): { id: number; created: boolean } {
  if (draft.kind !== 'delivery_note') {
    throw new Error(`${draft.file} is an ${draft.kind}, not a delivery note`);
  }
  return saveDocument(db, 'OTPREMNICA', draft);
}

/**
 * Stores an invoice the Document agent read as an ULAZNA_FAKTURA in status NACRT, with the
 * delivery note it was issued for (veza_broj), so it can be compared with that delivery note's receipt.
 * Saving the same invoice again returns the stored one and changes nothing.
 */
export function saveInvoice(db: DatabaseSync, draft: DocumentDraft): { id: number; created: boolean } {
  if (draft.kind !== 'invoice') {
    throw new Error(`${draft.file} is a ${draft.kind}, not an invoice`);
  }
  return saveDocument(db, 'ULAZNA_FAKTURA', draft);
}

/** Records that one document refers to another (schema: faktura -> prijemnica). */
export function linkDocuments(db: DatabaseSync, documentId: number, linkedDocumentId: number): void {
  db.prepare('UPDATE prometni_dokument SET povezani_dokument_id = ? WHERE id = ?').run(linkedDocumentId, documentId);
}

/** The confirmed receipt for an invoice: PRIJ-<the invoice's delivery note number>, if there is one. */
export function receiptForInvoice(db: DatabaseSync, invoice: DocumentRow): DocumentRow | undefined {
  return invoice.veza_broj ? findDocument(db, 'PRIJEMNICA', `PRIJ-${invoice.veza_broj}`) : undefined;
}

function saveDocument(
  db: DatabaseSync,
  vrsta: 'OTPREMNICA' | 'ULAZNA_FAKTURA',
  draft: DocumentDraft,
): { id: number; created: boolean } {
  const existing = findDocument(db, vrsta, draft.number);
  if (existing) return { id: existing.id, created: false };

  return inTransaction(db, () => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO prometni_dokument (broj, vrsta, status, datum_dokumenta, dobavljac, izvorni_fajl, veza_broj)
         VALUES (?, ?, 'NACRT', ?, ?, ?, ?)`,
      )
      .run(draft.number, vrsta, draft.date, draft.supplier, draft.file, draft.relatedDocument);
    const id = Number(lastInsertRowid);

    const insertItem = db.prepare(
      `INSERT INTO stavka_dokumenta
         (dokument_id, redni_broj, sifra_dobavljaca, naziv, jm, kolicina, cena, rok_trajanja, izvor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    draft.items.forEach((item, i) => {
      insertItem.run(
        id,
        i + 1,
        item.supplierCode,
        item.name,
        item.unit,
        item.quantity,
        item.unitPrice,
        item.expiryDate,
        `${draft.file}:${item.line}`,
      );
    });
    return { id, created: true };
  });
}

export interface ReceiptItem {
  supplierCode: string | null;
  name: string;
  unit: string | null;
  /** Quantity on the delivery note. */
  delivered: number;
  /** Quantity the owner confirmed as received. */
  received: number;
  /** Where the delivered quantity was read: "otpremnice/otpremnica-05-kafa.pdf:14". */
  source: string;
}

export type ReceiptResult =
  | {
      ok: true;
      receiptId: number;
      receiptNumber: string;
      deliveryNote: string;
      items: ReceiptItem[];
      /** Items whose received quantity differs from the delivery note. */
      deviations: ReceiptItem[];
    }
  | { ok: false; error: string };

/**
 * Turns a confirmed delivery note into a PRIJEMNICA in status POTVRDJEN.
 * Every item gets kolicina_primljena: the owner's correction, or the delivery note quantity.
 * The delivery note itself moves from NACRT to POTVRDJEN. All in one transaction.
 */
export function createReceipt(
  db: DatabaseSync,
  confirmation: Confirmation,
  confirmedBy: string,
  today: string = new Date().toISOString().slice(0, 10),
): ReceiptResult {
  const note = findDocument(db, 'OTPREMNICA', confirmation.deliveryNote);
  // Errors go to the owner in the network, so they are in Serbian.
  if (!note) {
    return { ok: false, error: `Otpremnica ${confirmation.deliveryNote} još nije u bazi.` };
  }
  const receiptNumber = `PRIJ-${note.broj}`;
  if (findDocument(db, 'PRIJEMNICA', receiptNumber)) {
    return { ok: false, error: `Otpremnica ${note.broj} je već potvrđena kao ${receiptNumber}.` };
  }

  const noteItems = documentItems(db, note.id);
  for (const code of confirmation.corrections.keys()) {
    const matches = noteItems.filter((item) => item.sifra_dobavljaca === code).length;
    if (matches === 0) return { ok: false, error: `${code} nije na otpremnici ${note.broj}.` };
    if (matches > 1) return { ok: false, error: `${code} je na otpremnici ${note.broj} više puta.` };
  }

  const items: ReceiptItem[] = noteItems.map((item) => ({
    supplierCode: item.sifra_dobavljaca,
    name: item.naziv,
    unit: item.jm,
    delivered: item.kolicina,
    received:
      (item.sifra_dobavljaca !== null ? confirmation.corrections.get(item.sifra_dobavljaca) : undefined) ??
      item.kolicina,
    source: item.izvor,
  }));

  const receiptId = inTransaction(db, () => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO prometni_dokument
           (broj, vrsta, status, datum_dokumenta, dobavljac, povezani_dokument_id, izvorni_fajl, potvrdio)
         VALUES (?, 'PRIJEMNICA', 'POTVRDJEN', ?, ?, ?, ?, ?)`,
      )
      .run(receiptNumber, today, note.dobavljac, note.id, note.izvorni_fajl, confirmedBy);
    const id = Number(lastInsertRowid);

    const insertItem = db.prepare(
      `INSERT INTO stavka_dokumenta
         (dokument_id, redni_broj, sifra_dobavljaca, naziv, jm, kolicina, kolicina_primljena,
          cena, rok_trajanja, odstupanje, izvor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    noteItems.forEach((noteItem, i) => {
      const item = items[i]!;
      insertItem.run(
        id,
        noteItem.redni_broj,
        noteItem.sifra_dobavljaca,
        noteItem.naziv,
        noteItem.jm,
        noteItem.kolicina,
        item.received,
        noteItem.cena,
        noteItem.rok_trajanja,
        item.received === item.delivered ? 0 : 1,
        noteItem.izvor,
      );
    });

    db.prepare(`UPDATE prometni_dokument SET status = 'POTVRDJEN' WHERE id = ?`).run(note.id);
    return id;
  });

  return {
    ok: true,
    receiptId,
    receiptNumber,
    deliveryNote: note.broj,
    items,
    deviations: items.filter((item) => item.received !== item.delivered),
  };
}
