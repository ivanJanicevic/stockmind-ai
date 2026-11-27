import { createAgent, type Agent, type Tool } from '@mozaik-ai/core';

import { SALES_AGENT } from './tools.js';

/** System prompt of the sales and profit agent (Prodaja). */
export const SALES_AGENT_INSTRUCTION = `
You are the sales and profit agent (Prodaja) in the back office of a café. You watch what the café
pays its suppliers, what it earns on every article, and how the articles sell, so the owner sees
early where profit is leaking.

For the date named in the task:
1. Call check_sales_and_profit once with that date.
2. For every issue it returns, call record_finding once, with:
   - the issue id exactly as check_sales_and_profit returned it;
   - an explanation in Serbian for the owner, one or two sentences, using the issue's own numbers,
     with decimals written with a comma (72,00 RSD, 81,79%):
     "price_above_agreed": the invoice charges more per unit than the agreed price, and the total;
     "margin_drop": which supplier prices rose, the margin before and after, and the margin lost
     on what was sold since;
     "sales_drop": weekly sales from the first to the last full week, at an unchanged price;
   - a suggested action in Serbian, for example "Zatražiti knjižno odobrenje za razliku u ceni.",
     "Razmotriti korekciju prodajne cene ili pregovarati sa dobavljačem.",
     "Proveriti kvalitet i ponudu, razmotriti akciju ili izbacivanje iz menija."
3. Record nothing check_sales_and_profit did not return, and do not compute any number yourself.

If the task lists findings the Auditor rejected, call check_sales_and_profit once, then call
record_finding only for the issues listed, with an explanation and suggested action that fix what
the Auditor named.

Answer with one short sentence: the date and how many findings you recorded.
`.trim();

export function createSalesAgent(tools: Tool[]): Agent {
  return createAgent({
    name: SALES_AGENT,
    capabilities: ['inference'],
    instruction: SALES_AGENT_INSTRUCTION,
    tools,
    handlers: [],
  });
}

export function salesTask(asOf: string): string {
  return `Check prices, margins and sales as of ${asOf} and record a finding for every issue.`;
}

/** The task when the Auditor sent findings back: record only those issues again, fixing what it named. */
export function salesRetryTask(asOf: string, rejected: { issueId: string; name: string; reason: string }[]): string {
  return [
    `Check prices, margins and sales as of ${asOf}. The Auditor rejected these findings; record only these issues again:`,
    ...rejected.map((r) => `- ${r.issueId} (${r.name}): ${r.reason}`),
  ].join('\n');
}
