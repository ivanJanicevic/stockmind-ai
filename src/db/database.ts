import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** The database file of a run. `out/` is not committed. */
export const DEFAULT_DB_FILE = 'out/stockmind.sqlite';

// The document tables from data/schema.sql, adapted to SQLite. Differences from the
// PostgreSQL schema, kept small on purpose until the product catalog is loaded:
//   - CHECK constraints instead of ENUM types, INTEGER PRIMARY KEY instead of SERIAL;
//   - the supplier is stored by name (dobavljac) instead of a poslovni_partner row;
//   - an item stores the supplier code and name instead of a roba_ili_usluga row;
//   - potvrdio records who confirmed a receipt (peer name and id);
//   - veza_broj is the linked document number as printed (an invoice's delivery note), so an
//     invoice can be matched with its receipt even when the receipt is confirmed later;
//   - nalaz has predlog (suggested action), iznos_bez_pdv (the difference in RSD without VAT),
//     kljuc (what the finding is about, so the same finding is not recorded twice) and
//     audit_napomena (the Auditor's reason for its verdict).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS prometni_dokument (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  broj                 TEXT NOT NULL,
  vrsta                TEXT NOT NULL CHECK (vrsta IN ('NARUDZBENICA', 'OTPREMNICA', 'PRIJEMNICA',
                                                      'ULAZNA_FAKTURA', 'DNEVNI_PROMET', 'OTPIS')),
  status               TEXT NOT NULL DEFAULT 'NACRT'
                         CHECK (status IN ('NACRT', 'POTVRDJEN', 'PROKNJIZEN', 'ODSTUPANJE')),
  datum_dokumenta      TEXT NOT NULL,
  datum_knjizenja      TEXT,
  dobavljac            TEXT,
  povezani_dokument_id INTEGER REFERENCES prometni_dokument(id),
  izvorni_fajl         TEXT,
  potvrdio             TEXT,
  veza_broj            TEXT,
  UNIQUE (vrsta, broj)
);

CREATE TABLE IF NOT EXISTS stavka_dokumenta (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  dokument_id        INTEGER NOT NULL REFERENCES prometni_dokument(id) ON DELETE CASCADE,
  redni_broj         INTEGER NOT NULL,
  sifra_dobavljaca   TEXT,
  naziv              TEXT NOT NULL,
  jm                 TEXT,
  kolicina           REAL NOT NULL,
  kolicina_primljena REAL,
  cena               REAL,
  rok_trajanja       TEXT,
  odstupanje         INTEGER NOT NULL DEFAULT 0,
  izvor              TEXT NOT NULL,
  UNIQUE (dokument_id, redni_broj)
);

CREATE TABLE IF NOT EXISTS nalaz (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agent         TEXT NOT NULL,
  tip           TEXT NOT NULL CHECK (tip IN ('KOLICINA', 'CENA', 'ROK', 'PAD_PRODAJE', 'PAD_MARZE', 'MANJAK')),
  opis          TEXT NOT NULL,
  predlog       TEXT,
  ocekivano     REAL,
  stvarno       REAL,
  iznos_bez_pdv REAL,
  izvor         TEXT NOT NULL,
  audit_status  TEXT NOT NULL DEFAULT 'CEKA' CHECK (audit_status IN ('CEKA', 'POTVRDJEN', 'ODBIJEN')),
  dokument_id   INTEGER REFERENCES prometni_dokument(id),
  stavka_id     INTEGER REFERENCES stavka_dokumenta(id),
  kljuc         TEXT,
  audit_napomena TEXT,
  kreirano      TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/** Columns added after the first version of the schema, for database files made before them. */
const ADDED_COLUMNS: ReadonlyArray<{ table: string; column: string; type: string }> = [
  { table: 'prometni_dokument', column: 'veza_broj', type: 'TEXT' },
  { table: 'nalaz', column: 'kljuc', type: 'TEXT' },
  { table: 'nalaz', column: 'audit_napomena', type: 'TEXT' },
];

/** Opens (and if needed creates) the database. Pass ':memory:' for a throwaway one in tests. */
export function openDatabase(file: string = DEFAULT_DB_FILE): DatabaseSync {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  for (const { table, column, type } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  return db;
}

/** Runs fn inside one transaction: everything is saved, or nothing is. */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
