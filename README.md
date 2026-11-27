# StockMind AI — café finance desk

**Agents in Finance · built on Mozaik**

A small café's owner gets supplier invoices, delivery notes, a POS export and monthly bills, and has no finance team to check them. Before paying, someone should ask:
- Did we actually receive what we're invoiced for, at the agreed price?
- Is anything expired?
- Is stock going missing?
- Are supplier price rises and new costs quietly turning the month into a loss?

StockMind AI hands that to a team of Mozaik agents that work **at the same time** on one shared state:
- clerks read every document;
- analysts interpret code-computed numbers;
- code checks every agent against the sources and against the other agents;
- a reviewer combines everything into this week's priorities.

Payments are drafted only for invoices that pass every check. Anything doubtful is held for a person, with a supplier claim already drafted.

**Intended user:** the owner or bookkeeper of a small café or shop. The demo uses the synthetic café „Plava Šolja“ (Belgrade, RSD).

> Decision support on synthetic data. Not financial advice. No payment or e-mail is ever sent.

## What it finds in the sample data

Every row below is found by code from `data/`, and the tests in `test/` pin each number.

| Problem | Evidence | Result |
| --- | --- | --- |
| Coca-Cola invoiced above the agreed price | faktura-04: 79,00 vs agreed 72,00 per bottle | invoice held, 806,40 RSD at stake, claim drafted |
| Espresso beans over-invoiced | faktura-05: 22 invoiced, 20 on the delivery note | held, 5.880,00 RSD, claim |
| Sprite over-invoiced | faktura-07: 72 invoiced, 48 delivered | held, 2.016,00 RSD, claim |
| Jelen beer over-invoiced | faktura-08: 140 invoiced, 120 delivered | held, 2.880,00 RSD, claim |
| Oat drink expired on delivery | otpremnica-03: expired 20.11.2026, delivered 26.11.2026 | held, 3.744,00 RSD, claim (short-dated cream is a warning) |
| Large clean invoice | faktura-01: 89.024,00 RSD, above the 50.000 RSD agent limit | waits for `--approve` |
| Clean invoice | faktura-06: 35.102,80 RSD | in the payment draft |
| Invoices in the register with no document | R-47/2026, F-ZP-2026-01262, F-MD-2026-55390 | reported, not paid |
| Schweppes Tonic sold beyond deliveries | 28 sold vs 24 delivered; first oversell on POS row 1905, receipt …-2193, 24.12.2026 13:41 | stock finding |
| Karamel latte demand collapse | 39 → 27 → 22 → 7 per week (−82 %), price unchanged | sales finding |
| Supplier price rises | espresso beans 2.450 → 3.480 (+42 %), milk, barista milk, domestic coffee | margin finding (espresso 88,75 % → 84,42 %) |
| Month turns into a loss | run-rate result 30.079,68 → −16.998,72 RSD; rent, electricity, card fees and maintenance up 50.550 RSD a month | margin and cost finding |

## Architecture

```text
 t=0 ──┬─ Stock Analyst ──────────┐   (code-computed rows: stock vs deliveries)
       ├─ Sales Analyst ──────────┤   (weekly demand per product)
       ├─ Margin & Cost Analyst ──┤   (price rises, margins, P&L, cost changes)
       │                          │
       ├─ Invoice Clerk 01 ──┐    │
       ├─ Receiving Clerk 01 ┴─ three-way match ─ held? ─> Claims Writer 01
       │        …  7 invoice / delivery-note pairs, all in parallel  …
       ├─ Invoice Clerk 08 ──┐    │
       └─ Receiving Clerk 08 ┴─ three-way match ─ held? ─> Claims Writer 08
                                  │
              all specialists in ─┴─> Reviewer ─> payment decision ─> human --approve
                                                     │
                            out/review.md  +  out/payment-draft.csv (draft, not sent)

   all results live in one Mozaik RuntimeState; a Monitoring participant reacts to
   every model.answer event and starts the agents that depend on it
```

