// Optional live dashboard (`npm run demo`): a zero-dependency page that polls
// the run's shared state. It shows every agent loop on a timeline, the payment
// run, insights and inventory planning, and lets a person review an invoice
// and approve it when the rules allow it. Never required for a run, and never
// fails one.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';

import { DATA_DIR } from './data/load.js';

export interface DashboardHandle {
  url: string;
}

type Approve = (invoiceNo: string) => { ok: boolean; message: string };

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 10_000) req.destroy();
    });
    req.on('end', () => resolve(body));
  });

export function startDashboard(port: number, snapshot: () => unknown, approve: Approve): Promise<DashboardHandle | null> {
  // Approvals need this per-run token in a custom header, so another web page
  // open in the same browser can't post an approval to localhost.
  const token = randomUUID();
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/state') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(snapshot()));
        return;
      }
      if (url.pathname === '/approve' && req.method === 'POST') {
        if (req.headers['x-stockmind-token'] !== token) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'missing or wrong token' }));
          return;
        }
        let invoiceNo = '';
        try {
          invoiceNo = String((JSON.parse(await readBody(req)) as { invoiceNo?: unknown }).invoiceNo ?? '');
        } catch {
          // handled below
        }
        const result = invoiceNo ? approve(invoiceNo) : { ok: false, message: 'invoiceNo missing' };
        res.writeHead(result.ok ? 200 : 409, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }
      // The original PDFs, only the ones the run actually uses.
      const doc = /^\/doc\/(fakture|otpremnice)\/([a-z0-9-]+\.pdf)$/.exec(url.pathname);
      if (doc) {
        try {
          const file = readFileSync(`${DATA_DIR}${doc[1]}/${doc[2]}`);
          res.writeHead(200, { 'content-type': 'application/pdf' });
          res.end(file);
        } catch {
          res.writeHead(404);
          res.end('not found');
        }
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE.replace('__TOKEN__', token));
    });
    server.on('error', (error) => {
      console.warn(`[dashboard] not started: ${(error as Error).message}`);
      resolve(null);
    });
    server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${port}` }));
  });
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>StockMind AI — café finance desk</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{--bg:#0b0d12;--bg2:#10131a;--card:#151924;--card2:#1b2030;--line:#262c3b;--text:#eef1f7;--muted:#8d96ab;--dim:#5d667a;
--accent:#8b7cff;--accent2:#5ee1c6;--ok:#34d399;--held:#f87171;--wait:#fbbf24;--info:#60a5fa;
--analyst:#8b7cff;--invoice:#60a5fa;--note:#2dd4bf;--claims:#fb923c;--reviewer:#f472b6;--r:14px}
*{box-sizing:border-box}html,body{margin:0;background:radial-gradient(1200px 600px at 10% -10%,#1a1440 0,transparent 60%),radial-gradient(900px 500px at 100% 0,#0e2b2a 0,transparent 55%),var(--bg);color:var(--text);font:15px/1.5 Inter,system-ui,-apple-system,Segoe UI,sans-serif;min-height:100%}
a{color:var(--accent2)}button{font:inherit;cursor:pointer}
.wrap{max-width:1320px;margin:0 auto;padding:0 28px 40px}
header{position:sticky;top:0;z-index:5;backdrop-filter:blur(10px);background:rgba(11,13,18,.75);border-bottom:1px solid var(--line)}
.bar{max-width:1320px;margin:0 auto;padding:14px 28px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.logo{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;font-weight:800;color:#0b0d12}
.brand b{display:block;font-size:16px}.brand span{color:var(--muted);font-size:12px}
.status{margin-left:auto;display:flex;align-items:center;gap:12px}
.chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:99px;background:var(--card2);border:1px solid var(--line);font-size:12px;color:var(--muted);white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;background:var(--wait)}.dot.live{background:var(--ok);box-shadow:0 0 0 0 rgba(52,211,153,.6);animation:ping 1.4s infinite}
@keyframes ping{0%{box-shadow:0 0 0 0 rgba(52,211,153,.55)}100%{box-shadow:0 0 0 10px rgba(52,211,153,0)}}
.progress{width:180px;height:6px;background:var(--card2);border-radius:99px;overflow:hidden}.progress i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width .4s}
.alert{margin:18px 0 0;padding:14px 18px;border-radius:var(--r);display:flex;align-items:center;gap:14px;background:linear-gradient(90deg,rgba(251,191,36,.16),rgba(251,191,36,.04));border:1px solid rgba(251,191,36,.35)}
.alert b{color:var(--wait)}.alert .btn{margin-left:auto}
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:18px 0}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px}
.kpi .l{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}.kpi .v{font-size:24px;font-weight:750;margin-top:4px;font-variant-numeric:tabular-nums}.kpi .s{color:var(--dim);font-size:12px}
.tabs{display:flex;gap:6px;border-bottom:1px solid var(--line);margin-bottom:16px}
.tab{background:none;border:0;color:var(--muted);padding:10px 14px;border-bottom:2px solid transparent;font-weight:600}.tab.on{color:var(--text);border-color:var(--accent)}
.tab .n{margin-left:6px;font-size:11px;padding:1px 7px;border-radius:99px;background:var(--card2)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:16px;position:relative;overflow:hidden}
.card.inv{padding-left:20px;cursor:pointer;transition:transform .12s,border-color .12s}.card.inv:hover{transform:translateY(-2px);border-color:#3a4258}
.card.inv::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--dim)}
.card.ready::before,.card.approved::before{background:var(--ok)}.card.held::before{background:var(--held)}.card.needs_approval::before{background:var(--wait)}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:10px}.no{font-weight:700;letter-spacing:.01em}.amt{font-weight:700;font-variant-numeric:tabular-nums}
.sup{color:var(--muted);font-size:13px;margin:2px 0 10px}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:3px 10px;border-radius:99px}
.b-ready,.b-approved{background:rgba(52,211,153,.14);color:var(--ok)}.b-held{background:rgba(248,113,113,.14);color:var(--held)}.b-needs_approval{background:rgba(251,191,36,.14);color:var(--wait)}.b-reading{background:var(--card2);color:var(--muted)}
.reasons{margin:10px 0 0;padding:0;list-style:none;font-size:13px;color:#c9cfdc}.reasons li{padding:4px 0;border-top:1px dashed var(--line)}
.stake{color:var(--held);font-weight:600;white-space:nowrap}
.btn{background:var(--card2);border:1px solid var(--line);color:var(--text);padding:7px 14px;border-radius:10px;font-weight:600}
.btn.primary{background:linear-gradient(135deg,var(--accent),#6d5cf0);border:0;color:#fff}.btn.go{background:var(--ok);border:0;color:#062314}.btn:disabled{opacity:.45;cursor:not-allowed}
.section{margin-bottom:22px}.section h3{margin:0 0 10px;font-size:14px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-bottom:10px}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.gantt{display:grid;grid-template-columns:190px 1fr;gap:5px 12px;align-items:center}
.gantt .nm{font-size:13px;color:#c9cfdc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.track{position:relative;height:18px;border-radius:6px;background:repeating-linear-gradient(90deg,var(--bg2) 0 calc(10% - 1px),var(--line) calc(10% - 1px) 10%)}
.bar2{position:absolute;top:3px;height:12px;border-radius:4px;min-width:4px}.bar2.q{background:repeating-linear-gradient(45deg,#3b4254 0 4px,#2a3040 4px 8px);opacity:.8}.bar2.run{animation:pulse 1s ease-in-out infinite alternate}
@keyframes pulse{from{opacity:.55}to{opacity:1}}
.axis{display:flex;justify-content:space-between;color:var(--dim);font-size:11px;margin:4px 0 0 202px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:12px}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.sev{font-size:11px;font-weight:700;text-transform:uppercase;padding:2px 7px;border-radius:6px;margin-right:6px}.sev.high{background:rgba(248,113,113,.16);color:var(--held)}.sev.medium{background:rgba(251,191,36,.16);color:var(--wait)}.sev.low{background:var(--card2);color:var(--muted)}
.find{padding:10px 0;border-top:1px solid var(--line)}.find:first-child{border-top:0}.find .h{font-weight:600}.find .x{color:var(--muted);font-size:13px}.find .a{font-size:13px;color:var(--accent2)}
.kind{font-size:10px;font-weight:800;letter-spacing:.06em;padding:2px 6px;border-radius:5px;margin-right:6px}.k-fact{background:rgba(96,165,250,.16);color:var(--info)}.k-forecast{background:rgba(139,124,255,.18);color:var(--accent)}.k-rec{background:rgba(94,225,198,.16);color:var(--accent2)}
.muted{color:var(--muted)}.dim{color:var(--dim)}.ok{color:var(--ok)}.bad{color:var(--held)}.warn{color:var(--wait)}
.empty{color:var(--dim);padding:8px 0}
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.modal{position:fixed;inset:0;background:rgba(5,7,10,.7);backdrop-filter:blur(4px);display:none;align-items:flex-start;justify-content:center;padding:40px 20px;z-index:20;overflow:auto}
.modal.on{display:flex}.sheet{width:min(980px,100%);background:var(--bg2);border:1px solid var(--line);border-radius:18px;padding:22px 24px;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.sheet h2{margin:0}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}.meta div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 10px}.meta span{display:block;color:var(--muted);font-size:11px}
.check{display:flex;gap:10px;padding:6px 0;border-top:1px dashed var(--line);font-size:13px}.check .ic{width:18px;flex:none}
.policy{margin-top:14px;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--card)}
.actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}
.toast{position:fixed;bottom:22px;right:22px;background:var(--card2);border:1px solid var(--line);padding:12px 16px;border-radius:12px;display:none;z-index:30;max-width:420px}.toast.on{display:block}
.mismatch{background:rgba(248,113,113,.10)}
footer{color:var(--dim);font-size:12px;margin-top:26px;border-top:1px solid var(--line);padding-top:14px}
@media(max-width:1000px){.kpis{grid-template-columns:repeat(3,1fr)}.two{grid-template-columns:1fr}.meta{grid-template-columns:repeat(2,1fr)}}
</style></head>
<body>
<header><div class="bar">
  <div class="logo">S</div>
  <div class="brand"><b>StockMind AI · café finance desk</b><span>Kafe „Plava Šolja“ · synthetic data · RSD</span></div>
  <div class="status"><span class="chip" id="st"><span class="dot"></span>connecting…</span><div class="progress" title="agents answered"><i id="pg" style="width:0"></i></div><span class="chip" id="meta"></span></div>
</div></header>
<div class="wrap">
  <div id="alert"></div>
  <div class="kpis" id="kpis"></div>
  <div class="tabs" id="tabs"></div>
  <div id="view"></div>
  <footer>Decision support on synthetic data. Not financial advice. No payment or e-mail is ever sent — the payment draft is a file for a person to review. Full evidence with sources: <code>out/review.md</code>.</footer>
</div>
<div class="modal" id="modal"><div class="sheet" id="sheet"></div></div>
<div class="toast" id="toast"></div>
<script>
const TOKEN='__TOKEN__';
const $=(id)=>document.getElementById(id);
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=(n,d=2)=>n==null?'–':Number(n).toLocaleString('sr-RS',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtq=(n)=>n==null?'–':Number(n).toLocaleString('sr-RS',{maximumFractionDigits:2});
const rsd=(n)=>n==null?'–':fmt(n)+' RSD';
const LABEL={ready:'Ready',approved:'Approved by human',needs_approval:'Needs your approval',held:'Held',reading:'Reading documents…'};
const ICON={ready:'✓',approved:'👤',needs_approval:'⏸',held:'⛔',reading:'…'};
let S=null,tab='payments',openInv=null;

async function tick(){
  try{S=await (await fetch('/state',{cache:'no-store'})).json();}catch{ $('st').innerHTML='<span class="dot"></span>run ended — page is static'; return; }
  render(); setTimeout(tick,S.finished?2500:500);
}
function render(){
  const answered=S.timeline.filter(t=>t.answeredAt!=null).length, total=Math.max(S.timeline.length,1);
  const running=S.timeline.filter(t=>t.status==='running').length;
  $('st').innerHTML='<span class="dot '+(S.finished?'':'live')+'"></span>'+(S.finished?'Run finished':'Running · '+(S.elapsedMs/1000).toFixed(0)+' s');
  $('pg').style.width=(100*answered/total)+'%';
  $('meta').textContent=S.model+' · '+S.calls+' calls · '+fmtq(S.tokens.input+S.tokens.output)+' tokens · Network: '+S.network.split(' ')[0];
  const by=(st)=>S.cases.filter(c=>c.status===st);
  const waiting=by('needs_approval');
  $('alert').innerHTML=waiting.length?'<div class="alert"><span style="font-size:22px">⏸</span><div><b>'+waiting.length+' invoice'+(waiting.length>1?'s':'')+' need'+(waiting.length>1?'':'s')+' your approval</b><div class="muted">'+waiting.map(c=>esc(c.invoiceNo)+' · '+rsd(c.amount)).join(' · ')+' — clean, but above the agent limit of '+rsd(S.limitRsd)+'.</div></div><button class="btn primary" onclick="openReview(\\''+esc(waiting[0].invoiceNo)+'\\')">Review &amp; approve</button></div>':'';
  const expiredCost=(S.planning?.expired??[]).reduce((s,l)=>s+(l.costAtRisk||0),0);
  const kp=[['Agents working',running,'of '+S.agentsTotal+' agents'],['Ready to pay',by('ready').length+by('approved').length,S.paymentTotal!=null?rsd(S.paymentTotal):'draft at the end'],
    ['Held',by('held').length,'at stake '+rsd(S.atStake)],['Needs approval',waiting.length,'above '+rsd(S.limitRsd)],
    ['Expired stock',S.planning?S.planning.expired.length+' lots':'…',S.planning?rsd(expiredCost)+' at cost':'after delivery notes'],
    ['Findings',S.analyses.reduce((s,a)=>s+a.accepted.length,0),S.analyses.filter(a=>a.done).length+'/'+S.analyses.length+' analysts done']];
  $('kpis').innerHTML=kp.map(([l,v,s])=>'<div class="kpi"><div class="l">'+l+'</div><div class="v">'+v+'</div><div class="s">'+s+'</div></div>').join('');
  const tabs=[['payments','Payment run',S.cases.length],['agents','Agents',S.timeline.length],['insights','Insights',S.analyses.reduce((s,a)=>s+a.accepted.length,0)],['inventory','Inventory',S.planning?S.planning.expired.length+S.planning.atRisk.length+S.planning.replenishment.length:'…']];
  $('tabs').innerHTML=tabs.map(([k,t,n])=>'<button class="tab '+(tab===k?'on':'')+'" onclick="tab=\\''+k+'\\';render()">'+t+'<span class="n">'+n+'</span></button>').join('');
  $('view').innerHTML=({payments,agents,insights,inventory})[tab]();
  if(openInv) renderReview();
}
function payments(){
  return '<div class="grid">'+S.cases.map(c=>{
    const fails=c.checks.filter(x=>!x.ok&&x.blocking), warns=c.checks.filter(x=>!x.ok&&!x.blocking);
    const reasons=[...c.errors.map(e=>'<li class="bad">'+esc(e)+'</li>'),...fails.map(x=>'<li>'+esc(x.detail)+(x.impactRsd?' <span class="stake">'+rsd(x.impactRsd)+'</span>':'')+'</li>'),...warns.map(x=>'<li class="warn">⚠ '+esc(x.detail)+'</li>')];
    if(c.status==='needs_approval') reasons.push('<li>All '+c.checks.length+' checks passed · above the agent limit</li>');
    if(c.status==='ready') reasons.push('<li class="ok">All '+c.checks.length+' checks passed</li>');
    if(c.approvedBy) reasons.push('<li class="ok">Approved: '+esc(c.approvedBy)+'</li>');
    if(c.claim) reasons.push('<li>✉ Claim drafted to '+esc(c.claim.to)+'</li>');
    return '<div class="card inv '+c.status+'" onclick="openReview(\\''+esc(c.invoiceNo)+'\\')"><div class="row"><span class="no">'+esc(c.invoiceNo)+'</span><span class="amt">'+rsd(c.amount)+'</span></div><div class="sup">'+esc(c.supplier||'…')+'</div><span class="badge b-'+c.status+'">'+ICON[c.status]+' '+LABEL[c.status]+'</span><ul class="reasons">'+reasons.join('')+'</ul></div>';
  }).join('')+'</div>';
}
function agents(){
  const end=Math.max(S.elapsedMs,1), pct=(x)=>(100*x/end).toFixed(2)+'%';
  const order={analyst:0,invoice:1,note:1,claims:2,reviewer:3};
  const rows=[...S.timeline].sort((a,b)=>(order[a.role]-order[b.role])||((a.startedAt??1e12)-(b.startedAt??1e12)));
  const legend='<div class="legend">'+[['analyst','Analyst'],['invoice','Invoice clerk'],['note','Receiving clerk'],['claims','Claims writer'],['reviewer','Reviewer']].map(([k,t])=>'<span><i style="background:var(--'+k+')"></i>'+t+'</span>').join('')+'<span><i style="background:repeating-linear-gradient(45deg,#3b4254 0 3px,#2a3040 3px 6px)"></i>queued (rate limit)</span></div>';
  const g=rows.map(t=>{const q=t.queuedAt??0,st=t.startedAt,an=t.answeredAt;let b='';
    if(st==null) b='<div class="bar2 q" style="left:'+pct(q)+';width:'+pct(end-q)+'"></div>';
    else{ if(st>q) b+='<div class="bar2 q" style="left:'+pct(q)+';width:'+pct(st-q)+'"></div>'; b+='<div class="bar2 '+(an==null?'run':'')+'" style="left:'+pct(st)+';width:'+pct((an??end)-st)+';background:var(--'+t.role+')"></div>'; }
    const tip=esc(t.agent)+' · '+t.status+(st!=null?' · started '+(st/1000).toFixed(1)+' s':'')+(an!=null?' · answered '+(an/1000).toFixed(1)+' s':'');
    return '<div class="nm" title="'+tip+'">'+esc(t.agent)+'</div><div class="track" title="'+tip+'">'+b+'</div>';}).join('');
  const ticks=[0,.25,.5,.75,1].map(f=>'<span>'+(f*end/1000).toFixed(0)+' s</span>').join('');
  const peak=Math.max(0,...rows.map(t=>t.startedAt==null?0:rows.filter(u=>u.startedAt!=null&&u.startedAt<=t.startedAt&&(u.answeredAt??end)>t.startedAt).length));
  return '<div class="card"><div class="row" style="margin-bottom:10px"><b>Every bar is one Mozaik agent loop</b><span class="muted">up to <b>'+peak+'</b> agents working at the same time</span></div>'+legend+'<div class="gantt">'+g+'</div><div class="axis">'+ticks+'</div></div>';
}
function insights(){
  const an=S.analyses.map(a=>'<div class="card"><div class="row"><b>'+esc(a.agent)+'</b><span class="muted">'+(a.done?(a.error?'<span class="bad">failed</span>':a.accepted.length+' accepted · '+a.rejected.length+' rejected'):'working…')+'</span></div><div class="dim" style="margin-bottom:6px">'+esc(a.title)+'</div>'+
    (a.accepted.length?a.accepted.map(f=>'<div class="find"><div class="h"><span class="sev '+f.severity+'">'+f.severity+'</span>'+esc(f.headline)+'</div><div class="x">'+esc(f.explanation)+'</div><div class="a">→ '+esc(f.action)+' <span class="dim">('+esc(f.id)+')</span></div></div>').join(''):'<div class="empty">'+(a.done?'no findings accepted':'waiting for the agent…')+'</div>')+
    (a.rejected.length?'<div class="dim" style="font-size:12px;margin-top:6px">🚫 '+a.rejected.map(r=>esc(r.reason)).join(' · ')+'</div>':'')+'</div>').join('');
  const rv=S.review?'<div class="card" style="margin-bottom:14px;border-color:#3a3170"><div class="row"><b>Reviewer — priorities this week</b><span class="muted">checks the specialists against each other</span></div><p>'+esc(S.review.summary)+'</p><ol>'+S.review.actions.map(a=>'<li style="margin:6px 0"><b>'+esc(a.action)+'</b><div class="muted" style="font-size:13px">'+esc(a.why)+' <span class="dim">('+a.itemIds.map(esc).join(', ')+')</span></div></li>').join('')+'</ol></div>':'<div class="card" style="margin-bottom:14px"><b>Reviewer</b><div class="empty">'+esc(S.reviewNote??'starts when every specialist has finished…')+'</div></div>';
  return rv+'<div class="grid">'+an+'</div>';
}
function inventory(){
  const P=S.planning; if(!P) return '<div class="card"><div class="empty">Inventory planning starts when every delivery note has been read and verified…</div></div>';
  const kind=(k)=>'<span class="kind '+({fact:'k-fact',forecast:'k-forecast',recommendation:'k-rec'})[k]+'">'+({fact:'FACT',forecast:'FORECAST',recommendation:'RECOMMENDATION'})[k]+'</span>';
  const exp='<table><tr><th>Item</th><th>Lot</th><th>Expiry</th><th class="n">Left</th><th class="n">At cost</th></tr>'+P.expired.map(l=>'<tr><td>'+esc(l.item)+'</td><td class="muted">'+esc(l.noteNo)+'</td><td>'+esc(l.expiryDate)+(l.status==='expired_on_arrival'?' <span class="bad">· on arrival</span>':'')+'</td><td class="n">'+fmtq(l.remainingAsOf)+' '+l.unit+'</td><td class="n">'+rsd(l.costAtRisk)+'</td></tr>').join('')+'</table>';
  const risk=P.atRisk.length?'<table><tr><th>Item</th><th>Expires</th><th class="n">Left now</th><th class="n">Forecast left</th><th class="n">Demand/day</th></tr>'+P.atRisk.map(l=>'<tr><td>'+esc(l.item)+'</td><td>'+esc(l.expiryDate)+' <span class="dim">('+l.daysToExpiry+' d)</span></td><td class="n">'+fmtq(l.remainingAsOf)+' '+l.unit+'</td><td class="n warn">'+fmtq(l.projectedLeftover)+' '+l.unit+'</td><td class="n">'+fmtq(l.avgDailyDemand)+'</td></tr>').join('')+'</table>':'<div class="empty">no lot is forecast to expire with stock left</div>';
  const promo=P.promotions.length?P.promotions.map(p=>'<div class="find"><div class="h">'+esc(p.action)+'</div><div class="x">'+fmtq(p.unitsAtRisk)+' '+p.unit+' forecast unsold ('+rsd(p.costAtRisk)+' at cost) · needs '+fmtq(p.requiredDailySales)+'/day vs '+fmtq(p.currentDailySales)+' now'+(p.maxDiscountPct!=null?' · discount ceiling '+fmtq(p.maxDiscountPct)+' %':'')+'</div><div class="dim" style="font-size:12px">'+esc(p.limitations[0])+'</div></div>').join(''):'<div class="empty">none</div>';
  const flagIcon={stockout_risk:'<span class="bad">● stock-out risk</span>',overstock:'<span class="warn">● overstock</span>',no_demand:'<span class="dim">● no demand</span>',insufficient_data:'<span class="dim">● data missing</span>'};
  const repl='<table><tr><th>Item</th><th>Status</th><th class="n">Book stock</th><th class="n">Days of cover</th><th>Proposal</th><th>Conf.</th></tr>'+P.replenishment.map(r=>'<tr><td>'+esc(r.item)+'</td><td>'+(flagIcon[r.flag]||esc(r.flag))+'</td><td class="n">'+fmtq(r.bookStock)+' '+r.unit+'</td><td class="n">'+fmtq(r.daysOfCover)+'</td><td>'+(r.orderQuantity?'<b>order '+r.orderQuantity+' '+esc(r.purchaseUnit)+'</b>':r.flag==='overstock'?'pause reordering':'–')+'</td><td class="dim">'+r.confidence+'</td></tr>').join('')+'</table>';
  const top='<table><tr><th>#</th><th>Product</th><th class="n">Total gross profit</th><th class="n">Per unit</th><th class="n">Margin</th></tr>'+P.topProfit.map(x=>'<tr><td>'+x.rank+'</td><td>'+esc(x.name)+'</td><td class="n"><b>'+rsd(x.grossProfit)+'</b></td><td class="n">'+rsd(x.avgProfitPerUnit)+'</td><td class="n">'+fmtq(x.marginPct)+' %</td></tr>').join('')+'</table>';
  const mv=P.moving.map(m=>'<div>'+(m.flag==='rising'?'📈':'📉')+' '+esc(m.name)+' <span class="muted">'+m.previous+' → '+m.latest+' ('+(m.changePct>0?'+':'')+fmtq(m.changePct)+' %)</span></div>').join('')||'<div class="empty">no product moved enough to flag</div>';
  return '<div class="two"><div class="card section"><h3>'+kind('fact')+'Expired stock by lot</h3>'+exp+'</div><div class="card section"><h3>'+kind('forecast')+'At risk of expiring unsold</h3>'+risk+'</div></div>'+
    '<div class="card section"><h3>'+kind('recommendation')+'Promotion candidates</h3>'+promo+'</div>'+
    '<div class="card section"><h3>'+kind('recommendation')+'Replenishment</h3>'+(P.syntheticParams?'<div class="warn" style="font-size:13px;margin-bottom:8px">⚠ Lead times and safety stock are synthetic (data/planiranje.json); stock is a book estimate — no physical count.</div>':'')+repl+'</div>'+
    '<div class="two"><div class="card section"><h3>'+kind('fact')+'Top products by total gross profit</h3>'+top+'</div><div class="card section"><h3>'+kind('fact')+'Week vs previous week</h3>'+mv+'</div></div>'+
    '<div class="dim" style="font-size:12px">As of '+esc(P.asOf)+'. Full rows with sources: out/recommendations.csv, out/sales-by-product.csv.</div>';
}
function openReview(no){openInv=no;renderReview();$('modal').classList.add('on');}
function closeReview(){openInv=null;$('modal').classList.remove('on');}
$('modal').addEventListener('click',(e)=>{if(e.target.id==='modal')closeReview();});
addEventListener('keydown',(e)=>{if(e.key==='Escape')closeReview();});
function renderReview(){
  const c=S.cases.find(x=>x.invoiceNo===openInv); if(!c) return;
  const can=c.status==='needs_approval';
  const fails=c.checks.filter(x=>!x.ok);
  const lines=c.lines.map(l=>{const bad=l.delivered!=null&&l.delivered!==l.quantity;return '<tr class="'+(bad?'mismatch':'')+'"><td>'+esc(l.code)+'</td><td>'+esc(l.name)+'</td><td class="n">'+fmtq(l.quantity)+' '+esc(l.unit)+'</td><td class="n '+(bad?'bad':'')+'">'+(l.delivered==null?'<span class="bad">not delivered</span>':fmtq(l.delivered))+'</td><td class="n">'+fmt(l.unitPrice)+'</td><td class="n">'+l.vatRate+' %</td><td class="n">'+fmt(l.lineTotal)+'</td><td>'+(l.expiry?esc(l.expiry):'<span class="dim">–</span>')+'</td></tr>';}).join('');
  const checks=[...c.errors.map(e=>'<div class="check"><span class="ic bad">✗</span><span>'+esc(e)+'</span></div>'),...c.checks.map(x=>'<div class="check"><span class="ic '+(x.ok?'ok':x.blocking?'bad':'warn')+'">'+(x.ok?'✓':x.blocking?'✗':'⚠')+'</span><span><b>'+esc(x.name)+'</b> — '+esc(x.detail)+(x.impactRsd?' <span class="stake">'+rsd(x.impactRsd)+'</span>':'')+'</span></div>')].join('');
  const policy=can?'<div class="policy"><b class="warn">Why it waits for you:</b> every check passed, but '+rsd(c.amount)+' is above the agent limit of '+rsd(S.limitRsd)+'. Approving adds it to the payment draft (a file — nothing is sent).</div>'
    :c.status==='held'?'<div class="policy"><b class="bad">Held — can\\'t be approved.</b> Fix the problems above with the supplier first (a claim is drafted below when the documents show a discrepancy). Approval never overrides a failed check.</div>'
    :c.status==='approved'?'<div class="policy"><b class="ok">Approved</b> — '+esc(c.approvedBy)+'. It is in the payment draft.</div>'
    :c.status==='ready'?'<div class="policy"><b class="ok">Ready</b> — within the agent limit; no approval needed. It is in the payment draft.</div>':'<div class="policy muted">The clerks are still reading this invoice and its delivery note…</div>';
  const claim=c.claim?'<div class="policy"><b>✉ Claim draft (not sent) — to '+esc(c.claim.to)+'</b><div class="muted" style="margin:6px 0">'+esc(c.claim.subject)+'</div><div style="white-space:pre-wrap;font-size:13px">'+esc(c.claim.body)+'</div></div>':c.claimError?'<div class="policy dim">Claim writer: '+esc(c.claimError)+'</div>':'';
  $('sheet').innerHTML='<div class="row"><div><h2>'+esc(c.invoiceNo)+'</h2><div class="muted">'+esc(c.supplier)+'</div></div><span class="badge b-'+c.status+'">'+ICON[c.status]+' '+LABEL[c.status]+'</span></div>'+
    '<div class="meta"><div><span>Total to pay</span><b>'+rsd(c.amount)+'</b></div><div><span>Issued / due</span>'+esc(c.issueDate)+' → '+esc(c.dueDate)+'</div><div><span>Supplier PIB</span>'+esc(c.pib)+'</div><div><span>Account</span>'+esc(c.account)+'</div></div>'+
    '<div class="muted" style="font-size:13px;margin-bottom:6px">Documents: <a href="/doc/'+c.invoicePdf.replace('data/','')+'" target="_blank">invoice PDF</a> · <a href="/doc/'+c.notePdf.replace('data/','')+'" target="_blank">delivery note PDF</a> · '+c.checks.filter(x=>x.ok).length+' passed, '+fails.length+' failed checks</div>'+
    '<table><tr><th>Code</th><th>Item</th><th class="n">Invoiced</th><th class="n">Delivered</th><th class="n">Price</th><th class="n">VAT</th><th class="n">Total</th><th>Expiry</th></tr>'+lines+'</table>'+
    '<div style="margin-top:14px"><b>Checks</b>'+checks+'</div>'+policy+claim+
    '<div class="actions"><button class="btn" onclick="closeReview()">Close</button>'+(can?'<button class="btn go" id="appr" onclick="approve(\\''+esc(c.invoiceNo)+'\\')">Approve for payment</button>':'')+'</div>';
}
async function approve(no){
  if(!confirm('Approve '+no+' for the payment draft?\\n\\nThis only adds it to out/payment-draft.csv — nothing is paid or sent.')) return;
  const b=$('appr'); if(b) b.disabled=true;
  try{const r=await fetch('/approve',{method:'POST',headers:{'content-type':'application/json','x-stockmind-token':TOKEN},body:JSON.stringify({invoiceNo:no})});const j=await r.json();toast((j.ok?'✓ ':'✗ ')+j.message);}catch(e){toast('✗ could not reach the dashboard');}
}
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),4000);}
tick();
</script></body></html>`;
