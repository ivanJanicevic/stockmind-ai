# StockMind AI

Mozaik multi-agent "café finance desk" (JigJoy hackathon, Agents in Finance track). On a synthetic Serbian café dataset (`data/`, RSD) it checks supplier invoices against delivery notes and agreed prices, drafts payment orders only for clean invoices, analyses stock, demand, margins and costs, and writes `out/review.md` + `out/payment-draft.csv`.

## Commands

- `npm test` — unit tests in `test/` (Node test runner via tsx, no LLM calls; analytics tests run on the real `data/`)
- `npm run typecheck` — type-check `src/` (runs after every edit via hook once `node_modules` exists)
- `npm run build` — compile to `dist/`
- `npm run dev` — real run; **calls the model and uses quota**, ask before running. Writes `out/`.
- `scripts/extract-pdf-text.sh` — regenerate `data/text/*.txt` from the PDFs (macOS)

## Architecture

At t=0 three analysts (Stock, Sales, Margin & Cost) and an Invoice Clerk + Receiving Clerk per invoice pair start together through the rate-limited `run()` queue. The Monitoring participant handles every `model.answer` event: when both clerks of a pair answered → `matchInvoice()` (three-way match) → Claims Writer if held; when the last delivery note is in → `computePlanning()` (`src/planning.ts`) → Inventory Planner; when all analysts (including the planner) and pairs are in → Reviewer. Everything lives in `AppState` (a Mozaik `RuntimeState`). At the end: `decide()` (with `--approve` ids) → payment draft + report. See README for the file map.

Corrected invoice (`submitCorrection`, dashboard upload or `--correct 07=<pdf>`): only for a held, finished case. `src/pdf.ts` extracts the text, a new `Invoice Clerk NN · vN` (flag `recheck`, may answer after the run) reads it, `completePair` re-runs `matchInvoice` against the same delivery note with the original invoice number for the register (`c.corrects`) plus the `replaces_original` check; the earlier version goes to `c.history`. After the run, `afterCase` rewrites the outputs; a failed re-check holds only that invoice (`failRechecks`), it never aborts.

## Rules (hackathon scoring depends on these)

- **Every number has a source.** Business numbers are computed in `src/analytics.ts` with file:line sources; agents never compute them. Clerk answers are `{ value, quote }` and verified by `verifyInvoice` / `verifyNote` (amounts must be printed tokens like `175,00`). Free text (findings, review, claims) goes through `unsourcedFigures()` and is rejected if it contains a figure not in its cited data.
- **Agents never decide alone.** `decide()` holds on any failed blocking check or agent error. Amounts above `APPROVAL_LIMIT_RSD` need `--approve`, which can never release a held invoice. If our own clerks' reading fails verification, no supplier claim is drafted.
- **Agent prompts define INPUT, TASK, OUTPUT (exact JSON shape) and RULES** (`src/agents.ts`), each with a strict JSON Schema (all properties required, no nullables) and a parser with tests.
- **The delivery note is never replaced to clear a hold.** Corrections replace the invoice only; the note is our receiving record.
- **Each agent runs once and agents never trigger themselves.** Dependent agents are started only from the Monitoring handler, guarded by `answered` / run-once flags. This prevents loops and runaway cost.
- **Planning separates facts, forecasts and recommendations.** Stock is always a book estimate (never "delivered = on hand"); a lot's expiry comes only from a verified delivery note; no discount effect on volume is ever estimated (no promotion history); order quantities only with planning parameters (`data/planiranje.json` is synthetic and must stay labelled so).
- **Mozaik Network is optional and visibility-only**; it must never block or fail a run.
- **Synthetic data only.** Keep the "not financial advice" disclaimer in console, report and payment draft.
- Never read, print, or commit `.env`.

## Mozaik details

Confirmed: `runLoop(agentId, message, { model, context, tools, structuredOutput })` returns void and its errors aren't routed to the bus (hence the process-level handlers and `handleModelError`); the `model.answer` payload is `{ answer: ModelMessageItem }` (`answerText` searches it recursively); only listed model ids work (`gemini-3.5-flash-lite` worked in a real run and is the default for its free-tier quota).
Still to confirm on `@mozaik-ai/core` 6.0.0 in a real run: runtime API unchanged from 4.2, strict schemas accepted (otherwise the run retries without structured output).
