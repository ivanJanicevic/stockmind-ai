# StockMind AI

**Agents in Finance: from invoices to a validated SEPA payment draft**

Accounts payable teams receive invoices and emails in every format. Someone retypes the payment details, checks them, and catches the one email that says "our bank account has changed". StockMind AI hands that work to a team of Mozaik agents. Every value is traced back to its source document, and anything doubtful goes to a human.

> Draft for human review only. Not financial advice. No payment is ever sent. All data is synthetic.

## What it does

1. Six synthetic documents (invoices and emails) go to six **Extractor agents in parallel**.
2. Each extraction is checked against the source and the vendor master by **deterministic checks**.
3. An **Auditor agent** per document independently reviews the extraction, the check results, and fraud signals.
4. A **payment policy** decides per document:
   - **Ready**: all checks pass and the auditor approves. Included in the SEPA draft.
   - **Needs human approval**: clean, but above the agent's spending limit (`APPROVAL_LIMIT_EUR`).
   - **Blocked**: any failed check, auditor concern, or agent error.
5. Output:
   - `out/sepa-draft.xml`: ISO 20022 `pain.001.001.09` credit transfer draft for the ready payments.
   - `out/review.md`: per-document decision, every value with its source quote, all checks and auditor issues.

The sample batch is built to exercise the checks:

| Document | Scenario | Expected |
| --- | --- | --- |
| INV-1001 | Clean invoice | Ready |
| INV-1002 | "Urgent, our bank details changed" email, IBAN differs from vendor master | Blocked |
| INV-1003 | IBAN with a typo (checksum fails) | Blocked |
| INV-1004 | EUR 12,400, above the agent limit | Needs human approval |
| INV-1005 | Reminder email for INV-1001 (duplicate) | Blocked |
| INV-1006 | Clean invoice | Ready |

## Architecture

```text
                    ┌─────────────── shared RuntimeState: one case per document ───────────────┐
 document 1 ──> Extractor 1 ──> source + vendor checks ──> Auditor 1 ──┐
 document 2 ──> Extractor 2 ──> source + vendor checks ──> Auditor 2 ──┤
    ...            (all in parallel)                                      ├──> duplicate check ──> payment policy ──> SEPA draft + review report
 document 6 ──> Extractor 6 ──> source + vendor checks ──> Auditor 6 ──┘
```

- **Extractor agents** return JSON constrained by a JSON Schema through Mozaik's structured output. Each value comes with a `quote` copied from the document. If a model rejects the schema, the run retries without it and relies on the prompt contract and a tolerant parser.
- **Source checks** (`src/parsing.ts`) reject any value whose quote is not in the document, or whose value does not match its quote. An invented number can't reach the payment file.
- **Validation checks** (`src/checks.ts`): IBAN mod-97 checksum, EUR currency, known vendor, IBAN matches the vendor master, line items sum to the total, positive amount, and duplicates across the batch.
- **Auditor agents** are a second, independent agent per document. They see the original, the extraction and the check results, and must cite evidence for each issue.
- **Shared state** is a Mozaik `RuntimeState` holding one case per document. Every agent and check writes its result there, and the report is built from it.
- **Usage**: token counts from `inference.completed` events are summed and shown in the console and the report.
- **Safety**: each agent only reacts to its own predecessor and runs once. There's an overall timeout, and on timeout a partial report is still written.

| File | Role |
| --- | --- |
| `src/index.ts` | Runtime, agents, wiring, output |
| `src/prompts.ts` | Agent instructions with input/output contracts |
| `src/parsing.ts` | JSON parsing and source verification |
| `src/checks.ts` | Validation checks and payment policy |
| `src/sepa.ts` | pain.001 XML builder |
| `src/report.ts` | Review report |
| `src/data/` | Synthetic invoices, vendor master, debtor account |

## Prerequisites

- Node.js 24+
- npm
- A Google Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

## Run it

```bash
git clone https://github.com/ivanJanicevic/stockmind-ai.git
cd stockmind-ai
npm install
cp .env.example .env   # then set GEMINI_API_KEY
npm run dev
```

Then open `out/review.md` and `out/sepa-draft.xml`.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | yes | – | Google Gemini API key |
| `GEMINI_MODEL` | no | `gemini-3.5-flash` | Model used by all agents |
| `FALLBACK_MODELS` | no | – | Comma-separated [Mozaik-supported model ids](https://docs.jigjoy.ai/docs/models) to switch to on quota or overload errors, e.g. `claude-haiku-4-5` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | only for those fallbacks | – | Key for a non-Gemini fallback model |
| `RUN_TIMEOUT_MS` | no | `180000` | Stop and write a partial report after this time |
| `APPROVAL_LIMIT_EUR` | no | `5000` | Payments above this need human approval |

## Troubleshooting

- **Retries:**
  - On **503/500** (Gemini overloaded), pending agents are retried twice with backoff, then moved to the next model in `FALLBACK_MODELS`.
  - On **429** (quota exceeded), they switch to the next fallback model straight away.
- **`model call failed (429)`** after retries: the Gemini free tier allows about 20 requests per day per model, and one run makes at least 12 (6 Extractors + 6 Auditors). Set `FALLBACK_MODELS` (e.g. `claude-haiku-4-5` with `ANTHROPIC_API_KEY`), wait for the reset, or enable billing on the key. Only Mozaik-supported ids work. Gemini has `gemini-3.5-flash` and `gemini-3.1-pro-preview`.
- If every model fails, the run still writes `out/review.md`, and the affected documents are marked Blocked with the error.
- **`mozaik cloud: no API key`**: optional telemetry. Run `npx @mozaik-ai/cloud-sdk pair` to watch the agent loops live on JigJoy, or ignore it.

## Scripts

```bash
npm run dev        # Run the agents (calls Gemini)
npm test           # Unit tests, no API calls
npm run typecheck  # Type-check
npm run build      # Compile to dist/
npm start          # Run the compiled build
```

## Ground rules

- **Synthetic data only.** All companies, IBANs and invoices are made up.
- **Every number has a source.** Each value in the report shows the document and the exact quote it came from.
- **Not financial advice.** The report and console output say so. Nothing is sent to a bank.

## Hackathon

Built for the JigJoy hackathon, *Agents in Finance* track, on [Mozaik](https://www.npmjs.com/package/@mozaik-ai/core).
