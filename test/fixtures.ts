// Correct extractions of the sample documents, as a well-behaved extractor
// agent would return them. Lets the checks run end to end without an LLM.
import type { Extraction } from '../src/parsing.js';

const s = <T>(value: T, quote: string) => ({ value, quote });

export const extractions: Record<string, Extraction> = {
  'INV-1001': {
    invoiceNumber: s('AK-2026-1001', 'Invoice number: AK-2026-1001'),
    vendorName: s('Alpen Kaffee GmbH', 'ALPEN KAFFEE GMBH'),
    iban: s('DE89370400440532013000', 'IBAN: DE89 3704 0044 0532 0130 00'),
    bic: s('COBADEFFXXX', 'BIC: COBADEFFXXX'),
    currency: s('EUR', 'Total due: EUR 1.428,00'),
    totalAmount: s(1428, 'Total due: EUR 1.428,00'),
    dueDate: s('2026-12-10', 'Due date: 10.12.2026'),
    lineItems: [
      { description: 'Espresso beans', amount: s(1120, 'EUR 1.120,00') },
      { description: 'Filter coffee', amount: s(308, 'EUR 308,00') },
    ],
  },
  'INV-1002': {
    invoiceNumber: s('DP-88412', 'Invoice number: DP-88412'),
    vendorName: s('Delft Packaging B.V.', 'Beneficiary: Delft Packaging B.V.'),
    iban: s('NL44RABO0123456789', 'IBAN: NL44 RABO 0123 4567 89'),
    bic: s('RABONL2U', 'BIC: RABONL2U'),
    currency: s('EUR', 'Amount: EUR 2.360,50'),
    totalAmount: s(2360.5, 'Amount: EUR 2.360,50'),
    dueDate: s('2026-11-28', 'Due date: 28.11.2026'),
    lineItems: [
      { description: 'Corrugated boxes', amount: s(2360.5, 'corrugated boxes (500 pcs) EUR 2.360,50') },
    ],
  },
  'INV-1003': {
    invoiceNumber: s('BM-7731', 'No. BM-7731'),
    vendorName: s('Boulangerie Martin SARL', 'BOULANGERIE MARTIN SARL'),
    iban: s('FR1420041010050500013M02607', 'IBAN: FR14 2004 1010 0505 0001 3M02 607'),
    bic: s('PSSTFRPPXXX', 'BIC: PSSTFRPPXXX'),
    currency: s('EUR', 'TOTAL: EUR 590,00'),
    totalAmount: s(590, 'TOTAL: EUR 590,00'),
    dueDate: s('2026-12-12', 'Due: 12.12.2026'),
    lineItems: [
      { description: 'Croissants', amount: s(330, 'EUR 330,00') },
      { description: 'Baguettes', amount: s(260, 'EUR 260,00') },
    ],
  },
  'INV-1004': {
    invoiceNumber: s('WM-55-2026', 'Invoice WM-55-2026'),
    vendorName: s('Wiener Maschinenbau GmbH', 'Wiener Maschinenbau GmbH'),
    iban: s('AT611904300234573201', 'IBAN AT61 1904 3002 3457 3201'),
    bic: s('BKAUATWW', 'BIC BKAUATWW'),
    currency: s('EUR', 'Total: EUR 12.400,00'),
    totalAmount: s(12400, 'Total: EUR 12.400,00'),
    dueDate: s('2026-12-05', 'Payment due: 05.12.2026'),
    lineItems: [
      { description: 'Espresso machine', amount: s(11900, 'EUR 11.900,00') },
      { description: 'Installation and training', amount: s(500, 'EUR 500,00') },
    ],
  },
  'INV-1005': {
    invoiceNumber: s('AK-2026-1001', 'Invoice number: AK-2026-1001'),
    vendorName: s('Alpen Kaffee GmbH', 'Vendor: Alpen Kaffee GmbH'),
    iban: s('DE89370400440532013000', 'IBAN: DE89 3704 0044 0532 0130 00'),
    bic: s('COBADEFFXXX', 'BIC: COBADEFFXXX'),
    currency: s('EUR', 'Amount: EUR 1.428,00'),
    totalAmount: s(1428, 'Amount: EUR 1.428,00'),
    dueDate: s('2026-12-10', 'Due date: 10.12.2026'),
    lineItems: [
      { description: 'Espresso beans and filter coffee', amount: s(1428, 'Espresso beans and filter coffee EUR 1.428,00') },
    ],
  },
  'INV-1006': {
    invoiceNumber: s('BOS-2026-0419', 'INVOICE BOS-2026-0419'),
    vendorName: s('Brussels Office Supply SA', 'Brussels Office Supply SA'),
    iban: s('BE68539007547034', 'IBAN: BE68 5390 0754 7034'),
    bic: s('GEBABEBB', 'BIC: GEBABEBB'),
    currency: s('EUR', 'Total amount: EUR 275,50'),
    totalAmount: s(275.5, 'Total amount: EUR 275,50'),
    dueDate: s('2026-12-14', 'Due date: 14.12.2026'),
    lineItems: [
      { description: 'Printer paper A4', amount: s(180, 'EUR 180,00') },
      { description: 'Receipt rolls', amount: s(95.5, 'EUR 95,50') },
    ],
  },
};
