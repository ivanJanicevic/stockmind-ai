// Loads the café dataset in data/ (synthetic, RSD). Every row keeps the line
// number of its source file so any number the app reports can be traced back.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Works from src/data/ (tsx) and dist/data/ (compiled) alike.
export const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));

export const FILES = {
  sales: 'promet_2026-11-26_do_2026-12-25.csv',
  purchases: 'nabavne_cene.csv',
  costs: 'troskovi.csv',
  products: 'artikli.json',
  recipes: 'normativi.json',
  suppliers: 'dobavljaci.json',
  planning: 'planiranje.json', // synthetic planning parameters (optional)
} as const;

export const ref = (file: string, line: number) => `${file}:${line}`;

export function readText(file: string): string {
  return readFileSync(DATA_DIR + file, 'utf8');
}

// Semicolon-separated, header on line 1. `line` is the 1-based file line.
export function readCsv(file: string): { line: number; cells: Record<string, string> }[] {
  const lines = readText(file).replace(/\r/g, '').split('\n');
  const header = lines[0]!.split(';');
  const rows: { line: number; cells: Record<string, string> }[] = [];
  lines.slice(1).forEach((text, i) => {
    if (!text.trim()) return;
    const values = text.split(';');
    rows.push({ line: i + 2, cells: Object.fromEntries(header.map((h, j) => [h, values[j] ?? ''])) });
  });
  return rows;
}

// Serbian number format: "1.428,00" or "2450,00".
export const parseRsd = (s: string) => Number(s.trim().replace(/\./g, '').replace(',', '.'));

export interface Sale {
  line: number;
  date: string;
  time: string;
  receipt: string;
  refund: boolean;
  code: number;
  name: string;
  qty: number;
  unitPrice: number;
  amount: number; // incl. VAT
  vatRate: number;
}

export interface Purchase {
  line: number;
  date: string;
  supplier: string;
  invoiceNo: string;
  noteNo: string;
  supplierCode: string;
  name: string;
  unit: string;
  qty: number;
  price: number; // excl. VAT
  vatRate: number;
  totalInclVat: number;
}

export interface Cost {
  line: number;
  month: string; // YYYY-MM
  category: string;
  net: number; // excl. VAT
}

export interface Product {
  code: number;
  name: string;
  price: number; // incl. VAT
  vatRate: number;
  group: string;
  noteName: string | null;
}

// Something the café buys and uses up: a raw material (beans, milk) or a
// bottled item sold 1:1. `factor` = recipe units per purchased unit.
export interface Material {
  key: string;
  noteName: string;
  unit: string;
  factor: number;
  supplierCodes: string[];
}

export interface Component {
  material: string;
  qty: number;
}

export interface Dataset {
  sales: Sale[];
  purchases: Purchase[];
  costs: Cost[];
  products: Product[];
  materials: Map<string, Material>;
  recipes: Map<number, Component[]>;
}

export function loadSales(): Sale[] {
  return readCsv(FILES.sales).map(({ line, cells: c }) => ({
    line,
    date: c.datum!,
    time: c.vreme!,
    receipt: c.pfr_broj_racuna!,
    refund: /refund/i.test(c.vrsta_racuna!),
    code: Number(c.sifra_artikla),
    name: c.naziv!,
    qty: parseRsd(c.kolicina!),
    unitPrice: parseRsd(c.jed_cena!),
    amount: parseRsd(c.iznos!),
    vatRate: Number(c.pdv_stopa),
  }));
}

export function loadPurchases(): Purchase[] {
  return readCsv(FILES.purchases).map(({ line, cells: c }) => ({
    line,
    date: c.datum!,
    supplier: c.dobavljac!,
    invoiceNo: c.broj_fakture!,
    noteNo: c.veza_otpremnica!,
    supplierCode: c.sifra_dobavljaca!,
    name: c.naziv!,
    unit: c.jm!,
    qty: parseRsd(c.kolicina!),
    price: parseRsd(c.nabavna_cena_bez_pdv!),
    vatRate: Number(c.pdv_stopa),
    totalInclVat: parseRsd(c.iznos_sa_pdv!),
  }));
}

