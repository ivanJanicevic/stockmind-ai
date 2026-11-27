# Demo video — script (about 2 minutes)

Record with macOS screen recording (⌘⇧5 → "Record Selected Portion"), 1080p. Before you start:
- In one browser window, open `docs/presentation.html` full screen.
- Have a terminal ready in the repo with `.env` set.
- Run `npm run demo` once beforehand, so the quota and model are known to work.

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:12 | Slide 1 | "StockMind AI is a finance desk of AI agents for a small café, built on Mozaik. It checks every supplier invoice before it's paid, and explains what is eating the margin, with a source for every number." |
| 0:12–0:25 | Slide 2 | "A café owner gets invoices, delivery notes, a POS export and monthly bills, but has no finance team. Over-invoiced goods and price rises get paid by default." |
| 0:25–0:45 | Slide 3, then slide 4 | "Twenty agents start at once on one shared Mozaik state. Three analysts work on code-computed numbers, while an invoice clerk and a receiving clerk read each of seven invoice and delivery-note pairs. As soon as a pair is read, code matches it against the agreed prices, and a held invoice gets its own claims writer. When every specialist is done, a reviewer sets the priorities." |
| 0:45–1:15 | Terminal: `npm run demo`, then the dashboard at http://127.0.0.1:3000 | "Here it is live. Every bar is one agent loop. You can see them overlap, and invoices turn red as the match finds problems." Pause on the timeline while it runs. If the run is slow, cut, and come back when it has finished. |
| 1:15–1:35 | Dashboard after the run: the payment table, then `out/review.md` (one held invoice with its evidence) | "Five invoices are held, with fifteen thousand dinars at stake: over-invoiced quantities, a price above the agreed list, and goods that expired before delivery. Each hold shows the exact row of the PDF it comes from, and a complaint to the supplier is already drafted." |
| 1:35–1:50 | Slide 5 | "No agent is trusted alone. Two clerks read different documents and code compares them, every value must be quoted from the document, and any figure an agent didn't get from a source is rejected. A misread holds an invoice, it never pays it." |
| 1:50–2:05 | Dashboard: the approval banner → **Review & approve** on F-ZP-2026-01184 → **Approve for payment**; then click a held invoice to show it has no approve button | "Large clean invoices wait for a human. I review it line by line against the delivery note and approve it, and it joins the payment draft. A held invoice can't be approved: the button isn't there, and the server refuses it too." |
| 2:05–2:20 | Slide 7, then slide 8 | "Beyond invoices: the analysts show stock sold beyond deliveries, a collapsing product, and how supplier price rises turn the month into a loss. Everything runs from the README on a free Gemini key. Synthetic data, not financial advice." |

Tips:
- At the default 10 calls per minute a run takes about 2.5 minutes. Set `REQUESTS_PER_MINUTE=14` for the recording, or cut the waiting.
- Keep the terminal font large, at least 16 pt.
- If a model call fails during recording, the retry messages are fine to show: they demonstrate resilience.
