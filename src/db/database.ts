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
//   - potvrdio records who confirmed a receipt (peer name and id).
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
`;

/** Opens (and if needed creates) the database. Pass ':memory:' for a throwaway one in tests. */
export function openDatabase(file: string = DEFAULT_DB_FILE): DatabaseSync {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
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
