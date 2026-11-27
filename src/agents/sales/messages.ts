import type { FindingRow } from '../../db/findings.js';

const number = new Intl.NumberFormat('sr-RS', { maximumFractionDigits: 2 });
const rsd = new Intl.NumberFormat('sr-RS', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** What the sales and profit agent posts in the network: its findings for one date, with sources. */
export function salesFindingsMessage(asOf: string, findings: FindingRow[], invoicesChecked: string[]): string {
  const lines = findings.map((f, i) => {
    const values =
      f.tip === 'CENA'
        ? `ugovoreno ${rsd.format(f.ocekivano ?? 0)}, fakturisano ${rsd.format(f.stvarno ?? 0)} RSD, razlika ${rsd.format(f.iznos_bez_pdv ?? 0)} RSD bez PDV`
        : f.tip === 'PAD_MARZE'
          ? `marža ${number.format(f.ocekivano ?? 0)}% -> ${number.format(f.stvarno ?? 0)}%, izgubljeno ${rsd.format(f.iznos_bez_pdv ?? 0)} RSD`
          : `prodaja ${number.format(f.ocekivano ?? 0)} -> ${number.format(f.stvarno ?? 0)} nedeljno`;
    return `${i + 1}. ${f.tip}: ${values}\n   ${f.opis}${f.predlog ? ` Predlog: ${f.predlog}` : ''}\n   Izvor: ${f.izvor}`;
  });
  return [
    `Prodaja i profit: stanje na dan ${asOf}. Proverene fakture: ${invoicesChecked.join(', ') || 'nijedna'}. Nalaza: ${findings.length}.`,
    ...lines,
    'Nalazi čekaju proveru Auditora. Ovo nije finansijski savet.',
  ].join('\n');
}
