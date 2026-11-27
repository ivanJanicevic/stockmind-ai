import { amountsIn, extractJson, type Parsed } from './parsing.js';
import type {
  RetailAnalysisAnswer,
  RetailPlanAnswer,
} from './retail-prompts.js';

type JsonRecord = Record<string, unknown>;

export interface RetailCandidate {
  id: string;
  type:
    | 'promotion_test'
    | 'markdown_review'
    | 'inventory_check'
    | 'price_review'
    | 'expense_review'
    | 'bundle_test';
  target: string;
  reason: string;
  evidenceIds: string[];
  metrics: Record<string, number | string | null>;
  limitations: string;
}

export type RetailEvidenceFacts = ReadonlyMap<string, string>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function figuresIn(text: string): number[] {
  const dateParts = (text.match(/\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/g) ?? [])
    .flatMap((date) => date.split(/[-/.]/).map(Number));
  return [...amountsIn(text), ...dateParts];
}

export function figuresAreSourced(text: string, sources: readonly string[]): boolean {
  return figuresIn(text).every((figure) =>
    sources.some((source) => figuresIn(source).some((sourced) => Math.abs(figure - sourced) < 0.005))
  );
}

function evidenceList(value: unknown, knownEvidence: ReadonlySet<string>, context: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((id) => typeof id === 'string')) {
    throw new Error(`${context}.evidenceIds must be a non-empty array of strings.`);
  }
  const ids = [...new Set(value)];
  const unknown = ids.filter((id) => !knownEvidence.has(id));
  if (unknown.length > 0) throw new Error(`${context} cites unknown evidence: ${unknown.join(', ')}.`);
  return ids;
}

export function parseRetailAnalysis(
  answer: string,
  knownEvidence: ReadonlySet<string>,
  evidenceFacts: RetailEvidenceFacts
): Parsed<RetailAnalysisAnswer> {
  try {
    const raw = extractJson(answer);
    if (!isRecord(raw) || typeof raw.summary !== 'string' || !Array.isArray(raw.findings)) {
      throw new Error('answer must be { summary, findings }.');
    }
    const findings = raw.findings.map((value, index) => {
      const context = `findings[${index}]`;
      if (
        !isRecord(value) ||
        typeof value.title !== 'string' ||
        typeof value.detail !== 'string'
      ) {
        throw new Error(`${context} must contain title and detail strings.`);
      }
      const evidenceIds = evidenceList(value.evidenceIds, knownEvidence, context);
      const sources = evidenceIds.flatMap((id) => {
        const facts = evidenceFacts.get(id);
        return facts ? [facts] : [];
      });
      if (!figuresAreSourced(value.title, sources) || !figuresAreSourced(value.detail, sources)) {
        throw new Error(`${context} contains a number not supported by its cited evidence.`);
      }
      return {
        title: value.title,
        detail: value.detail,
        evidenceIds,
      };
    });
    const summarySources = [...new Set(findings.flatMap((finding) => finding.evidenceIds))]
      .flatMap((id) => {
        const facts = evidenceFacts.get(id);
        return facts ? [facts] : [];
      });
    if (!figuresAreSourced(raw.summary, summarySources)) {
      throw new Error('summary contains a number not supported by the findings’ cited evidence.');
    }
    return { ok: true, value: { summary: raw.summary, findings } };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export function parseRetailPlan(
  answer: string,
  candidates: readonly RetailCandidate[]
): Parsed<RetailPlanAnswer> {
  try {
    const raw = extractJson(answer);
    if (!isRecord(raw) || typeof raw.summary !== 'string' || !Array.isArray(raw.recommendations)) {
      throw new Error('answer must be { summary, recommendations }.');
    }
    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const recommendations = raw.recommendations.map((value, index) => {
      const context = `recommendations[${index}]`;
      if (
        !isRecord(value) ||
        typeof value.candidateId !== 'string' ||
        typeof value.rationale !== 'string'
      ) {
        throw new Error(`${context} must contain candidateId and rationale strings.`);
      }
      const candidate = candidateById.get(value.candidateId);
      if (!candidate) throw new Error(`${context} references an unknown candidate.`);
      const evidenceIds = evidenceList(value.evidenceIds, new Set(candidate.evidenceIds), context);
      const metricSources = Object.values(candidate.metrics)
        .filter((metric): metric is number | string => metric !== null)
        .map(String);
      if (!figuresAreSourced(value.rationale, metricSources)) {
        throw new Error(`${context}.rationale contains a number not supported by its candidate metrics.`);
      }
      return { candidateId: value.candidateId, rationale: value.rationale, evidenceIds };
    });
    const selectedMetricSources = recommendations.flatMap((recommendation) => {
      const candidate = candidateById.get(recommendation.candidateId);
      return candidate
        ? Object.values(candidate.metrics).filter((metric) => metric !== null).map(String)
        : [];
    });
    if (!figuresAreSourced(raw.summary, selectedMetricSources)) {
      throw new Error('summary contains a number not supported by selected candidate metrics.');
    }
    return { ok: true, value: { summary: raw.summary, recommendations } };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
