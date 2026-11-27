# StockMind AI — café/market finance desk

**Agents in Finance · built on Mozaik**

**▶ [Live demo: replay of a real run](https://ivanjanicevic.github.io/stockmind-ai/demo/)** · [Slides](https://ivanjanicevic.github.io/stockmind-ai/presentation.html). No install or API key needed. The replay plays back a recorded real run in the dashboard, and you can open any invoice and try the human approval (simulated in your browser).

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
| Sprite over-invoiced | faktura-07: 72 invoiced, 48 delivered | held, 2.016,00 RSD, claim; the supplier's corrected invoice F-OPT-2026-1003 (`data/korekcije/`) is ready after the re-check |
| Jelen beer over-invoiced | faktura-08: 140 invoiced, 120 delivered | held, 2.880,00 RSD, claim |
| Oat drink expired on delivery | otpremnica-03: expired 20.11.2026, delivered 26.11.2026 | held, 3.744,00 RSD, claim (short-dated cream is a warning) |
| Large clean invoice | faktura-01: 89.024,00 RSD, above the 50.000 RSD agent limit | waits for `--approve` |
| Clean invoice | faktura-06: 35.102,80 RSD | in the payment draft |
| Invoices in the register with no document | R-47/2026, F-ZP-2026-01262, F-MD-2026-55390 | reported, not paid |
| Schweppes Tonic sold beyond deliveries | 28 sold vs 24 delivered; first oversell on POS row 1905, receipt …-2193, 24.12.2026 13:41 | stock finding |
| Karamel latte demand collapse | 39 → 27 → 22 → 7 per week (−82 %), price unchanged | sales finding |
| Supplier price rises | espresso beans 2.450 → 3.480 (+42 %), milk, barista milk, domestic coffee | margin finding (espresso 88,75 % → 84,42 %) |
| Profit by product | espresso earns most in total (48.701,75 RSD), draught beer most per glass (188,33 vs 143,66 RSD) | profit ranking |
| Expired stock by lot | cream (two lots), Fanta, IVI, sparkling water expired with stock left; oat drink expired on arrival | inventory facts |
| Stock at risk | hot-chocolate powder and alcohol-free beer forecast to expire unsold on 31.12 | promotion candidates (discount ceiling, no invented uplift) |
| Reorder / overstock | Fanta, IVI, Schweppes, cream out of book stock; ~168 days of espresso beans | replenishment (quantities only with planning parameters) |
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

## Inventory planning

Section 6 of `out/review.md`, `out/recommendations.csv` and `out/sales-by-product.csv`. Everything is computed in `src/planning.ts`, and the **Inventory Planner** agent only interprets it.
- **Labels:** every number is marked **[FACT]** (computed from the data), **[FORECAST]** (projected from the last 14 days' demand) or **[RECOMMENDATION]** (a proposed action), with its source and limitations.
- **Sales by product:** units and revenue per day, 7-day week and calendar month.
  - Equivalent periods are compared: the last full week vs the week before. Products are flagged rising or falling at ±25 %, with at least 10 units in the earlier week.
  - Months are *not* compared: the data has 5 days of November and 25 of December, and the report says so.
- **Profit by product:**
  - net revenue (excl. VAT), cost of goods from recipes at the purchase price on each sale date, total gross profit and margin, ranked by total profit;
  - shown separately: average profit per unit and current profit per unit.
- **Expiry by delivered lot:**
  - Lots come from the **verified** delivery-note readings (quantity and expiry per line). Register deliveries without a note get *unknown* expiry, never an invented one.
  - Demand from recipes × sales is allocated to lots earliest-expiry-first, which gives expired-unsold, expired-on-arrival and at-risk lots, with cost at risk.
  - Stock is a **book estimate**: deliveries minus recipe use. It is never assumed to equal the delivered quantity, and there is no physical count in the data.
- **Promotions:** only for lots forecast to expire with stock left.
  - The row shows the units and cost at risk, the sales rate needed to clear the lot, and the maximum discount before a unit sells below cost.
  - There is no promotion history, so **no discount's effect on sales is estimated**.
- **Replenishment:**
  - Per material: book stock, demand per day and days of cover. It flags stock-out risk and overstock.
  - With planning parameters, it also gives the reorder point = demand × (lead time + safety days) and the order quantity = demand × (lead time + review + safety) − stock, in whole purchase units.
  - The dataset has no lead times, so `data/planiranje.json` provides **clearly labelled synthetic** ones for the demo. Without that file, no quantity is proposed and the row lists what's missing.
  - Confidence is never "high", because stock is a book estimate and there are only 30 days of history.

**Still missing for real-world use:**
- a physical stock count or opening stock;
- real supplier lead times, minimum order quantities and a safety-stock policy;
- promotion history, to estimate the effect of a discount;
- more than a month of sales, for seasonality;
- expiry dates for deliveries without a delivery note.

**Where the multi-agent work happens** (`src/index.ts`):
- **Concurrency.** All 3 analysts and all 14 clerks are started at once; the Inventory Planner starts on the event that the last delivery note is verified and runs alongside the claims writers, rate-limited to `REQUESTS_PER_MINUTE`. Matching and claims for one invoice start as soon as its two clerks answer, while other agents are still working. The report's **agent timeline** shows the overlap.
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
| `src/ap.ts` | Three-way match, payment decision, missing documents, corrected-invoice check |
| `src/pdf.ts` | Text layer of an uploaded PDF (corrected invoices), no dependencies |
| `src/analytics.ts` | Stock check, weekly trend, price rises, margins, period result |
| `src/planning.ts` | Sales and profit by product, lots and expiry risk, promotion candidates, replenishment, recommendation CSVs |
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

- **Run time and cost:** about 24 model calls, roughly 2.5 minutes at the default 10 calls per minute. Set `REQUESTS_PER_MINUTE=14` on Flash Lite to make it faster.
- **Output:** `out/review.md`, `out/payment-draft.csv`, `out/recommendations.csv` and `out/sales-by-product.csv`.
- **Live dashboard:** `npm run demo` runs the same desk and serves http://127.0.0.1:3000 (`DASHBOARD_PORT` to change it). Every agent loop appears as a bar on a timeline, so you can see them overlap, and the invoices update as they are matched. The page stays open after the run; press Ctrl+C to exit. It's optional: if the port is taken, the run continues without it.
- **Human approval:** to approve the invoice above the limit as the human approver, run `npm run dev -- --approve F-ZP-2026-01184`. It is then added to the payment draft as "Approved by human". Approving a held invoice has no effect.
- **Corrected invoice:** when a supplier answers a hold with a corrected invoice, open the held invoice in the dashboard and use **Upload corrected invoice (PDF)**, or pass it on the command line: `npm run dev -- --correct 07=data/korekcije/faktura-07-sokovi-dopuna-korekcija.pdf` (a synthetic correction of F-OPT-2026-0988). See [Corrected invoices](#corrected-invoices).

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

## Corrected invoices

A hold usually ends with the supplier sending a corrected invoice. The desk re-checks it with the same rules:

1. **Only a held invoice** can be replaced, and only once its agents are done (at most 2 corrections; then by hand). Ready, approved and waiting-for-approval invoices can't.
2. The PDF's text is read by `src/pdf.ts` (no dependencies). A scan or a file without text is rejected.
3. **A new Invoice Clerk** (a new agent that runs once, `Invoice Clerk 07 · v2`) reads it, and its answer is verified against that text like any other.
4. **Code runs the same three-way match** against the **unchanged delivery note** and the agreed prices of the **original** invoice number. The corrected invoice may keep the original number or have a new one; it must refer to this delivery note (`note_reference`) and come from the same supplier (`same_supplier`).
5. **Same decision rules:** ready, needs approval above the limit (approvals are per invoice number), or held again with a new claim. If the clerk fails or doesn't answer, the invoice stays held.
6. **History:** the held version, its problems and its claim stay on the case, in the dashboard and in `out/review.md`. The payment draft and report are rewritten.

**The delivery note is never replaced to clear a hold.** It is our own record of what physically arrived. If a supplier could send a "fixed" delivery note that matches their invoice, the three-way match would mean nothing.

`data/korekcije/faktura-07-sokovi-dopuna-korekcija.pdf` is made by `scripts/make-corrected-invoice.ts` from the original PDF: same layout and fonts, the Sprite quantity set to the delivered 48, and every total recomputed (26.380,80 RSD).

## Demo material

**Publishing the replay demo** (GitHub Pages, no hosting cost, no API key on the site):
1. `npm run record` does one real run (about 25 model calls) and writes `docs/demo/replay.json`, with every state change of the run, plus copies of the PDFs. It includes the corrected invoice for F-OPT-2026-0988 (`--correct 07=…`), so the replay shows a hold being resolved.
2. Commit `docs/` and push.
3. On GitHub, go to Settings → Pages → Deploy from branch → `main` / `/docs`.

The site is `docs/index.html` (landing page) → `docs/demo/` (the dashboard in replay mode). Until a recording exists, the demo page says so. It never shows made-up data.

- `docs/presentation.html`: slides; open it in a browser and use ← / →.
- `docs/video-script.md`: a 2-minute recording script, synced to the slides and the live dashboard.

## Tests

```bash
npm test           # unit tests, no API calls: analytics on the real data, document verification, three-way match, guards
npm run typecheck
```

`test/ideal.ts` is a test-only parser for this one synthetic invoice template. It produces the answers a perfect clerk would give, so the matching logic is tested without a model. In the app, the LLM reads the documents (any layout) and code verifies what it read.

## Limitations

- **PDF text.** For the sample documents it is pre-extracted to `data/text/*.txt` with macOS PDFKit (`scripts/extract-pdf-text.sh`). Uploaded corrected invoices are read by `src/pdf.ts`, which handles text PDFs like these (Flate/ASCII85 streams, ToUnicode or WinAnsi fonts); a test checks it gives the same lines as PDFKit for all 14 sample PDFs. Scans and encrypted PDFs are rejected.
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
npm run demo       # Same, with the live dashboard on http://127.0.0.1:3000
npm run record     # A real run (with the sample corrected invoice) saved to docs/demo/ for the replay
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
