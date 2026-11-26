---
name: add-agent
description: Add a new agent or check to the StockMind invoice-to-SEPA pipeline. Use when asked to add, insert, or replace an agent (e.g. a currency or sanctions screening agent) or a new validation step.
---

# Add an agent

1. **Prompt**: add `<NAME>_INSTRUCTION` to `src/prompts.ts` with INPUT, TASK, OUTPUT (the exact JSON shape) and RULES sections, a matching `<NAME>_SCHEMA` for structured output (all properties required, no nullable types), and a message builder. Any value the agent reports must carry a verbatim `quote` from the source document. Free text, like the Verifier draft, must pass `unsourcedFigures()`.
2. **Parser**: add `parse<Name>()` to `src/parsing.ts` that validates the JSON shape and returns `Parsed<T>`. Add tests in `test/parsing.test.ts`, including a rejected-answer case.
3. **State**: add the result field to `InvoiceCase` in `src/checks.ts`.
4. **Agent**: in `src/index.ts`, create it inside the per-document loop. Trigger it with `new WhenAnswerFrom(<previous agent>.getId())` and guard it with a run-once flag. Start it with `run(agent, c, message, <NAME>_OUTPUT)` so it is rate-limited and retried with the other pending loops.
5. **Completion**: make sure the case is only marked `done` after the new agent answers or fails. The Verifier is the reference: it triggers on its Auditor's answer only when `needsVerification()` returns a vendor, and the monitor holds `done` until the Verifier answers. Use `settle()` so one agent's answer never clears another agent's pending loop.
6. **Policy**: if the result can block a payment, update `decide()` and `test/checks.test.ts`.
7. **Report**: show the result with its source quotes in `src/report.ts`.
8. **Docs**: update the architecture diagram in README and the architecture line in `CLAUDE.md`.
9. **Check**: `npm run typecheck && npm test`. Ask before `npm run dev` (it costs credits).

For a purely deterministic check, skip steps 1, 2 and 4. Add it to `caseChecks()` or as a batch check like `addDuplicateChecks()`, with a test.
