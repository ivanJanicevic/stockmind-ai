---
name: add-agent
description: Add a new agent or check to the StockMind café finance desk. Use when asked to add, insert, or replace an agent (e.g. a VAT, cash-flow or supplier-scoring agent) or a new deterministic check.
---

# Add an agent

1. **Numbers first:** if the agent needs figures, compute them in code (`src/analytics.ts` or `src/ap.ts`). Give every row an `id` and `sources[]` (file:line), and add a test in `test/` that pins the numbers on the real `data/`.
2. **Prompt:** in `src/agents.ts`, add `<NAME>` with INPUT / TASK / OUTPUT (the exact JSON shape) / RULES, a strict JSON Schema built with `obj()` (all properties required, no nullables), an `OutputFormat`, and a message builder.
3. **Parser and guard:** reuse `parseFindings` (it cites row ids and checks figures against the cited row) or add a `parse<Name>()` returning `Parsed<T>`. Any free text must pass `unsourcedFigures()` against `allowedFigures(citedData)`. Add tests, including a rejected answer.
4. **State:** add the result to `AppState` in `src/index.ts`, or to `ApCase` in `src/ap.ts` for per-invoice work.
5. **Agent:** `register(name, role, instruction, …)` in `src/index.ts`.
   - Independent work: start it with `run(agent, message, OUTPUT)` at startup, so it runs concurrently.
   - Dependent work: start it from the Monitoring handler once its inputs are in, behind a run-once flag.
   - Add the new role to the handler's dispatch.
6. **Completion:** include it in `allDone()` and mark it done or failed in `abort()`.
7. **Policy:** if the result can hold a payment, make it a blocking `Check` in `matchInvoice()` and update `test/ap.test.ts`.
8. **Report:** show the result with its sources in `src/report.ts`.
9. **Docs:** update the README architecture diagram and the architecture paragraph in `CLAUDE.md`.
10. **Check:** run `npm run typecheck && npm test`. Ask before `npm run dev`, because it uses model quota.

For a purely deterministic check, skip steps 2, 3 and 5. Add it to `matchInvoice()` or `analytics.ts`, with a test.
