// Synthetic data only. No real companies, accounts, or customers.

export interface Vendor {
  id: string;
  name: string;
  iban: string;
  bic: string;
  emailDomain: string; // domain the vendor really sends email from
  contactEmail: string; // known AP contact, used for call-back verification
  phone: string;
}

export const debtor = {
  name: 'Demo Retail GmbH',
  iban: 'DE44500105175407324931',
  bic: 'INGDDEFFXXX',
};

// Approved vendor master data: the details we already trust.
export const vendors: Vendor[] = [
  { id: 'V-ALPEN', name: 'Alpen Kaffee GmbH', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', emailDomain: 'alpen-kaffee.de', contactEmail: 'buchhaltung@alpen-kaffee.de', phone: '+49 89 0000 1001' },
  { id: 'V-DELFT', name: 'Delft Packaging B.V.', iban: 'NL91ABNA0417164300', bic: 'ABNANL2A', emailDomain: 'delft-packaging.nl', contactEmail: 'finance@delft-packaging.nl', phone: '+31 15 000 2002' },
  { id: 'V-MARTIN', name: 'Boulangerie Martin SARL', iban: 'FR1420041010050500013M02606', bic: 'PSSTFRPPXXX', emailDomain: 'boulangerie-martin.fr', contactEmail: 'compta@boulangerie-martin.fr', phone: '+33 1 00 00 30 03' },
  { id: 'V-WIEN', name: 'Wiener Maschinenbau GmbH', iban: 'AT611904300234573201', bic: 'BKAUATWW', emailDomain: 'wiener-maschinenbau.at', contactEmail: 'office@wiener-maschinenbau.at', phone: '+43 1 000 4004' },
  { id: 'V-BRUX', name: 'Brussels Office Supply SA', iban: 'BE68539007547034', bic: 'GEBABEBB', emailDomain: 'brussels-office.be', contactEmail: 'ar@brussels-office.be', phone: '+32 2 000 50 05' },
];
