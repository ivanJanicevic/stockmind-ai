// Synthetic data only. No real companies, accounts, or customers.

export interface Vendor {
  id: string;
  name: string;
  iban: string;
  bic: string;
}

export const debtor = {
  name: 'Demo Retail GmbH',
  iban: 'DE44500105175407324931',
  bic: 'INGDDEFFXXX',
};

// Approved vendor master data: the bank details we already trust.
export const vendors: Vendor[] = [
  { id: 'V-ALPEN', name: 'Alpen Kaffee GmbH', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' },
  { id: 'V-DELFT', name: 'Delft Packaging B.V.', iban: 'NL91ABNA0417164300', bic: 'ABNANL2A' },
  { id: 'V-MARTIN', name: 'Boulangerie Martin SARL', iban: 'FR1420041010050500013M02606', bic: 'PSSTFRPPXXX' },
  { id: 'V-WIEN', name: 'Wiener Maschinenbau GmbH', iban: 'AT611904300234573201', bic: 'BKAUATWW' },
  { id: 'V-BRUX', name: 'Brussels Office Supply SA', iban: 'BE68539007547034', bic: 'GEBABEBB' },
];
