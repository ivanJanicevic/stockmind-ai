// Parses and guards the analysts' and the reviewer's answers: every finding
// must cite a row the code computed, and every figure it mentions must appear
// in that row. Anything else is rejected and listed in the report.

import { extractJson, isObject, unsourcedFigures, type Parsed } from './parsing.js';

export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
  id: string; // the cited row id, e.g. STOCK-…, TREND-106, MARGIN-101
  severity: Severity;
  headline: string;
  explanation: string;
  action: string;
}

export interface Rejected {
  item: string;
  reason: string;
}

export interface ReviewAction {
  itemIds: string[];
  action: string;
  why: string;
}

export interface Review {
  summary: string;
  actions: ReviewAction[];
}

const SEVERITIES = new Set(['high', 'medium', 'low']);

// The figures a finding may use: the cited data as JSON, plus each of its
// numbers written with cents (JSON prints 349450 and 806.4, people write
// "349.450,00" and "806,40").
export function allowedFigures(data: unknown): string {
  const json = JSON.stringify(data);
  const numbers = json.match(/-?\d+(?:\.\d+)?/g) ?? [];
  return `${json}\n${numbers.map((n) => Math.abs(Number(n)).toFixed(2)).join(' ')}`;
}
const text = (o: Record<string, unknown>, key: string) => (typeof o[key] === 'string' ? (o[key] as string) : '');

export function parseFindings(answer: string, rows: ReadonlyMap<string, unknown>): Parsed<{ accepted: Finding[]; rejected: Rejected[] }> {
  try {
    const raw = extractJson(answer);
    if (!isObject(raw) || !Array.isArray(raw.findings)) throw new Error('answer must be { findings: [...] }');
    const accepted: Finding[] = [];
    const rejected: Rejected[] = [];
    for (const item of raw.findings as unknown[]) {
      if (!isObject(item)) continue;
      const f: Finding = {
        id: text(item, 'id'),
        severity: (SEVERITIES.has(text(item, 'severity')) ? text(item, 'severity') : 'low') as Severity,
        headline: text(item, 'headline'),
        explanation: text(item, 'explanation'),
        action: text(item, 'action'),
      };
      const label = `${f.id || '(no id)'}: ${f.headline}`;
      const row = rows.get(f.id);
      if (!row) {
        rejected.push({ item: label, reason: `cites unknown row id "${f.id}"` });
        continue;
      }
      if (!f.headline || !f.action) {
        rejected.push({ item: label, reason: 'headline or action missing' });
        continue;
      }
      const unsourced = unsourcedFigures(`${f.headline}\n${f.explanation}\n${f.action}`, allowedFigures(row));
      if (unsourced.length) {
        rejected.push({ item: label, reason: `figures not in row ${f.id}: ${unsourced.join(', ')}` });
        continue;
      }
      accepted.push(f);
    }
    return { ok: true, value: { accepted, rejected } };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export function parseReview(answer: string, items: ReadonlyMap<string, unknown>): Parsed<{ review: Review; rejected: Rejected[] }> {
  try {
    const raw = extractJson(answer);
    if (!isObject(raw) || typeof raw.summary !== 'string' || !Array.isArray(raw.actions)) {
      throw new Error('answer must be { summary, actions: [...] }');
    }
    const allItems = allowedFigures([...items.values()]);
    const rejected: Rejected[] = [];
    const summaryFigures = unsourcedFigures(raw.summary, allItems);
    const summary = summaryFigures.length ? '' : raw.summary;
    if (summaryFigures.length) rejected.push({ item: 'summary', reason: `unsourced figures: ${summaryFigures.join(', ')}` });

    const actions: ReviewAction[] = [];
    for (const item of raw.actions as unknown[]) {
      if (!isObject(item)) continue;
      const ids = Array.isArray(item.itemIds) ? (item.itemIds as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      const a: ReviewAction = { itemIds: ids, action: text(item, 'action'), why: text(item, 'why') };
      const unknown = ids.filter((id) => !items.has(id));
      if (!ids.length || unknown.length) {
        rejected.push({ item: a.action, reason: ids.length ? `unknown item ids: ${unknown.join(', ')}` : 'cites no items' });
        continue;
      }
      const cited = allowedFigures(ids.map((id) => items.get(id)));
      const unsourced = unsourcedFigures(`${a.action}\n${a.why}`, cited);
      if (unsourced.length) {
        rejected.push({ item: a.action, reason: `figures not in cited items: ${unsourced.join(', ')}` });
        continue;
      }
      actions.push(a);
    }
    return { ok: true, value: { review: { summary, actions }, rejected } };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
