import { readFileSync } from 'node:fs';
import path from 'node:path';

import { readAgreedPrices } from './purchase-prices.js';

/**
 * Something kept in stock, in the unit it is delivered in: a raw material ("kafa_espresso",
 * delivered as 1 kg packs) or a bottled item ("Fanta pomorandža 0,25 l staklo", delivered per piece).
 */
export interface StockItemDef {
  key: string;
  /** Name as printed on delivery notes. */
  name: string;
  /** Supplier codes a delivery note item may carry for it. */
  codes: string[];
}

/** How much of each stock item one sold article uses, in delivery units. */
export interface Recipes {
  items: Map<string, StockItemDef>;
  componentsOf(articleCode: number): { key: string; perUnit: number }[] | undefined;
  /** The stock item a delivery note item belongs to, by supplier code or by name. */
  stockItemFor(supplierCode: string | null, name: string): StockItemDef | undefined;
}

interface RawMaterial {
  naziv_otpremnica: string;
  jm_normativa: string;
  faktor: number;
  sifre_dobavljaca: string[];
}

type Component =
  | { sirovina: string; kolicina: number; jm: string }
  | { naziv_otpremnica: string; kolicina: number; jm: string };

/**
 * Reads data/normativi.json. Each sold article lists what it uses:
 *   { sirovina: "kafa_espresso", kolicina: 7, jm: "g" }  -> 7 / faktor (1000) of a 1 kg pack
 *   { naziv_otpremnica: "Coca-Cola 0,25 l staklo", kolicina: 1 } -> 1 piece of that delivery item
 */
export function readRecipes(dataDir: string): Recipes {
  const file = JSON.parse(readFileSync(path.join(dataDir, 'normativi.json'), 'utf8')) as {
    sirovine: Record<string, RawMaterial>;
    normativi: { sifra_artikla: number; sastav: Component[] }[];
  };

  const items = new Map<string, StockItemDef>();
  const components = new Map<number, { key: string; perUnit: number }[]>();

  for (const recipe of file.normativi) {
    const list: { key: string; perUnit: number }[] = [];
    for (const c of recipe.sastav) {
      if ('sirovina' in c) {
        const raw = file.sirovine[c.sirovina];
        if (!raw || raw.jm_normativa !== c.jm) continue; // unknown material or unit: not counted
        const key = `sirovina:${c.sirovina}`;
        items.set(key, { key, name: raw.naziv_otpremnica, codes: raw.sifre_dobavljaca });
        list.push({ key, perUnit: c.kolicina / raw.faktor });
      } else {
        const key = `artikal:${c.naziv_otpremnica}`;
        items.set(key, { key, name: c.naziv_otpremnica, codes: [] });
        list.push({ key, perUnit: c.kolicina });
      }
    }
    components.set(recipe.sifra_artikla, list);
  }

  // Bottled items are named in normativi.json, not coded: take their supplier codes from the price
  // list, so a delivery note line is matched by code even if its name was read slightly differently.
  for (const price of readAgreedPrices(path.join(dataDir, 'nabavne_cene.csv'))) {
    const item = items.get(`artikal:${price.name}`);
    if (item && price.supplierCode && !item.codes.includes(price.supplierCode)) item.codes.push(price.supplierCode);
  }

  return {
    items,
    componentsOf: (articleCode) => components.get(articleCode),
    stockItemFor: (supplierCode, name) =>
      [...items.values()].find((i) => (supplierCode !== null && i.codes.includes(supplierCode)) || i.name === name),
  };
}
