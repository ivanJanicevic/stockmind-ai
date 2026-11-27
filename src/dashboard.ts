// Optional live dashboard (`npm run demo`): a zero-dependency page that polls
// the run's shared state and draws every agent's loop on a timeline, so the
// concurrency is visible. Never required for a run and never fails one.

import { createServer } from 'node:http';

export interface DashboardHandle {
  url: string;
}

export function startDashboard(port: number, snapshot: () => unknown): Promise<DashboardHandle | null> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url?.startsWith('/state')) {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(snapshot()));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    });
    server.on('error', (error) => {
      console.warn(`[dashboard] not started: ${(error as Error).message}`);
      resolve(null);
    });
    server.listen(port, '127.0.0.1', () => resolve({ url: `http://localhost:${port}` }));
  });
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>StockMind AI — café finance desk</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --bg:#0f1115; --panel:#171a21; --line:#262b36; --text:#e7e9ee; --muted:#8a93a6;
          --analyst:#7c6cf2; --invoice:#2f9cf4; --note:#22b8a6; --claims:#f29d38; --reviewer:#e75d8c;
          --ok:#3ccf7a; --held:#ef5b5b; --wait:#e9b949; }
  * { box-sizing: border-box; } body { margin:0; font:14px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; background:var(--bg); color:var(--text); }
  header { padding:18px 24px; border-bottom:1px solid var(--line); display:flex; gap:24px; align-items:baseline; flex-wrap:wrap; }
  h1 { font-size:18px; margin:0; } .muted { color:var(--muted); } .pill { padding:2px 8px; border-radius:99px; background:var(--line); font-size:12px; }
  main { display:grid; grid-template-columns: 1.4fr 1fr; gap:16px; padding:16px 24px; }
  section { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 10px; }
  .gantt { display:grid; grid-template-columns: 150px 1fr; row-gap:4px; align-items:center; }
  .gantt .name { font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .track { position:relative; height:16px; background:#11141a; border-radius:4px; }
  .bar { position:absolute; top:2px; height:12px; border-radius:3px; min-width:3px; }
  .bar.queued { background: repeating-linear-gradient(45deg,#3a4150 0 4px,#2a303c 4px 8px); }
  .bar.running { animation: pulse 1s ease-in-out infinite alternate; }
  @keyframes pulse { from { opacity:.55 } to { opacity:1 } }
  .legend span { margin-right:12px; font-size:12px; } .legend i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:4px; vertical-align:-1px; }
  table { width:100%; border-collapse:collapse; font-size:13px; } td, th { padding:6px 4px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
  th { color:var(--muted); font-weight:500; } .num { text-align:right; white-space:nowrap; }
  .st { font-weight:600; } .st.ready,.st.approved { color:var(--ok); } .st.held { color:var(--held); } .st.needs_approval { color:var(--wait); } .st.reading,.st.checking { color:var(--muted); }
  .why { color:var(--muted); font-size:12px; }
  ul { margin:0; padding-left:18px; } li { margin:4px 0; } .sev { font-size:11px; text-transform:uppercase; padding:1px 6px; border-radius:4px; background:var(--line); margin-right:6px; }
  .sev.high { background:#4a2026; color:#ff9aa5; } .sev.medium { background:#4a3a1c; color:#ffd27a; }
  .full { grid-column: 1 / -1; } .big { font-size:22px; font-weight:700; } .kpis { display:flex; gap:28px; flex-wrap:wrap; }
  footer { padding:8px 24px 24px; color:var(--muted); font-size:12px; }
</style></head>
<body>
<header>
  <h1>StockMind AI — café finance desk</h1>
  <span class="muted">Kafe „Plava Šolja“ · synthetic data · RSD</span>
  <span class="pill" id="status">connecting…</span>
  <span class="muted" id="meta"></span>
</header>
<main>
  <section class="full"><div class="kpis" id="kpis"></div></section>
  <section class="full">
    <h2>Agents — each bar is one Mozaik loop (hatched = queued for the rate limit)</h2>
    <div class="legend">
      <span><i style="background:var(--analyst)"></i>analyst</span><span><i style="background:var(--invoice)"></i>invoice clerk</span>
      <span><i style="background:var(--note)"></i>receiving clerk</span><span><i style="background:var(--claims)"></i>claims writer</span>
      <span><i style="background:var(--reviewer)"></i>reviewer</span>
    </div>
    <div class="gantt" id="gantt"></div>
  </section>
  <section><h2>Payment run — invoice ↔ delivery note ↔ agreed price</h2><table id="ap"></table></section>
  <section><h2>Business findings (numbers computed by code)</h2><div id="findings"></div><h2 style="margin-top:14px">Reviewer — this week</h2><div id="review"></div></section>
</main>
<footer>Decision support on synthetic data. Not financial advice. No payment or e-mail is sent. Full evidence with sources: out/review.md</footer>
<script>
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const rsd = (n) => n == null ? '–' : n.toLocaleString('sr-RS', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' RSD';
const LABEL = { ready:'✅ ready', approved:'👤 approved', needs_approval:'⏸ needs approval', held:'⛔ held', reading:'reading…', checking:'checking…' };
async function tick() {
  let s; try { s = await (await fetch('/state')).json(); } catch { document.getElementById('status').textContent = 'run ended'; return; }
  document.getElementById('status').textContent = s.finished ? 'finished' : 'running · ' + (s.elapsedMs/1000).toFixed(1) + ' s';
  document.getElementById('meta').textContent = s.model + ' · ' + s.calls + ' model calls · tokens ' + s.tokens + ' · Network: ' + s.network;
  const running = s.timeline.filter((t) => t.status === 'running').length;
  document.getElementById('kpis').innerHTML = [
    ['agents working now', running], ['answered', s.timeline.filter((t) => t.answeredAt != null).length + ' / ' + s.timeline.length],
    ['held invoices', s.cases.filter((c) => c.status === 'held').length], ['at stake', rsd(s.atStake)],
    ['payment draft', s.finished ? rsd(s.paymentTotal) : '…'],
  ].map(([k, v]) => '<div><div class="muted">' + k + '</div><div class="big">' + v + '</div></div>').join('');
  const end = Math.max(s.elapsedMs, 1);
  document.getElementById('gantt').innerHTML = s.timeline.map((t) => {
    const q = t.queuedAt ?? 0, st = t.startedAt, an = t.answeredAt;
    const pct = (x) => (100 * x / end).toFixed(2) + '%';
    let bars = '';
    if (st == null) bars = '<div class="bar queued" style="left:' + pct(q) + ';width:' + pct(end - q) + '"></div>';
    else {
      if (st > q) bars += '<div class="bar queued" style="left:' + pct(q) + ';width:' + pct(st - q) + '"></div>';
      const stop = an ?? end;
      bars += '<div class="bar ' + (an == null ? 'running' : '') + '" style="left:' + pct(st) + ';width:' + pct(stop - st) + ';background:var(--' + t.role + ')"></div>';
    }
    return '<div class="name" title="' + esc(t.status) + '">' + esc(t.agent) + '</div><div class="track">' + bars + '</div>';
  }).join('');
  document.getElementById('ap').innerHTML = '<tr><th>Invoice</th><th>Supplier</th><th class="num">Amount</th><th>Status</th></tr>' + s.cases.map((c) =>
    '<tr><td>' + esc(c.invoiceNo) + '</td><td>' + esc(c.supplier) + '</td><td class="num">' + rsd(c.amount) + '</td><td><span class="st ' + c.status + '">' + (LABEL[c.status] ?? esc(c.status)) + '</span>' +
    (c.why.length ? '<div class="why">' + c.why.map(esc).join('<br>') + '</div>' : '') + (c.claim ? '<div class="why">✉️ claim drafted to ' + esc(c.claim) + '</div>' : '') + '</td></tr>').join('');
  document.getElementById('findings').innerHTML = s.analyses.map((a) => '<div style="margin-bottom:8px"><b>' + esc(a.agent) + '</b> <span class="muted">' + (a.done ? (a.error ? 'failed' : a.accepted.length + ' accepted · ' + a.rejected + ' rejected') : 'working…') + '</span><ul>' +
    a.accepted.map((f) => '<li><span class="sev ' + f.severity + '">' + f.severity + '</span>' + esc(f.headline) + ' <span class="muted">(' + esc(f.id) + ')</span></li>').join('') + '</ul></div>').join('');
  document.getElementById('review').innerHTML = s.review ? '<p>' + esc(s.review.summary) + '</p><ol>' + s.review.actions.map((a) => '<li><b>' + esc(a.action) + '</b> <span class="muted">— ' + esc(a.why) + '</span></li>').join('') + '</ol>' : '<span class="muted">' + esc(s.reviewNote ?? 'waiting for every specialist…') + '</span>';
  if (!s.finished) setTimeout(tick, 400); else setTimeout(tick, 3000);
}
tick();
</script></body></html>`;
