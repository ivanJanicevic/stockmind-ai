# StockMind AI

StockMind AI is a Mozaik multi-agent prototype for a small cafe or market. It reads the synthetic data in `data/` and produces evidence-backed analysis of sales, stock, expiry, supplier invoices, purchase costs, and operating expenses.

The default app is the retail analysis. A previous invoice-to-SEPA demo is preserved as a separate command.

> Synthetic demo only. Not financial advice. Recommendations are for human review; no prices, orders, or stock records are changed.

## What the retail agents do

Four Mozaik analysts run one at a time so each later analyst can read earlier validated findings from shared runtime state:

1. **Sales & Demand Analyst** reviews daily and weekly sales, refunds, best sellers, and declining demand.
2. **Inventory & Expiry Analyst** compares recipe-derived consumption with dispatch-note quantities and tracks dated lots.
3. **Cost & Margin Analyst** calculates recipe-based gross margins, supplier price changes, and monthly operating-cost trends.
4. **Invoice Reconciliation Auditor** compares supplier invoice PDFs with matching delivery-note PDFs and purchase history.

After those results are validated and saved in shared `RuntimeState`, a **Promotion & Action Planner** selects from deterministic candidates. It cannot invent new figures, prices, discounts, or demand uplift. Network messages from peers using the same dataset are also available as untrusted observations for local agents and the planner.

All calculations are deterministic TypeScript. Each agent receives a role-specific, read-only evidence payload prepared from local files. Findings cite evidence IDs, and every reported figure is checked against deterministic facts for those IDs; planner figures must match the selected candidates' metrics. The retail agents do not make Gemini function calls: the installed Mozaik Core drops Gemini `thought_signature` metadata when replaying tool-call context, so the agents use precomputed evidence and do not need a second tool turn.

The report includes daily and weekly sales, product trends, recipe-based margins, recorded stock gaps, expiry exposure, purchase-price changes, monthly expenses, proposed actions, evidence IDs, source rows, and assumptions.

## Data used

| Input | Use |
| --- | --- |
| `data/promet_2026-11-26_do_2026-12-25.csv` | POS line items, dates, quantities, prices, refunds, and receipts |
| `data/artikli.json` | Product names, categories, prices, VAT, and delivery-note mapping |
| `data/normativi.json` | Recipe quantities and supplier-package conversions |
| `data/nabavne_cene.csv` | Supplier invoice line items and purchase-cost history |
| `data/troskovi.csv` | Monthly operating expenses |
| `data/fakture/*.pdf` | Supplier invoice documents for reconciliation |
| `data/otpremnice/*.pdf` | Delivery quantities and expiry dates |

The CSV files use semicolons and Serbian decimal commas. The PDF inputs are text-extracted locally with Poppler's `pdftotext`; install Poppler if the command is missing (Ubuntu/Debian: `sudo apt install poppler-utils`).

### Interpretation limits

- The dataset is synthetic and covers **26 November–25 December 2026**. The report treats those dates as the data window, not as the live current date.
- The final partial week is excluded when comparing complete weekly trends.
- Refunds reduce reported sales and revenue. Whether returned goods went back into stock is not recorded.
- A sales-versus-delivery shortfall is a reconciliation warning, not proof of loss: opening stock and missing delivery records are unknown.
- Expiry results are retrospective for the supplied window, not a live stock count.
- There is no comparable promotion history, so StockMind does not claim that a discount will increase demand or profit. It can suggest a small, human-reviewed test and show supporting evidence, but it does not invent an uplift or discount price.
- Monthly run-rate is a simple 30-day extrapolation of observed gross margin minus listed expenses. It is not accounting profit or a forecast.

## Run

Requirements: Node.js 24+, npm, Poppler (`pdftotext`), and a Gemini API key.

```bash
npm install
cp .env.example .env
# Add GEMINI_API_KEY to .env
npm run dev
```

`npm run dev` calls Gemini and may use API quota/credits. It has not been run as part of the automated tests. The generated report is `out/stockmind-review.md`.

To run the compiled version:

```bash
npm run build
npm start
```

## Agent monitoring and Mozaik

- Analyst loops run sequentially; accepted findings are published as local `message.sent` events and added to shared `RuntimeState`. The planner starts after all analysts finish, including when one analyst failed, and only receives candidates supported by successful analysts.
- Console logs show loop starts, accepted answers, token usage, and failures. Cloud `tools 0` is expected because the agents receive evidence in their prompts rather than calling model tools.
- Cloud telemetry defaults to `MOZAIK_REDACTION=content`: this preserves agent metadata while redacting prompts and memory, avoiding the Cloud SDK's payload-size cap from dropping agent state. Set it to `none` only if you explicitly want full prompt content sent to Cloud.
- If `MOZAIK_INVITE` is set, the five local agents join the invited Mozaik Network with a receive policy. They send only validated summaries, findings, and evidence IDs—not CSV rows, PDFs, or raw source data. Incoming messages are checked for the exact dataset fingerprint, known evidence IDs, and grounded figures; use the same data snapshot on the participating runs.
- Local evidence is derived only from the checked-in synthetic files and deterministic calculations. The agents do not update a POS or external system.

### Skills and MCP

The project’s `.claude/skills/` files are coding-assistant instructions; Mozaik runtime loops do not automatically load them. Each runtime agent instead gets its role and rules from `src/retail-prompts.ts`.

Mozaik Core includes `McpToolRegistry`, but this demo does not connect to a remote MCP server because all required inputs are already local. If the project later connects to a real POS, inventory, or accounting platform, add a specific **read-only** MCP server and validate its data. Do not expose price changes, purchase orders, or other write actions without explicit human approval and an audit trail.

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | for live agent runs | — | Google Gemini API key |
| `GEMINI_MODEL` | no | `gemini-3.5-flash-lite` | Primary model |
| `FALLBACK_MODELS` | no | empty | Comma-separated Mozaik-supported fallback model IDs |
| `REQUESTS_PER_MINUTE` | no | `10` | Client-side initial loop rate limit |
| `RUN_TIMEOUT_MS` | no | `600000` | Timeout before a partial report is written |
| `MOZAIK_INVITE` | no | empty | Optional quoted hosted Network invite link |
| `MOZAIK_REDACTION` | no | `content` in the retail app | Cloud telemetry redaction (`content`, `all`, or `none`) |

`APPROVAL_LIMIT_EUR` is used only by the legacy SEPA demo.

## Legacy invoice-to-SEPA demo

The earlier accounts-payable prototype remains available and is not the default retail workflow:

```bash
npm run dev:sepa
# or after npm run build:
npm run start:sepa
```

It reads the synthetic invoices under `src/data/`, runs Extractor and Auditor agents concurrently, and writes `out/review.md` plus a human-review-only `out/sepa-draft.xml`. It does not send payments.

## Development

```bash
npm test
npm run typecheck
npm run build
```

These commands do not call an LLM.

## Main files

| File | Purpose |
| --- | --- |
| `src/retail.ts` | Retail Mozaik runtime, sequential collaboration, shared state, optional Network peers |
| `src/retail-data.ts` | Local input parsing, deterministic analysis, evidence payloads |
| `src/retail-prompts.ts` | Retail agent roles, contracts, and prompt builders |
| `src/retail-parsing.ts` | Agent answer validation and evidence checks |
| `src/retail-report.ts` | Candidate actions, receipt-pair analysis, and report generation |
| `src/index.ts` | Legacy invoice-to-SEPA runtime |
| `data/` | Synthetic retail input files |

Built for the JigJoy hackathon, *Agents in Finance*, using [Mozaik](https://www.npmjs.com/package/@mozaik-ai/core).
