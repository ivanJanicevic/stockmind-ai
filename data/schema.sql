-- StockWise AI - šema baze (PostgreSQL)
-- Bez tabela Placanje i UgovorenaCena; Normativ zadržan (espresso -> kafa, mleko).

CREATE TYPE tip_partnera      AS ENUM ('DOBAVLJAC', 'KUPAC');
CREATE TYPE vrsta_robe        AS ENUM ('SIROVINA', 'PROIZVOD', 'USLUGA');
CREATE TYPE pdv_oznaka        AS ENUM ('Đ', 'E');            -- Đ = 20%, E = 10%
CREATE TYPE vrsta_dokumenta   AS ENUM ('NARUDZBENICA', 'OTPREMNICA', 'PRIJEMNICA',
                                       'ULAZNA_FAKTURA', 'DNEVNI_PROMET', 'OTPIS');
CREATE TYPE status_dokumenta  AS ENUM ('NACRT', 'POTVRDJEN', 'PROKNJIZEN', 'ODSTUPANJE');
CREATE TYPE tip_nalaza        AS ENUM ('KOLICINA', 'CENA', 'ROK', 'PAD_PRODAJE', 'PAD_MARZE', 'MANJAK');
CREATE TYPE audit_status      AS ENUM ('CEKA', 'POTVRDJEN', 'ODBIJEN');
CREATE TYPE status_preporuke  AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
CREATE TYPE prioritet         AS ENUM ('NIZAK', 'SREDNJI', 'VISOK');

-- ===== Šifarnici =====
CREATE TABLE poslovni_partner (
  id          SERIAL PRIMARY KEY,
  naziv       VARCHAR(200) NOT NULL,
  pib         CHAR(9) UNIQUE,
  mb          CHAR(8),
  adresa      VARCHAR(300),
  telefon     VARCHAR(50),
  tip         tip_partnera NOT NULL
);

CREATE TABLE roba_ili_usluga (
  id             SERIAL PRIMARY KEY,
  sifra          VARCHAR(30) NOT NULL UNIQUE,
  gtin           VARCHAR(14),
  naziv          VARCHAR(200) NOT NULL,
  jm             VARCHAR(10) NOT NULL,          -- kom, kg, l
  pdv_oznaka     pdv_oznaka NOT NULL,
  vrsta          vrsta_robe NOT NULL,
  prodajna_cena  NUMERIC(12,2)                  -- samo za proizvode koji se prodaju
);

CREATE TABLE magacin (
  id     SERIAL PRIMARY KEY,
  naziv  VARCHAR(100) NOT NULL
);

-- 1 espresso = 0,007 kg kafe
CREATE TABLE normativ (
  id           SERIAL PRIMARY KEY,
  proizvod_id  INT NOT NULL REFERENCES roba_ili_usluga(id),
  sirovina_id  INT NOT NULL REFERENCES roba_ili_usluga(id),
  kolicina     NUMERIC(12,4) NOT NULL,
  UNIQUE (proizvod_id, sirovina_id)
);

-- ===== Dokumenti =====
CREATE TABLE prometni_dokument (
  id                   SERIAL PRIMARY KEY,
  broj                 VARCHAR(50) NOT NULL,
  vrsta                vrsta_dokumenta NOT NULL,
  status               status_dokumenta NOT NULL DEFAULT 'NACRT',
  datum_dokumenta      DATE NOT NULL,
  datum_knjizenja      TIMESTAMP,
  datum_prometa        DATE,                     -- faktura
  rok_placanja         DATE,                     -- faktura
  nacin_placanja       VARCHAR(30),              -- faktura
  placeno              BOOLEAN DEFAULT FALSE,    -- faktura
  osnovica             NUMERIC(14,2),
  pdv                  NUMERIC(14,2),
  za_uplatu            NUMERIC(14,2),
  partner_id           INT REFERENCES poslovni_partner(id),
  magacin_id           INT NOT NULL REFERENCES magacin(id),
  povezani_dokument_id INT REFERENCES prometni_dokument(id), -- prijemnica->otpremnica, faktura->prijemnica
  izvorni_fajl         VARCHAR(300),
  UNIQUE (vrsta, broj, partner_id)
);