**Where the multi-agent work happens** (`src/index.ts`):
- **Concurrency.** All 3 analysts and all 14 clerks are started at once, rate-limited to `REQUESTS_PER_MINUTE`. Matching and claims for one invoice start as soon as its two clerks answer, while other agents are still working. The report's **agent timeline** shows the overlap.
- **Shared state.** `AppState extends RuntimeState` holds the invoice cases, analyst results, review and timeline. Every agent's result is written there, and the report is built from it.
- **Coordination through events.** The Monitoring participant handles Mozaik `model.answer` events. Two clerk answers for a pair trigger the three-way match; a hold triggers that invoice's Claims Writer; all specialists done triggers the Reviewer. `inference.completed` events are summed into token usage.
- **Checks between agents.**
  - The Invoice Clerk and Receiving Clerk read different documents, and code compares their outputs with each other and with the agreed prices.
  - Each analyst finding must cite a code-computed row and may only use that row's figures.
  - The Reviewer may only cite accepted findings and AP results.
  - Claim drafts may only use figures from the documents and failed checks.
  - If our own clerks' reading can't be verified, no claim is sent and a person re-checks the invoice.

**Every number has a source:**
- **Document values** (`src/documents.ts`). Every value a clerk returns carries a verbatim quote, and the quote must be in the document. Amounts must appear in it as printed, for example `175,00`.
- **Business numbers** (`src/analytics.ts`). Computed by code with file and line sources, for example `promet_2026-11-26_do_2026-12-25.csv:1905` or `nabavne_cene.csv:19`. The analysts never see the 2.000 POS rows, only the computed rows.
- **Free text.** Findings, review actions and claim drafts are checked by `unsourcedFigures` (`src/parsing.ts`), and anything with an unsourced figure is rejected and listed in the report.

| File | Role |
| --- | --- |
| `src/index.ts` | Mozaik runtime, agents, event coordination, rate-limited queue, retries, output |
| `src/agents.ts` | Agent instructions (INPUT / TASK / OUTPUT / RULES) and JSON Schemas |
| `src/documents.ts` | Invoice and delivery-note answers: parsing and verification against the text |
| `src/ap.ts` | Three-way match, payment decision, missing documents |
| `src/analytics.ts` | Stock check, weekly trend, price rises, margins, period result |
| `src/findings.ts` | Guards for analyst findings and the review |
| `src/payments.ts`, `src/report.ts` | Payment draft CSV and `out/review.md` |
| `src/dashboard.ts` | Optional live dashboard (`npm run demo`), no dependencies |
| `src/data/load.ts` | Loads `data/` with line numbers |
| `data/` | Synthetic café dataset (see `data/README.md`); `data/text/` is the text layer of the PDFs |

## Run it

Prerequisites: Node.js 24+, npm, and a Google Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). The free tier is enough.

```bash
git clone https://github.com/ivanJanicevic/stockmind-ai.git
cd stockmind-ai
npm install
cp .env.example .env   # then set GEMINI_API_KEY
npm run dev
```

- **Run time and cost:** about 23 model calls, roughly 2.5 minutes at the default 10 calls per minute. Set `REQUESTS_PER_MINUTE=14` on Flash Lite to make it faster.
- **Output:** `out/review.md` and `out/payment-draft.csv`.
- **Live dashboard:** `npm run demo` runs the same desk and serves http://localhost:3000 (`DASHBOARD_PORT` to change it). Every agent loop appears as a bar on a timeline, so you can see them overlap, and the invoices update as they are matched. The page stays open after the run; press Ctrl+C to exit. It's optional: if the port is taken, the run continues without it.
- **Human approval:** to approve the invoice above the limit as the human approver, run `npm run dev -- --approve F-ZP-2026-01184`. It is then added to the payment draft as "Approved by human". Approving a held invoice has no effect.

End of a run: the invoice decisions are deterministic, while finding counts depend on the model:

