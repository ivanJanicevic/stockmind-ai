# StockMind AI — Hackathon Product and Technical Plan

## 1. Product summary

StockMind AI is a finance decision-support prototype for a small grocery shop or café. It combines purchasing costs, sales, current stock, expiry lots, and write-offs to explain inventory risk and compare possible actions such as a markdown, a bundle, or no promotion.

The goal is not to maximize sales volume. It is to show a traceable estimate of how each scenario may affect gross profit, expired stock, and remaining inventory, then let a person approve or reject the recommendation.

This is a proposed direction, not a description of the current application. The repository currently implements invoice-to-SEPA processing; implementing StockMind AI requires replacing that product flow and its sample data.

## 2. Hackathon requirements to design for

The [Agents in Finance brief](https://build.jigjoy.ai/tracks/finance) requires a finance task built on Mozaik, at least two agents working together, synthetic or public data, sources for every reported number, and an appropriate “not financial advice” disclaimer.

The project is scored on:

| Criterion | Points | Evidence the demo should show |
| --- | ---: | --- |
| Usefulness | 30 | A clear shop-finance problem and an actionable result |
| Multi-agent Mozaik design | 30 | Independent agents running in parallel, shared state, and checks between them |
| Working system | 25 | A reproducible run using the README instructions |
| Financial-data care | 15 | Traceable inputs, explicit assumptions, no invented numbers |

Use the public hackathon brief as the source of truth for submission requirements and deadline.

## 3. Recommended hackathon MVP

Keep the first version deliberately small and reproducible:

1. Load a synthetic dataset from CSV/JSON.
2. Validate and normalize products, sales, purchase costs, inventory lots, and expiry dates.
3. Run independent analyses concurrently through Mozaik.
4. Calculate a small set of transparent scenarios deterministically.
5. Show the recommendation, its evidence, assumptions, and alternatives.
6. Let a human accept or reject a recommendation in the demo; do not update a real POS or place an order.
7. Compare a baseline with the proposed scenario using the same synthetic assumptions.

For the hackathon, start with CSV/JSON rather than spending time on PDF, image, POS, or ERP integrations. Those are sensible extensions after the demo works.

## 4. Data required

An invoice alone does not provide enough information to recommend expiry markdowns. In particular, expiry dates usually need to be recorded when goods arrive, by lot/batch.

Minimum input tables:

| Dataset | Minimum fields | Purpose |
| --- | --- | --- |
| Product catalog | SKU, product name, category, regular sale price, unit cost or a cost reference | Product identity and unit economics |
| Sales history | Date, SKU, quantity sold, actual sale price, promotion indicator if available | Demand history and baseline |
| Inventory lots | SKU, lot ID, quantity on hand, expiry date, received date | Expiry exposure and sellable stock |
| Purchase records | Supplier, invoice ID, date, SKU, quantity, unit cost | Purchase-cost evidence and cost changes |
| Write-offs | Date, SKU, quantity, reason, recorded cost if available | Historical waste and evaluation |
| Promotion history (optional for MVP) | SKU or bundle, dates, promotion price, units sold | Evidence for estimating promotion response |

Use stable product IDs to link files. If a SKU cannot be mapped confidently, flag it for review instead of silently merging products.

Every input row should have a source reference, such as `sales.csv:row 42` or an invoice ID and line number. Derived values should retain the source IDs and formula/assumptions that produced them.

## 5. Deterministic calculation layer

Use ordinary TypeScript functions for arithmetic and validation. Agents can interpret evidence, identify issues, explain trade-offs, and suggest scenarios; they should not invent or silently calculate financial figures.

Useful deterministic outputs include:

- Units sold by product and time period.
- A documented baseline demand estimate and its limitations.
- Stock coverage for a chosen horizon.
- Quantity at risk of expiry, based on lot dates.
- Unit gross margin from sale price and purchase cost.
- Scenario sales, expected unsold expiring units, and expected gross profit.
- Change against a no-promotion baseline.

For a simple expiry window, a scenario can use:

```text
expected sold units = min(sellable stock, estimated demand under the scenario)
gross contribution = expected sold units * (scenario price - unit cost)
expiry loss = expected unsold units that expire * unit cost
scenario gross result = gross contribution - expiry loss - known disposal costs
change vs baseline = scenario gross result - baseline gross result
```

Only count units that are expected to expire in the selected horizon as expiry loss. Do not treat all remaining stock as wasted. If demand uplift under a discount is not supported by promotion history, label it as a scenario assumption (or show a range), not as a factual forecast.

For each calculated number, expose its inputs and formula. Missing data should reduce confidence or suppress a recommendation, not be filled with a made-up value.

## 6. Mozaik architecture

Use the local Mozaik Runtime for agents in one application process:

```text
CSV / JSON input
    -> normalization and deterministic data checks
    -> shared Mozaik RuntimeState
       ├─ demand analysis loop ─────────┐
       ├─ inventory / expiry analysis ──┼─ run concurrently
       └─ cost / margin analysis ───────┘
    -> deterministic scenario calculator
    -> independent recommendation review
    -> human review and report
```

Implementation principles:

- Keep a typed `RuntimeState` with the normalized input, source references, results, errors, checks, and task status.
- Create and `join` the runtime participants before starting their loops.
- Launch independent `runLoop` calls without awaiting one agent's answer before starting another.
- Route results with event handlers that filter on event type and producer ID.
- Write each result into shared state as it arrives; track pending, complete, failed, and rejected results separately.
- Pass the specific input each agent needs. Shared runtime state does not automatically put every other participant's private model context into its prompt.
- Run deterministic validation before accepting recommendations. A final reviewer may start after independent analyses finish; not every dependent step has to be parallel.
- Make completion and timeout behavior explicit so the process does not report success while required work is still pending.

The current project already has a Mozaik Runtime foundation and a rate-limited model-call queue. Those parts may be reusable, but its invoice-to-SEPA data model, prompts, checks, report, and decision flow need to be replaced or substantially adapted.

## 7. Agent responsibilities and possible expansion

Keep each agent's task distinct. Start with independent analysis streams that can run concurrently; add another agent only when it contributes a separate perspective or check.

### Suggested MVP roles

- **Sales Analysis Agent:** summarizes sales patterns and demand evidence, pointing to the relevant periods and records.
- **Inventory and Expiry Analysis Agent:** identifies stock coverage, near-expiry quantities, and missing lot information.
- **Cost and Margin Analysis Agent:** reviews purchase-cost evidence, sale prices, and margin constraints.
- **Recommendation Reviewer:** checks the calculated scenarios, sources, assumptions, and conflicts before the human sees the result.

The first three can analyze the same normalized task independently and concurrently. The application—not a free-form LLM response—should calculate and rank the scenarios. The reviewer can then inspect the candidate result and flag unsupported claims or missing evidence.

### Extensions, in priority order

1. **Data-quality reviewer:** detect duplicate rows, missing SKUs, impossible dates, cost changes, and inconsistent units.
2. **Promotion-history analyst:** estimate price response only when there is enough comparable historical evidence.
3. **Bundle analyst:** suggest complementary products only when co-purchase/basket data exists; validate the combined margin deterministically.
4. **Replenishment planner:** estimate reorder quantities using demand, lead time, open purchase orders, and safety-stock assumptions.
5. **Scenario challenger:** independently stress-test a recommendation with conservative demand or low promotion response.
6. **Multi-store comparison:** compare stock and demand across locations while preserving per-store evidence.
7. **Document extraction:** parse invoice PDFs/images and map line items to the product catalog, with review for uncertain matches.
8. **POS/ERP integrations:** connect real systems only after the synthetic-data prototype is stable and has appropriate access controls.
9. **Human chat or Network approval:** receive review commands through Mozaik Network only with a deliberate message bridge, sender authorization, and an audit log.

## 8. Recommendation and action center

Each proposed action should show:

- Product/SKU and affected lot or time period.
- Current price and proposed scenario.
- Baseline versus scenario results for profit, expiry, and remaining stock.
- Source references for input numbers.
- Formula, forecast horizon, and any assumed promotion response.
- Missing data, uncertainty, and reasons the recommendation may be wrong.
- Status: proposed, approved, rejected, or needs more information.

For the MVP, approval should change only the demo application's recommendation status. Do not automatically change prices, send orders, or connect to a real register.

## 9. Demonstrating business value responsibly

Include a reproducible baseline and a simulated “with recommendation” case. Compare the same products, dates, stock, and demand assumptions in both cases. Show:

- Gross result or contribution.
- Units sold and units expected to expire.
- Ending stock.
- Purchase/replenishment quantities if included.
- Assumptions that differ between scenarios.

Label simulated results as projections. Do not claim that a promotion caused a real improvement unless the project has observed and sourced real outcome data. A simulation proves how the logic behaves; it does not prove a real-world uplift.

## 10. Monitoring and local versus Cloud execution

Mozaik Cloud is not required by the hackathon brief. A local Node.js application can host the runtime and coordinate agents. The current model provider still requires an API key and makes remote inference calls, so local runtime does not mean offline inference.

For a convincing demo, display or log:

- Agent/participant name and loop ID.
- Start, completion, and elapsed time.
- Status and result summary.
- Source references and validation results.
- Token usage or model errors where available.

Cloud pairing can be used for optional Cloud observation, but it does not deploy local runtime objects as Cloud-managed agents. Mozaik Network is a separate peer-messaging layer; it is not needed for participants sharing one local runtime.

The Mozaik docs home says the earlier Runtime will be sunset, while detailed Runtime docs continue to show `@mozaik-ai/core`. The separate `@jigjoy/mozaik-agent` package documents inspectable/persistable loops. Follow the event starter or mentor guidance before changing packages; a migration is not itself a hackathon requirement.

## 11. Suggested implementation sequence

1. **Choose the MVP boundary:** CSV/JSON inputs, one reproducible synthetic scenario, no live POS integration.
2. **Define schemas and provenance:** stable product IDs, source row IDs, units, currency, dates, and validation rules.
3. **Implement deterministic calculations:** test margins, expiry windows, demand estimates, scenario comparison, and missing-data behavior.
4. **Add parallel Mozaik analyses:** launch independent loops together; record event outcomes in shared state.
5. **Add checks and review:** validate numbers against source rows and reject unsupported or conflicting claims.
6. **Build a small result view/report:** show the scenario, evidence, assumptions, errors, and approval status.
7. **Add a repeatable demonstration:** baseline vs scenario on fixtures; tests should not require live model calls.
8. **Prepare the submission:** public repository, README run steps, architecture explanation, limitations, and financial disclaimer.

## 12. Submission-readiness checklist

- [ ] Public GitHub repository and clear README.
- [ ] Reproducible synthetic/public fixtures.
- [ ] At least two real Mozaik runtime agents working on the same task.
- [ ] Independent loops start concurrently and publish results to shared state.
- [ ] Deterministic checks run before recommendations are accepted.
- [ ] Every reported number links to data or a documented calculation.
- [ ] Missing evidence and uncertainty are visible.
- [ ] Human review is available for recommendations.
- [ ] No real customer/account data or real money movement.
- [ ] Appropriate “not financial advice” disclaimer.
- [ ] Setup, environment variables, test command, and live-inference command are documented.
- [ ] No secrets are committed.

## Sources

- [JigJoy Agents in Finance track](https://build.jigjoy.ai/tracks/finance)
- [Mozaik Runtime quickstart](https://docs.jigjoy.ai/docs/quickstart)
- [Mozaik concurrent agents](https://docs.jigjoy.ai/docs/concurrent-agents)
- [Mozaik Runtime state](https://docs.jigjoy.ai/docs/runtime-state)
- [Mozaik Network](https://docs.jigjoy.ai/network)
- [Mozaik Agent](https://docs.jigjoy.ai/agent)
