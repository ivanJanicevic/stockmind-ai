// Domestic RSD transfer orders ("nalog za prenos") for released invoices,
// written as a CSV draft for a person to review. Never sent anywhere.

export interface PaymentOrder {
  status: 'ready' | 'approved';
  recipient: string;
  recipientAccount: string;
  amount: number;
  reference: string; // poziv na broj = invoice number
  purpose: string;
  valueDate: string; // due date
  payer: string;
  payerAccount: string;
  source: string;
}

const PAYMENT_CODE = '221'; // šifra plaćanja: trade in goods
const csvCell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const rsd = (n: number) => n.toFixed(2).replace('.', ',');

export function buildPaymentCsv(orders: PaymentOrder[]): string {
  const header = 'status;primalac;racun_primaoca;iznos;sifra_placanja;model;poziv_na_broj;svrha;datum_valute;platilac;racun_platioca;izvor';
  const rows = orders.map((o) =>
    [o.status, o.recipient, o.recipientAccount, rsd(o.amount), PAYMENT_CODE, '', o.reference, o.purpose, o.valueDate, o.payer, o.payerAccount, o.source]
      .map(csvCell)
      .join(';')
  );
  // Model left empty: the reference contains letters, which model 97 doesn't allow.
  return ['# NACRT – NIJE POSLATO / DRAFT – NOT SENT. Synthetic data, not financial advice.', header, ...rows].join('\n') + '\n';
}
