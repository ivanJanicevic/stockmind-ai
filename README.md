# StockMind AI

**Agents in Finance: from invoices to a validated SEPA payment draft**

Accounts payable teams receive invoices and emails in every format. Someone retypes the payment details, checks them, and has to catch the one email that says "our bank account has changed". StockMind AI hands that work to a team of Mozaik agents:
- every value is traced back to a quote in its source document;
- every agent's work is checked by code and by another agent;
- anything doubtful is held for a human, with a verification request already drafted.

> Draft for human review only. Not financial advice. No payment is ever sent. All data is synthetic.

## What it does

1. Six synthetic documents (invoices and emails) each start an **Extractor and an independent Auditor concurrently**. All twelve analysis loops are launched without waiting for another agent's answer.
2. **Deterministic checks** test each extraction against the source document and vendor master, while the Auditor independently reviews the document and vendor master for fraud signals. Their results are combined in shared runtime state.
3. If bank details look wrong or fraudulent, a **Verifier agent** starts after the parallel analysis is complete. It drafts a call-back request to the vendor's contact **on file**, never to whoever sent the document.
4. A **payment policy** decides each document:
   - **Ready**: all checks pass and the Auditor approves. Included in the SEPA draft.
   - **Needs human approval**: clean, but above the agent's spending limit (`APPROVAL_LIMIT_EUR`). A human releases it with `--approve`.
   - **Blocked**: any failed check, Auditor concern, or agent error. Blocked payments can't be approved past.
5. Output:
   - `out/sepa-draft.xml`: an ISO 20022 `pain.001.001.09` credit transfer draft for the released payments.
   - `out/review.md`: the decision for each document, every value with its source quote, all checks, Auditor issues and verification drafts.

The sample batch is built to exercise every control:

| Document | Scenario | What catches it | Result |
| --- | --- | --- | --- |
| INV-1001 | Clean invoice | – | Ready |
| INV-1002 | "URGENT – new bank details" email from a lookalike domain | IBAN ≠ vendor master, sender domain ≠ vendor domain, Auditor | Blocked + verification request |
| INV-1003 | IBAN with a typo | mod-97 checksum, vendor master, Auditor | Blocked + verification request |
| INV-1004 | EUR 12,400, above the agent limit | approval policy | Needs human approval |
| INV-1005 | Reminder email for INV-1001 | batch duplicate check | Blocked |
| INV-1006 | Clean invoice | – | Ready |

## Architecture

```text
                       shared Mozaik RuntimeState: one case per document
          ┌──────────────────────────────────────────────────────────────────┐
 document 1 ──┬─> Extractor 1 ─> source + vendor checks ────────────────┐   │
              └─> Auditor 1 ───> independent source/vendor review ──────┤   │
 document 2 ──┬─> Extractor 2 ─> source + vendor checks ────────────────┤   │
              └─> Auditor 2 ───> independent source/vendor review ──────┤   │
    ...          all Extractor and Auditor loops launch in parallel      ├───┴─> combine results
 document 6 ──┬─> Extractor 6 ─> source + vendor checks ────────────────┤          │
              └─> Auditor 6 ───> independent source/vendor review ──────┘          ├─ bank issue? ─> Verifier
                                                                               └─> duplicate check ─> policy
                                                                                     ├─> SEPA draft
                                                                                     └─> review report
```

- **Genuine parallel work:** each document's Extractor and Auditor are launched together. The Auditor independently reviews the source document and vendor master; deterministic checks validate the Extractor's result. The monitor combines both answers in the shared case state. The Verifier runs only when those results show that bank details need confirmation.
- **Structured output:** Extractor, Auditor and Verifier answers are constrained by JSON Schemas through Mozaik's `structuredOutput`. If a model rejects a schema, the run retries without it and relies on the prompt contract and a tolerant parser.
- **Every number has a source** (`src/parsing.ts`):
  - Extracted values whose quote isn't in the document, or doesn't match the value, are rejected.
  - A Verifier draft that contains a figure not found in the document, the vendor master or the extraction is withheld.
- **Validation checks** (`src/checks.ts`):
  - IBAN mod-97 checksum, EUR currency, known vendor, IBAN matches the vendor master;
  - the email sender's domain matches the vendor domain;
  - line items sum to the total, the amount is positive, and no duplicates across the batch.
