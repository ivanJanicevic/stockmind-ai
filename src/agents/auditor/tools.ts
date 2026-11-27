import type { DatabaseSync } from 'node:sqlite';

import type { Tool } from '@mozaik-ai/core';

import { findingsWithStatus, saveVerdict, type FindingRow, type FindingType } from '../../db/findings.js';
import type { FindingAudit } from './checks.js';

export const AUDITOR_AGENT = 'Auditor';

export interface Verdict {
  findingId: number;
  agent: string;
  type: FindingType;
  verdict: 'POTVRDJEN' | 'ODBIJEN';
  reason: string;
}

export interface AuditorToolsOptions {
  db: DatabaseSync;
  audit: (finding: FindingRow) => Promise<FindingAudit>;
  onVerdict: (verdict: Verdict) => void;
}

/**
 * The Auditor's tools. Every number is checked in code against the sources; the model reads the
 * results and gives the verdict and its reason. A finding with a failed check cannot be confirmed.
 */
export function createAuditorTools({ db, audit, onVerdict }: AuditorToolsOptions): Tool[] {
  // Audits of the last check_findings call, by finding id.
  let lastAudits = new Map<number, FindingAudit>();

  const checkFindingsTool: Tool = {
    type: 'function',
    name: 'check_findings',
    description:
      'Checks every finding waiting for the Auditor against its sources: re-reads the PDF lines, cash register ' +
      'rows and confirmed receipts it names, recomputes the numbers that are not printed anywhere (amounts, ' +
      'stock left) from the current data, and checks that every figure in the explanation and suggestion is ' +
      'in the finding or its sources and that decimals are written with a comma. Returns each finding with ' +
      'its numbers, its text and every check (ok true or false, with details in Serbian).',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    strict: true,
    invoke: async () => {
      const audits = await Promise.all(findingsWithStatus(db, 'CEKA').map((f) => audit(f)));
      lastAudits = new Map(audits.map((a) => [a.findingId, a]));
      return { waiting: audits.length, findings: audits };
    },
  };

  const recordVerdictTool: Tool = {
    type: 'function',
    name: 'record_verdict',
    description:
      'Records the verdict on one finding from the last check_findings call: POTVRDJEN (confirmed: it goes ' +
      'to the Advisor) or ODBIJEN (rejected: it goes back to the agent that recorded it, with your reason). ' +
      'POTVRDJEN is refused if any check of the finding failed.',
    parameters: {
      type: 'object',
      properties: {
        findingId: { type: 'integer', description: 'findingId as check_findings returned it.' },
        verdict: { type: 'string', enum: ['POTVRDJEN', 'ODBIJEN'] },
        reason: {
          type: 'string',
          description:
            'In Serbian, one sentence. For ODBIJEN: what is wrong, so the agent can fix it. For POTVRDJEN: what was checked.',
        },
      },
      required: ['findingId', 'verdict', 'reason'],
      additionalProperties: false,
    },
    strict: true,
    invoke: async ({ findingId, verdict, reason }: { findingId: number; verdict: 'POTVRDJEN' | 'ODBIJEN'; reason: string }) => {
      const checked = lastAudits.get(findingId);
      if (!checked) {
        return { recorded: false, error: `Finding ${findingId} is not in the last check_findings result, or already has a verdict.` };
      }
      if (reason.trim() === '') return { recorded: false, error: 'Give the reason for the verdict.' };
      const failed = checked.checks.filter((c) => !c.ok).map((c) => c.check);
      if (verdict === 'POTVRDJEN' && failed.length > 0) {
        return {
          recorded: false,
          error: `Finding ${findingId} failed these checks: ${failed.join(', ')}. A finding with a failed check can only be ODBIJEN.`,
        };
      }
      saveVerdict(db, findingId, verdict, reason.trim());
      lastAudits.delete(findingId);
      onVerdict({ findingId, agent: checked.agent, type: checked.type, verdict, reason: reason.trim() });
      return { recorded: true, findingId, verdict };
    },
  };

  return [checkFindingsTool, recordVerdictTool];
}
