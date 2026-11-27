import { unsourcedFigures } from '../parsing.js';
import { parseLocalNumber, toLocalDate } from './document-draft.js';

/** One check the Auditor ran on a finding. Details are in Serbian: they quote Serbian sources. */
export interface AuditCheck {
  check: string;
  ok: boolean;
  detail: string;
}

export const sameNumber = (a: number | null | undefined, b: number | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined ? (a ?? null) === (b ?? null) : Math.abs(a - b) < 0.0005;

const serbian = new Intl.NumberFormat('sr-RS', { maximumFractionDigits: 3 });
const serbianMoney = new Intl.NumberFormat('sr-RS', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A number the way the owner reads it: "7.350", "1,975". */
export const formatNumber = (n: number | null | undefined) => (n === null || n === undefined ? '-' : serbian.format(n));

/** True when the number is printed on the line, written the Serbian way ("2.450,00", "0,5", "22"). */
export function lineHasNumber(line: string, n: number): boolean {
  return line.split(' ').some((token) => sameNumber(parseLocalNumber(token), n));
}

/** True when the date (YYYY-MM-DD) is printed on the line as DD.MM.YYYY. */
export function lineHasDate(line: string, iso: string): boolean {
  const local = toLocalDate(iso);
  return local !== null && line.split(' ').includes(local);
}

/** Source references in a finding's izvor: PDF lines ("fakture/x.pdf:19") and sales rows ("data/promet_....csv:1905"). */
export function sourceRefs(izvor: string): { pdf: { file: string; line: number }[]; csv: { file: string; row: number }[] } {
  const pdf = [...izvor.matchAll(/([\w./-]+\.pdf):(\d+)/g)].map((m) => ({ file: m[1]!, line: Number(m[2]) }));
  const csv = [...izvor.matchAll(/([\w./-]+\.csv):(\d+)/g)].map((m) => ({ file: m[1]!, row: Number(m[2]) }));
  return { pdf, csv };
}

/** The numbers as they may be written in free text: plain, Serbian, Serbian with 2 decimals. */
function numberVariants(values: readonly (number | null | undefined)[]): string {
  return values
    .filter((n): n is number => typeof n === 'number')
    .flatMap((n) => [String(n), serbian.format(n), serbianMoney.format(n)])
    .join(' ');
}

/** Every YYYY-MM-DD date in the text, also written as DD.MM.YYYY. */
function dateVariants(text: string): string {
  return (text.match(/\d{4}-\d{2}-\d{2}/g) ?? []).map((iso) => toLocalDate(iso) ?? '').join(' ');
}

/**
 * Checks the owner-facing text of a finding:
 * - every figure in it must be in the finding's numbers or its sources;
 * - a decimal number must be written with a comma: "1.975" reads as one thousand nine hundred
 *   seventy-five in Serbian, so writing the finding's 1,975 that way states a wrong number.
 */
export function textCheck(text: string, sources: string, values: readonly (number | null | undefined)[]): AuditCheck {
  const allowed = `${sources} ${numberVariants(values)} ${dateVariants(sources)}`;
  const unsourced = unsourcedFigures(text, allowed);
  const decimals = values.filter((n): n is number => typeof n === 'number' && !Number.isInteger(n));
  const pointDecimals = (text.match(/(?<![\d.,])\d+\.\d+(?![\d,]|\.\d)/g) ?? []).filter((token) =>
    decimals.some((d) => sameNumber(Number(token), d)),
  );

  const problems = [
    ...unsourced.map((figure) => `broj ${figure} nije u nalazu ni u izvorima`),
    ...pointDecimals.map(
      (token) => `"${token}" je napisan sa tačkom, pa vlasnik čita ${token.replace('.', '')}; treba ${formatNumber(Number(token))}`,
    ),
  ];
  return {
    check: 'brojevi u tekstu',
    ok: problems.length === 0,
    detail: problems.length === 0 ? 'svaki broj u objašnjenju i predlogu postoji u nalazu ili izvorima' : problems.join('; '),
  };
}
