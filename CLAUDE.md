# StockMind AI

Mozaik multi-agent accounts payable prototype (JigJoy hackathon, Agents in Finance track). It turns synthetic invoices and emails into a validated SEPA pain.001 payment draft plus a review report.

## Commands

- `npm test` — unit tests in `test/` (Node test runner via tsx, no LLM calls)
- `npm run typecheck` — type-check `src/` (runs after every edit via hook once `node_modules` exists)
- `npm run build` — compile to `dist/`
- `npm run dev` — real run; **calls Gemini and costs credits**, ask before running. Writes `out/`.

## Architecture

Per document: Extractor agent → deterministic checks → Auditor agent → (only if `needsVerification`) Verifier agent, which drafts a call-back request to the vendor-master contact. All documents run in parallel, model calls go through a rate-limited queue, and everything shares `AppState.cases` (a Mozaik `RuntimeState`). When every case is done, or on timeout: duplicate check → `decide()` (with `--approve` ids) → `out/sepa-draft.xml` + `out/review.md`. See README for the file map.

## Rules (hackathon scoring depends on these)

- **Every number has a source.** Agent outputs are `{ value, quote }`. `unverifiedFields()` rejects anything not traceable to the document. Never add a value to the report or SEPA file that skipped this.
- **Agents never decide alone.** `decide()` blocks on any failed check, a non-`ok` audit, or an agent error. Amounts above `APPROVAL_LIMIT_EUR` go to a human, and `--approve` can only release those, never blocked ones.
- **Free-text agent output is guarded too.** The Verifier draft goes through `unsourcedFigures()` and is withheld if it contains a figure not in the sources.
- **Agent prompts define INPUT, TASK, OUTPUT (exact JSON shape) and RULES.** Every JSON answer has a parser in `src/parsing.ts` and a test.
- **Each agent runs once and agents never trigger themselves.** Independent agents start together through `run()`, and the Monitoring participant combines their `model.answer` events per case (`completeAnalysisIfReady`) before starting dependent agents. This prevents agent loops and runaway cost.
- **Synthetic data only.** Keep the "not financial advice" disclaimer in console and report output.
- Never read, print, or commit `.env`.

## Unverified Mozaik details

Still to confirm in `node_modules/@mozaik-ai/core` or a real run:
- the exact `ModelMessageItem` fields inside `model.answer`'s `{ answer }` payload (`answerText` searches recursively);
- whether Gemini accepts our strict structured-output schemas (if not, the run retries without them).

Confirmed from docs.jigjoy.ai: `runLoop` returns void and its errors aren't routed to the bus (hence the process-level handlers); `RuntimeState` subclasses and spec constructors typecheck against the real package; only listed model ids work (Gemini: `gemini-3.5-flash`, `gemini-3.1-pro-preview`); `gemini-3.5-flash-lite` is not in the docs but worked in a real run and is the default for its free-tier quota (15/min, 500/day).
