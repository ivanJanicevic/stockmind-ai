import type { ReturnResult } from './return-to-agent.js';
import type { Verdict } from './tools.js';

const verdictLine = (v: Verdict) => `#${v.findingId} ${v.agent} ${v.type}: ${v.verdict}. ${v.reason}`;

/** What the Auditor posts in the network: its verdicts, what went back to the agents and how the re-check ended. */
export function auditMessage(first: readonly Verdict[], returned: ReturnResult | undefined, second: readonly Verdict[]): string {
  const final = new Map(first.map((v) => [v.findingId, v]));
  for (const v of second) final.set(v.findingId, v);
  const confirmed = [...final.values()].filter((v) => v.verdict === 'POTVRDJEN').length;
  const rejected = final.size - confirmed;

  const lines = [`Auditor: provereno ${final.size} nalaza. Potvrđeno: ${confirmed}, odbijeno: ${rejected}.`, ...first.map(verdictLine)];

  if (returned && (returned.returned.length > 0 || returned.notReturned.length > 0)) {
    lines.push('', 'Odbijeni nalazi vraćeni agentima, ponovna provera:');
    lines.push(...second.map(verdictLine));
    const reChecked = new Set(second.map((v) => v.findingId));
    for (const id of returned.returned.filter((id) => !reChecked.has(id))) {
      lines.push(`#${id}: agent ga nije ponovo upisao, ostaje ODBIJEN.`);
    }
    for (const { findingId, why } of returned.notReturned) {
      lines.push(`#${findingId}: nije vraćen agentu (${why}), ostaje ODBIJEN.`);
    }
  }

  lines.push('', 'Potvrđeni nalazi idu Advisoru. Ovo nije finansijski savet.');
  return lines.join('\n');
}
