import type { DatabaseSync } from 'node:sqlite';

export type FindingType = 'KOLICINA' | 'CENA' | 'ROK' | 'PAD_PRODAJE' | 'PAD_MARZE' | 'MANJAK';

export interface NewFinding {
  agent: string;
  type: FindingType;
  /** For the owner, in Serbian. */
  description: string;
  suggestion: string | null;
  expected: number | null;
  actual: number | null;
  amountWithoutVat: number | null;
  /** Where every number comes from, e.g. "fakture/faktura-05-kafa.pdf:19; PRIJ-OT-2026-01197 stavka 1 ...". */
  source: string;
  documentId: number | null;
  itemId: number | null;
  /** What the finding is about, e.g. "ROK|expired_with_stock|42". The same agent and key are recorded once. */
  key?: string;
}

export interface FindingRow {
  id: number;
  agent: string;
  tip: FindingType;
  opis: string;
  predlog: string | null;
  ocekivano: number | null;
  stvarno: number | null;
  iznos_bez_pdv: number | null;
  izvor: string;
  audit_status: AuditStatus;
  dokument_id: number | null;
  stavka_id: number | null;
  kljuc: string | null;
  audit_napomena: string | null;
  kreirano: string;
}

export type AuditStatus = 'CEKA' | 'POTVRDJEN' | 'ODBIJEN';

/**
 * Saves a finding waiting for the Auditor (audit_status CEKA). The same agent recording the same
 * type of finding for the same document item again gets the stored one back, unless the Auditor
 * rejected it: then the new text and numbers replace it and it waits for the Auditor again.
 */
export function saveFinding(
  db: DatabaseSync,
  f: NewFinding,
): { id: number; created: boolean; resubmitted: boolean } {
  const existing = (
    f.key !== undefined
      ? db.prepare('SELECT id, audit_status FROM nalaz WHERE agent = ? AND kljuc = ?').get(f.agent, f.key)
      : f.itemId !== null
        ? db.prepare('SELECT id, audit_status FROM nalaz WHERE agent = ? AND tip = ? AND stavka_id = ?').get(f.agent, f.type, f.itemId)
        : undefined
  ) as { id: number; audit_status: AuditStatus } | undefined;
  if (existing && existing.audit_status !== 'ODBIJEN') return { id: existing.id, created: false, resubmitted: false };
  if (existing) {
    db.prepare(
      `UPDATE nalaz SET opis = ?, predlog = ?, ocekivano = ?, stvarno = ?, iznos_bez_pdv = ?, izvor = ?,
              audit_status = 'CEKA'
        WHERE id = ?`,
    ).run(f.description, f.suggestion, f.expected, f.actual, f.amountWithoutVat, f.source, existing.id);
    return { id: existing.id, created: false, resubmitted: true };
  }
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO nalaz (agent, tip, opis, predlog, ocekivano, stvarno, iznos_bez_pdv, izvor, dokument_id, stavka_id, kljuc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      f.agent,
      f.type,
      f.description,
      f.suggestion,
      f.expected,
      f.actual,
      f.amountWithoutVat,
      f.source,
      f.documentId,
      f.itemId,
      f.key ?? null,
    );
  return { id: Number(lastInsertRowid), created: true, resubmitted: false };
}

/** Findings with the given audit status, oldest first. */
export function findingsWithStatus(db: DatabaseSync, status: AuditStatus): FindingRow[] {
  return db.prepare('SELECT * FROM nalaz WHERE audit_status = ? ORDER BY id').all(status) as unknown as FindingRow[];
}

export function findingById(db: DatabaseSync, id: number): FindingRow | undefined {
  return db.prepare('SELECT * FROM nalaz WHERE id = ?').get(id) as unknown as FindingRow | undefined;
}

/** The Auditor's verdict on a finding, with its reason. */
export function saveVerdict(db: DatabaseSync, id: number, status: 'POTVRDJEN' | 'ODBIJEN', note: string): void {
  db.prepare('UPDATE nalaz SET audit_status = ?, audit_napomena = ? WHERE id = ?').run(status, note, id);
}

export function findingsByKey(db: DatabaseSync, agent: string, keys: readonly string[]): FindingRow[] {
  if (keys.length === 0) return [];
  return db
    .prepare(`SELECT * FROM nalaz WHERE agent = ? AND kljuc IN (${keys.map(() => '?').join(', ')}) ORDER BY id`)
    .all(agent, ...keys) as unknown as FindingRow[];
}

export function findingsForDocument(db: DatabaseSync, documentId: number, agent?: string): FindingRow[] {
  const rows = agent
    ? db.prepare('SELECT * FROM nalaz WHERE dokument_id = ? AND agent = ? ORDER BY id').all(documentId, agent)
    : db.prepare('SELECT * FROM nalaz WHERE dokument_id = ? ORDER BY id').all(documentId);
  return rows as unknown as FindingRow[];
}
