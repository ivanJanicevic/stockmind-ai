// Synthetic invoices and emails. Each one exercises a different check:
// INV-1001 clean, INV-1002 changed bank details, INV-1003 IBAN typo,
// INV-1004 above approval limit, INV-1005 duplicate of INV-1001, INV-1006 clean.

export interface SourceDocument {
  id: string;
  file: string;
  text: string;
}

export const invoices: SourceDocument[] = [
  {
    id: 'INV-1001',
    file: 'invoice_alpen_1001.txt',
    text: `ALPEN KAFFEE GMBH
Röststraße 12, 80331 München, Germany

INVOICE
Invoice number: AK-2026-1001
Invoice date: 10.11.2026
Due date: 10.12.2026
Bill to: Demo Retail GmbH

Espresso beans 1kg x 40 ........ EUR 1.120,00
Filter coffee 1kg x 14 ......... EUR 308,00

Total due: EUR 1.428,00

Please pay by bank transfer to:
IBAN: DE89 3704 0044 0532 0130 00
BIC: COBADEFFXXX
Reference: AK-2026-1001`,
  },
  {
    id: 'INV-1002',
    file: 'email_delft_1002.eml',
    text: `From: accounts@delft-packaging-billing.com
Subject: URGENT - new bank details for invoice DP-88412

Dear customer,

Due to an audit our bank account has changed. Please pay invoice DP-88412
today to our new account, the old account is closed.

Invoice number: DP-88412
Amount: EUR 2.360,50
Due date: 28.11.2026
Beneficiary: Delft Packaging B.V.
IBAN: NL44 RABO 0123 4567 89
BIC: RABONL2U

Items: corrugated boxes (500 pcs) EUR 2.360,50

Kind regards,
Finance team`,
  },
  {
    id: 'INV-1003',
    file: 'invoice_martin_1003.txt',
    text: `BOULANGERIE MARTIN SARL
5 rue du Pain, 75011 Paris

FACTURE / INVOICE  No. BM-7731
Date: 12.11.2026   Due: 12.12.2026

Croissants (600) ............ EUR 330,00
Baguettes (400) ............. EUR 260,00

TOTAL: EUR 590,00

IBAN: FR14 2004 1010 0505 0001 3M02 607
BIC: PSSTFRPPXXX`,
  },
  {
    id: 'INV-1004',
    file: 'invoice_wien_1004.txt',
    text: `Wiener Maschinenbau GmbH
Industriestraße 4, 1100 Wien

Invoice WM-55-2026
Date: 05.11.2026
Payment due: 05.12.2026

Espresso machine, 2 groups ..... EUR 11.900,00
Installation and training ...... EUR 500,00

Total: EUR 12.400,00

Bank: IBAN AT61 1904 3002 3457 3201, BIC BKAUATWW`,
  },
  {
    id: 'INV-1005',
    file: 'email_alpen_reminder.eml',
    text: `From: billing@alpen-kaffee.de
Subject: Reminder: invoice AK-2026-1001

Hello,

friendly reminder that invoice AK-2026-1001 is still open.

Invoice number: AK-2026-1001
Amount: EUR 1.428,00
Due date: 10.12.2026
Vendor: Alpen Kaffee GmbH
IBAN: DE89 3704 0044 0532 0130 00
BIC: COBADEFFXXX

Espresso beans and filter coffee EUR 1.428,00

Best regards`,
  },
  {
    id: 'INV-1006',
    file: 'invoice_brux_1006.txt',
    text: `Brussels Office Supply SA
Rue de la Loi 200, 1040 Bruxelles

INVOICE BOS-2026-0419
Date: 14.11.2026  Due date: 14.12.2026

Printer paper A4 (20 boxes) ..... EUR 180,00
Receipt rolls (100) ............. EUR 95,50

Total amount: EUR 275,50

IBAN: BE68 5390 0754 7034  BIC: GEBABEBB
Communication: BOS-2026-0419`,
  },
];