- **Human in the loop:** payments above `APPROVAL_LIMIT_EUR` wait for `--approve <id>`. Approval never overrides a failed check or an Auditor concern.
- **Resilience:**
  - model calls are rate-limited (`REQUESTS_PER_MINUTE`);
  - Gemini 429/503 errors are retried or moved to `FALLBACK_MODELS`;
  - if everything fails, a partial report is still written.
- **Usage:** token counts from `inference.completed` events are summed and shown in the console and the report.
- **Mozaik Network (optional):** set `MOZAIK_INVITE` to a quoted hosted Network invite link to join one peer per Extractor, Auditor and Verifier. Quote the value because the link contains `#`. The peers only mirror the agent names for visibility: they don't receive invoice data and don't take part in the work, which happens in the local Mozaik runtime. Joining runs in the background with a 15-second timeout, and a failure never stops the run; the report shows the Network status.

| File | Role |
| --- | --- |
| `src/index.ts` | Runtime, agents, event wiring, retries, output |
| `src/prompts.ts` | Agent instructions with input/output contracts and JSON Schemas |
| `src/parsing.ts` | Answer parsing and source verification |
| `src/checks.ts` | Validation checks, verification trigger, payment policy |
| `src/sepa.ts` | pain.001 XML builder |
| `src/report.ts` | Review report |
| `src/data/` | Synthetic invoices, vendor master, debtor account |

## Prerequisites

- Node.js 24+
- npm
- A Google Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). The free tier is enough.

## Run it

```bash
git clone https://github.com/ivanJanicevic/stockmind-ai.git
cd stockmind-ai
npm install
cp .env.example .env   # then set GEMINI_API_KEY
npm run dev
```

A run takes about 1.5 minutes: 14 model calls at 10 per minute. Then open `out/review.md` and `out/sepa-draft.xml`.

To act as the human approver for the payment above the limit:

```bash
npm run dev -- --approve INV-1004
```

INV-1004 is then included in the SEPA draft as "Approved by human". Trying `--approve INV-1002` has no effect, because blocked payments stay blocked.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | yes | – | Google Gemini API key |
| `GEMINI_MODEL` | no | `gemini-3.5-flash-lite` | Model used by all agents (free tier: 15 requests/min, 500/day) |
| `FALLBACK_MODELS` | no | – | Comma-separated [Mozaik-supported model ids](https://docs.jigjoy.ai/docs/models) to switch to on quota or overload errors, e.g. `gemini-3.5-flash,claude-haiku-4-5` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | only for those fallbacks | – | Key for a non-Gemini fallback model |
| `REQUESTS_PER_MINUTE` | no | `10` | Client-side rate limit for model calls. Use `5` with `gemini-3.5-flash` on the free tier |
| `RUN_TIMEOUT_MS` | no | `600000` | Stop and write a partial report after this time |
| `APPROVAL_LIMIT_EUR` | no | `5000` | Payments above this need human approval |
| `MOZAIK_INVITE` | no | – | Quoted hosted Mozaik Network invite link; joins each agent as a peer |

## Troubleshooting

- **Retries:**
  - **503/500** (Gemini overloaded): pending agents are retried twice with backoff, then moved to the next model in `FALLBACK_MODELS`.
  - **429 per-minute limit:** they wait Gemini's `retryDelay` and retry on the same model.
  - **429 daily quota:** they switch to the next fallback model straight away.
- **`model call failed (429)` after retries:** the free-tier daily quota for that model is used up. Set `FALLBACK_MODELS`, wait for the reset, or enable billing on the key.
- If every model fails, the run still writes `out/review.md`, and the affected documents are marked Blocked with the error.
- **`mozaik cloud: no API key`:** optional telemetry. Run `npx @mozaik-ai/cloud-sdk pair` to watch every agent loop live on JigJoy, or ignore the message.

## Scripts

```bash
npm run dev        # Run the agents (calls Gemini)
npm test           # Unit tests, no API calls
npm run typecheck  # Type-check
npm run build      # Compile to dist/
npm start          # Run the compiled build
```

## Ground rules

- **Synthetic data only.** All companies, IBANs, emails and invoices are made up.
- **Every number has a source.** Each value in the report shows the exact quote it came from, and agent drafts with unsourced figures are withheld.
- **Not financial advice.** The report and console output say so. Nothing is sent to a bank or a vendor.

## Hackathon

Built for the JigJoy hackathon, *Agents in Finance* track, on [Mozaik](https://www.npmjs.com/package/@mozaik-ai/core).
