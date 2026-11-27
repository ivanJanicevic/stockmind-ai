import type { FindingRow } from '../../db/findings.js';
import { EXPIRY_ALARM_DAYS, type LotOverview } from '../../domain/stock.js';

const number = new Intl.NumberFormat('sr-RS', { maximumFractionDigits: 3 });

/** The stock overview as a console table: every received lot with its expiry, first-expiring first. */
export function stockOverviewTable(asOf: string, lots: LotOverview[]): string {
  const header = ['Rok', 'Dana', 'Status', 'Primljeno', 'Na stanju', 'JM', 'Artikal'];
  const rows = lots.map((lot) => [
    lot.expiry ?? '-',
    lot.daysLeft === null ? '-' : String(lot.daysLeft),
    lot.status,
    number.format(lot.received),
    number.format(lot.remaining),
    lot.unit ?? '',
    `${lot.name}${lot.usedBySales ? '' : ' *'}`,
  ]);
  const widths = header.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c]!.length)));
  const line = (cells: string[]) =>
    cells.map((cell, c) => (c === 1 || c === 3 || c === 4 ? cell.padStart(widths[c]!) : cell.padEnd(widths[c]!))).join('  ').trimEnd();

  return [
    `Pregled zaliha na dan ${asOf} (alarm ${EXPIRY_ALARM_DAYS} dana pre isteka):`,
    line(header),
    ...rows.map(line),
    '* nijedan prodati artikal ne koristi ovu robu, pa prodaja ne smanjuje njeno stanje.',
  ].join('\n');
}

/** What the stock agent posts in the network: its findings for one stock date, with sources. */
export function stockFindingsMessage(
  asOf: string,
  findings: FindingRow[],
  notChecked: { soldWithoutReceipt: string[]; deliveryNotesNotConfirmed: string[] },
): string {
  const lines = findings.map((f, i) => {
    const values =
      f.tip === 'MANJAK'
        ? `primljeno ${number.format(f.ocekivano ?? 0)}, prodato ${number.format(f.stvarno ?? 0)}`
        : `na stanju ${number.format(f.stvarno ?? 0)}`;
    return (
      `${i + 1}. ${f.tip}: ${values}\n` +
      `   ${f.opis}${f.predlog ? ` Predlog: ${f.predlog}` : ''}\n` +
      `   Izvor: ${f.izvor}`
    );
  });

  const gaps: string[] = [];
  if (notChecked.deliveryNotesNotConfirmed.length > 0) {
    gaps.push(`Nepotvrđene otpremnice (njihova roba nije u stanju): ${notChecked.deliveryNotesNotConfirmed.join(', ')}.`);
  }
  if (notChecked.soldWithoutReceipt.length > 0) {
    gaps.push(`Prodato bez ijedne potvrđene prijemnice, stanje nepoznato: ${notChecked.soldWithoutReceipt.join(', ')}.`);
  }

  return [
    `Zalihe: stanje na dan ${asOf}. Nalaza: ${findings.length}.`,
    ...lines,
    ...gaps,
    'Nalazi čekaju proveru Auditora. Ovo nije finansijski savet.',
  ].join('\n');
}
