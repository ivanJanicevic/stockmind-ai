import type { DocumentRow, ItemRow } from '../db/documents.js';
import { agreedPriceFor, type AgreedPrice } from './purchase-prices.js';

export const PRICE_FILE_NAME = 'data/nabavne_cene.csv';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The code an item is matched by; items without a supplier code are matched by name. */
export const itemKey = (item: { sifra_dobavljaca: string | null; naziv: string }) =>
  item.sifra_dobavljaca ?? item.naziv;

export interface QuantityDifference {
  invoiceItemId: number;
  supplierCode: string;
  name: string;
  unit: string | null;
  /** Quantity on the invoice. */
  invoiced: number;
  /** Quantity confirmed on the receipt (0 if the item is not on it). */
  received: number;
  /** invoiced - received; positive means invoiced more than received. */
  difference: number;
  unitPrice: number | null;
  /** difference x invoiced unit price, RSD without VAT. */
  amountWithoutVat: number | null;
  invoiceSource: string;
  receiptSource: string;
}

/** Invoice lines compared with the confirmed receipt, item by item. */
export function compareQuantities(
  invoiceItems: readonly ItemRow[],
  receipt: DocumentRow,
  receiptItems: readonly ItemRow[],
): { differences: QuantityDifference[]; notInvoiced: { supplierCode: string; name: string; received: number }[] } {
  const differences: QuantityDifference[] = [];
  for (const item of invoiceItems) {
    const match = receiptItems.find((r) => itemKey(r) === itemKey(item));
    const received = match ? (match.kolicina_primljena ?? match.kolicina) : 0;
    if (received === item.kolicina) continue;

    const difference = round2(item.kolicina - received);
    differences.push({
      invoiceItemId: item.id,
      supplierCode: itemKey(item),
      name: item.naziv,
      unit: item.jm,
      invoiced: item.kolicina,
      received,
      difference,
      unitPrice: item.cena,
      amountWithoutVat: item.cena === null ? null : round2(difference * item.cena),
      invoiceSource: item.izvor,
      receiptSource: match
        ? `${receipt.broj} stavka ${match.redni_broj}, potvrdio ${receipt.potvrdio ?? '?'} (otpremnica ${match.izvor})`
        : `${receipt.broj}: stavke nema na prijemnici`,
    });
  }

  const notInvoiced = receiptItems
    .filter((r) => !invoiceItems.some((i) => itemKey(i) === itemKey(r)))
    .map((r) => ({ supplierCode: itemKey(r), name: r.naziv, received: r.kolicina_primljena ?? r.kolicina }));

  return { differences, notInvoiced };
}

export interface PriceDifference {
  invoiceItemId: number;
  supplierCode: string;
  name: string;
  unit: string | null;
  quantity: number;
  invoicedPrice: number;
  agreedPrice: number;
  /** invoicedPrice - agreedPrice per unit. */
  difference: number;
  percent: number;
  /** difference x invoiced quantity, RSD without VAT. */
  amountWithoutVat: number;
  invoiceSource: string;
  priceSource: string;
}

/** Invoice prices compared with the agreed prices in data/nabavne_cene.csv. */
export function comparePrices(
  invoice: DocumentRow,
  invoiceItems: readonly ItemRow[],
  prices: readonly AgreedPrice[],
): { differences: PriceDifference[]; withoutAgreedPrice: { supplierCode: string; name: string }[] } {
  const differences: PriceDifference[] = [];
  const withoutAgreedPrice: { supplierCode: string; name: string }[] = [];

  for (const item of invoiceItems) {
    if (item.cena === null) continue;
    const agreed = item.sifra_dobavljaca
      ? agreedPriceFor(prices, invoice.broj, item.sifra_dobavljaca, invoice.datum_dokumenta)
      : undefined;
    if (!agreed) {
      withoutAgreedPrice.push({ supplierCode: itemKey(item), name: item.naziv });
      continue;
    }
    if (Math.abs(item.cena - agreed.price.price) < 0.005) continue;

    const difference = round2(item.cena - agreed.price.price);
    differences.push({
      invoiceItemId: item.id,
      supplierCode: itemKey(item),
      name: item.naziv,
      unit: item.jm,
      quantity: item.kolicina,
      invoicedPrice: item.cena,
      agreedPrice: agreed.price.price,
      difference,
      percent: round2((difference / agreed.price.price) * 100),
      amountWithoutVat: round2(difference * item.kolicina),
      invoiceSource: item.izvor,
      priceSource:
        agreed.basis === 'invoice'
          ? `${PRICE_FILE_NAME}:${agreed.price.row} (ugovorena cena za ${invoice.broj})`
          : `${PRICE_FILE_NAME}:${agreed.price.row} (poslednja cena pre ${invoice.datum_dokumenta}, faktura ${agreed.price.invoiceNumber})`,
    });
  }
  return { differences, withoutAgreedPrice };
}
