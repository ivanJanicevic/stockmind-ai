# StockMind AI

StockMind AI is a Mozaik multi-agent cafe operations prototype (JigJoy hackathon, Agents in Finance track). It analyzes synthetic POS sales, purchase invoices, delivery-note expiry lots, recipes, and operating costs to produce sourced findings and human-reviewed promotion candidates. The previous invoice-to-SEPA prototype remains available as a separate command.

## Commands

- `npm test` — unit tests in `test/` (Node test runner via tsx, no LLM calls)
- `npm run typecheck` — type-check `src/` (runs after every edit via hook once `node_modules` exists)
- `npm run build` — compile to `dist/`
- `npm run dev` — retail analysis; **calls Gemini and costs credits**, ask before running. Writes `out/stockmind-review.md`.
- `npm run dev:sepa` — legacy invoice-to-SEPA flow; **calls Gemini and costs credits**, ask before running.
- `npm start` — run the compiled retail analysis.
- `npm run start:sepa` — run the compiled legacy SEPA flow.

## Architecture

The default `src/retail.ts` loads local synthetic POS, purchase, expense, recipe, catalog, invoice, and dispatch-note data. Sales, inventory/expiry, finance, and invoice-audit agents run sequentially with role-specific evidence payloads prepared by deterministic local code. Validated findings are added to shared `RuntimeState`, published as local messages, and optionally sent to Mozaik Network peers; incoming messages must match the dataset fingerprint and cite known evidence with grounded figures. The planner starts after analysts finish and filters candidates to successful analyst roles. Agents do not call model tools: Mozaik Core 6.0.0 drops Gemini `thought_signature` metadata when replaying a function-call turn. Deterministic calculations own all numerical results; `out/stockmind-review.md` includes daily/weekly summaries, source references, assumptions, and human-reviewed action candidates. The older `src/index.ts` remains the SEPA flow, available as `npm run dev:sepa`.

## Rules (hackathon scoring depends on these)

- **Every number has a source.** Retail findings cite evidence IDs and figures are checked against deterministic facts; planner figures must match selected candidate metrics. The legacy SEPA flow validates `{ value, quote }` extraction fields.
- **Agents never act alone.** The retail planner selects deterministic candidate actions only when their owning analyst succeeded; it cannot change prices, orders, or inventory. The legacy SEPA approval policy remains separate.
- **Free-text agent output is guarded too.** Retail figures are checked against cited facts or candidate metrics; Network messages are validated before use. The legacy Verifier draft uses `unsourcedFigures()`.
- **Agent prompts define INPUT, TASK, OUTPUT (exact JSON shape) and RULES.** Every retail JSON answer has a parser in `src/retail-parsing.ts` and a test.
- **Triggers are scoped to one producer** (`WhenAnswerFrom`), and each agent runs once. This prevents agent loops and runaway cost.
- **Synthetic data only.** Keep the "not financial advice" disclaimer in console and report output.
- **No MCP connection is configured by default.** Current inputs are local files. Pass read-only evidence payloads to agents; only add a remote POS/ERP MCP server after choosing a specific service and access policy.
- Never read, print, or commit `.env`.

## Unverified Mozaik details

Still to confirm in a real run:
- successful end-to-end Gemini analysis and report generation after avoiding tool-call cycles.

Confirmed from docs.jigjoy.ai: `runLoop` returns void and its errors aren't routed to the bus (hence the process-level handlers); `RuntimeState` subclasses and spec constructors typecheck against the real package; only listed model ids work (Gemini: `gemini-3.5-flash`, `gemini-3.1-pro-preview`); `gemini-3.5-flash-lite` is not in the docs but worked in a real run and is the default for its free-tier quota (15/min, 500/day).