CREATE TABLE stavka_dokumenta (
  id                  SERIAL PRIMARY KEY,
  dokument_id         INT NOT NULL REFERENCES prometni_dokument(id) ON DELETE CASCADE,
  redni_broj          INT NOT NULL,
  roba_id             INT NOT NULL REFERENCES roba_ili_usluga(id),
  kolicina            NUMERIC(12,3) NOT NULL,   -- po dokumentu (otpremnica/faktura/prodaja)
  kolicina_primljena  NUMERIC(12,3),            -- prijemnica: šta je magacioner potvrdio
  preostala_kolicina  NUMERIC(12,3),            -- prijemnica: FIFO po roku
  cena                NUMERIC(12,2),
  rabat_proc          NUMERIC(5,2) DEFAULT 0,
  pdv_proc            NUMERIC(5,2),
  vrednost            NUMERIC(14,2),
  rok_trajanja        DATE,
  odstupanje          BOOLEAN DEFAULT FALSE,
  izvor               VARCHAR(300) NOT NULL,    -- npr. 'faktura-04.pdf, red 1' ili 'promet.csv, red 1905'
  UNIQUE (dokument_id, redni_broj)
);

-- ===== Stanje =====
CREATE TABLE robna_kartica (
  id                        SERIAL PRIMARY KEY,
  roba_id                   INT NOT NULL REFERENCES roba_ili_usluga(id),
  magacin_id                INT NOT NULL REFERENCES magacin(id),
  pocetno_stanje_kolicina   NUMERIC(12,3) NOT NULL DEFAULT 0,
  promet_ulazna_kolicina    NUMERIC(12,3) NOT NULL DEFAULT 0,
  promet_izlazna_kolicina   NUMERIC(12,3) NOT NULL DEFAULT 0,
  ukupna_kolicina           NUMERIC(12,3) NOT NULL DEFAULT 0,
  pocetno_stanje_vrednost   NUMERIC(14,2) NOT NULL DEFAULT 0,
  promet_ulaza_vrednost     NUMERIC(14,2) NOT NULL DEFAULT 0,
  promet_izlaza_vrednost    NUMERIC(14,2) NOT NULL DEFAULT 0,
  ukupna_vrednost           NUMERIC(14,2) NOT NULL DEFAULT 0,
  UNIQUE (roba_id, magacin_id)
);

CREATE TABLE trosak (
  id          SERIAL PRIMARY KEY,
  datum       DATE NOT NULL,
  kategorija  VARCHAR(50) NOT NULL,    -- kirija, struja, plate...
  iznos       NUMERIC(14,2) NOT NULL,
  izvor       VARCHAR(300) NOT NULL    -- 'troskovi.csv, red 12'
);

-- ===== Agenti =====
CREATE TABLE preporuka (
  id              SERIAL PRIMARY KEY,
  problem         TEXT NOT NULL,
  akcija          TEXT NOT NULL,
  procena_efekta  NUMERIC(14,2),
  prioritet       prioritet NOT NULL,
  status          status_preporuke NOT NULL DEFAULT 'PENDING',
  napomena        TEXT NOT NULL DEFAULT 'Ovo nije finansijski savet.',
  kreirano        TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE nalaz (
  id            SERIAL PRIMARY KEY,
  agent         VARCHAR(50) NOT NULL,
  tip           tip_nalaza NOT NULL,
  opis          TEXT NOT NULL,
  ocekivano     NUMERIC(14,3),
  stvarno       NUMERIC(14,3),
  izvor         VARCHAR(300) NOT NULL,
  audit_status  audit_status NOT NULL DEFAULT 'CEKA',
  dokument_id   INT REFERENCES prometni_dokument(id),
  stavka_id     INT REFERENCES stavka_dokumenta(id),
  preporuka_id  INT REFERENCES preporuka(id),
  kreirano      TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE agent_log (
  id        SERIAL PRIMARY KEY,
  agent     VARCHAR(50) NOT NULL,
  vreme     TIMESTAMP NOT NULL DEFAULT now(),
  dogadjaj  VARCHAR(100) NOT NULL,
  ulaz      TEXT,
  izlaz     TEXT
);

-- Upit koji koristi agent za zalihe: šta ističe u narednih 30 dana
-- SELECT r.naziv, s.preostala_kolicina, s.rok_trajanja, s.izvor
-- FROM stavka_dokumenta s
-- JOIN prometni_dokument d ON d.id = s.dokument_id AND d.vrsta = 'PRIJEMNICA'
-- JOIN roba_ili_usluga r ON r.id = s.roba_id
-- WHERE s.preostala_kolicina > 0 AND s.rok_trajanja < CURRENT_DATE + 30
-- ORDER BY s.rok_trajanja;