export function loadCosts(): Cost[] {
  return readCsv(FILES.costs).map(({ line, cells: c }) => ({
    line,
    month: c.mesec!,
    category: c.kategorija!,
    net: parseRsd(c.iznos_bez_pdv!),
  }));
}

interface RawProduct {
  sifra: number;
  naziv: string;
  prodajna_cena: number;
  pdv_stopa: number;
  grupa: string;
  veza_otpremnica: string | null;
}

export function loadProducts(): Product[] {
  const raw = JSON.parse(readText(FILES.products)) as { artikli: RawProduct[] };
  return raw.artikli.map((p) => ({
    code: p.sifra,
    name: p.naziv,
    price: p.prodajna_cena,
    vatRate: p.pdv_stopa,
    group: p.grupa,
    noteName: p.veza_otpremnica,
  }));
}

interface RawRecipes {
  sirovine: Record<string, { naziv_otpremnica: string; jm_normativa: string; faktor: number; sifre_dobavljaca: string[] }>;
  normativi: { sifra_artikla: number; sastav: ({ sirovina: string; kolicina: number } | { naziv_otpremnica: string; kolicina: number })[] }[];
}

// Bottled items have no raw-material entry; they are matched to purchases by
// their delivery-note name and consumed 1:1.
export function loadRecipes(purchases: Purchase[]): { materials: Map<string, Material>; recipes: Map<number, Component[]> } {
  const raw = JSON.parse(readText(FILES.recipes)) as RawRecipes;
  const materials = new Map<string, Material>();
  for (const [key, m] of Object.entries(raw.sirovine)) {
    materials.set(key, { key, noteName: m.naziv_otpremnica, unit: m.jm_normativa, factor: m.faktor, supplierCodes: m.sifre_dobavljaca });
  }

  const recipes = new Map<number, Component[]>();
  for (const r of raw.normativi) {
    recipes.set(
      r.sifra_artikla,
      r.sastav.map((part) => {
        if ('sirovina' in part) return { material: part.sirovina, qty: part.kolicina };
        if (!materials.has(part.naziv_otpremnica)) {
          const codes = [...new Set(purchases.filter((p) => p.name === part.naziv_otpremnica).map((p) => p.supplierCode))];
          materials.set(part.naziv_otpremnica, { key: part.naziv_otpremnica, noteName: part.naziv_otpremnica, unit: 'kom', factor: 1, supplierCodes: codes });
        }
        return { material: part.naziv_otpremnica, qty: part.kolicina };
      })
    );
  }
  return { materials, recipes };
}

// Optional synthetic planning parameters (lead times, safety stock). Absent
// file → null, and replenishment reports what is missing instead.
export function loadPlanningParams(): { synthetic: boolean; leadTimeDays: Record<string, number>; safetyStockDays: number; reviewPeriodDays: number } | null {
  if (!existsSync(DATA_DIR + FILES.planning)) return null;
  const raw = JSON.parse(readText(FILES.planning)) as {
    sinteticki_podaci: boolean;
    rok_isporuke_dana: Record<string, number>;
    sigurnosna_zaliha_dana: number;
    period_pregleda_dana: number;
  };
  return {
    synthetic: raw.sinteticki_podaci,
    leadTimeDays: raw.rok_isporuke_dana,
    safetyStockDays: raw.sigurnosna_zaliha_dana,
    reviewPeriodDays: raw.period_pregleda_dana,
  };
}

export function loadDataset(): Dataset {
  const purchases = loadPurchases();
  return { sales: loadSales(), purchases, costs: loadCosts(), products: loadProducts(), ...loadRecipes(purchases) };
}
