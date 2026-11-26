# StockMind AI

Mozaik multi-agent accounts payable prototype (JigJoy hackathon, Agents in Finance track). It turns synthetic invoices and emails into a validated SEPA pain.001 payment draft plus a review report.

## Commands

- `npm test` — unit tests in `test/` (Node test runner via tsx, no LLM calls)
- `npm run typecheck` — type-check `src/` (runs after every edit via hook once `node_modules` exists)
- `npm run build` — compile to `dist/`
- `npm run dev` — real run; **calls Gemini and costs credits**, ask before running. Writes `out/`.

## Architecture

Per document: Extractor agent → deterministic checks → Auditor agent. All documents run in parallel and share `AppState.cases` (a Mozaik `RuntimeState`). When every case is done, or on timeout: duplicate check → `decide()` → `out/sepa-draft.xml` + `out/review.md`. See README for the file map.

## Rules (hackathon scoring depends on these)

- **Every number has a source.** Agent outputs are `{ value, quote }`. `unverifiedFields()` rejects anything not traceable to the document. Never add a value to the report or SEPA file that skipped this.
- **Agents never decide alone.** `decide()` blocks on any failed check, a non-`ok` audit, or an agent error. Amounts above `APPROVAL_LIMIT_EUR` go to a human.
- **Agent prompts define INPUT, TASK, OUTPUT (exact JSON shape) and RULES.** Every JSON answer has a parser in `src/parsing.ts` and a test.
- **Triggers are scoped to one producer** (`WhenAnswerFrom`), and each agent runs once. This prevents agent loops and runaway cost.
- **Synthetic data only.** Keep the "not financial advice" disclaimer in console and report output.
- Never read, print, or commit `.env`.

## Unverified Mozaik details

The Mozaik source wasn't available when this was written (registry and GitHub blocked). Confirm these in `node_modules/@mozaik-ai/core` and the docs:
- the `model.answer` payload shape (`answerText` guesses `text`/`content`/`answer`/`message`);
- whether `RuntimeState` subclasses can hold fields, and whether `SituationSpecification` subclasses can take constructor args;
- whether a failed `runLoop` emits an error event (we only catch thrown or rejected errors);
- native structured output (JSON Schema on `InferenceInput`), which could replace prompt-level JSON.