```text
F-ZP-2026-01184: needs_approval
F-MD-2026-55271: held (expired MD-MB-1000) + claim drafted
F-OPT-2026-0931: held (price OPT-CC-025) + claim drafted
F-ZP-2026-01197: held (quantity ZP-ESP-1000) + claim drafted
F-MD-2026-55302: ready
F-OPT-2026-0988: held (quantity OPT-SP-025) + claim drafted
F-HS-2026-0412: held (quantity HS-JL-050) + claim drafted
Stock Analyst: … findings accepted, … rejected
…
To approve as a human, re-run with: npm run dev -- --approve F-ZP-2026-01184

Report: out/review.md
Payment draft: out/payment-draft.csv (1 orders, 35.102,80 RSD)
```

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | yes | – | Google Gemini API key |
| `GEMINI_MODEL` | no | `gemini-3.5-flash-lite` | Model for all agents (free tier: 15 requests/min, 500/day) |
| `FALLBACK_MODELS` | no | – | Comma-separated [Mozaik-supported model ids](https://docs.jigjoy.ai/docs/models) to switch to on quota or overload errors, e.g. `gemini-3.5-flash,claude-haiku-4-5` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | only for those fallbacks | – | Key for a non-Gemini fallback model |
| `REQUESTS_PER_MINUTE` | no | `10` | Client-side rate limit for model calls (use `5` with `gemini-3.5-flash` on the free tier) |
| `RUN_TIMEOUT_MS` | no | `600000` | Stop and write a partial report after this time |
| `APPROVAL_LIMIT_RSD` | no | `50000` | Invoices above this need human approval |
| `MOZAIK_INVITE` | no | – | Quoted hosted Mozaik Network invite link (see below) |

**Mozaik Network (optional).** With `MOZAIK_INVITE` set (quote it, the link contains `#`), each agent also joins the hosted Network as a peer:
- The peers mirror the agent names for visibility only. They receive no data and do no work; the collaboration happens in the local Mozaik runtime.
- Joining runs in the background with a 15 s timeout and can never stop a run. The report shows the Network status.

## Demo material

- `docs/presentation.html`: slides; open it in a browser and use ← / →.
- `docs/video-script.md`: a 2-minute recording script, synced to the slides and the live dashboard.

## Tests

```bash
npm test           # unit tests, no API calls: analytics on the real data, document verification, three-way match, guards
npm run typecheck
```

`test/ideal.ts` is a test-only parser for this one synthetic invoice template. It produces the answers a perfect clerk would give, so the matching logic is tested without a model. In the app, the LLM reads the documents (any layout) and code verifies what it read.

## Limitations

- **PDF text.** It is pre-extracted to `data/text/*.txt` with macOS PDFKit (`scripts/extract-pdf-text.sh`); the app reads the text, not the PDF.
- **Bank accounts.** The supplier accounts are synthetic placeholders that don't pass the Serbian mod-97 control, so only their format and the supplier-master match are checked.
- **Stock** is deliveries (purchase register) minus recipe consumption. There is no physical stock count.
- **Period result** is a run-rate: gross margin per day × 30 − that month's fixed costs (excl. VAT). Cost of goods uses recipe cost at the purchase price in force on each sale date. The period is split at the first supplier price rise (2026-12-10). The trend uses 4 full weeks.
- **Model reading errors.** Flash Lite can misread a line. Verification fails closed: a misread holds the invoice and never pays it, and the report shows why.
- **Free tier.** About 20 runs a day on Flash Lite. See Troubleshooting for quota errors.

## Troubleshooting

- **Retries.**
  - **503/500:** pending agents are retried twice with backoff, then moved to `FALLBACK_MODELS`.
  - **429 per-minute limit:** they wait Gemini's `retryDelay` and stay on the same model.
  - **429 daily quota:** they switch to the next fallback straight away.
- **If every model fails**, `out/review.md` is still written, with the affected items marked.
- **`mozaik cloud: no API key`** is optional telemetry. Run `npx @mozaik-ai/cloud-sdk pair` to watch every agent loop live on JigJoy, or ignore it.

## Scripts

```bash
npm run dev        # Run the desk (calls the model)
npm run demo       # Same, with the live dashboard on http://localhost:3000
npm test           # Unit tests, no API calls
npm run typecheck  # Type-check
npm run build      # Compile to dist/
npm start          # Run the compiled build
```

## Ground rules

- **Synthetic data only.** Every company, PIB, account, e-mail and document is made up; the PDFs say "PRIMER / SPECIMEN".
- **Every number has a source.** Each figure in the report shows its file and line or its document quote, and agent text with unsourced figures is rejected.
- **Not financial advice.** The console, report and payment draft say so. Nothing is sent to a bank or a supplier.

## Hackathon

Built for the JigJoy hackathon, *Agents in Finance* track, on [Mozaik](https://www.npmjs.com/package/@mozaik-ai/core).
