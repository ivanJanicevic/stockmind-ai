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
      res.end(pageHtml('live', token));
    });
    server.on('error', (error) => {
      console.warn(`[dashboard] not started: ${(error as Error).message}`);
      resolve(null);
    });
    server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${port}` }));
  });
}

// The same page serves the live run (polls /state) and the static replay on
// GitHub Pages (plays docs/demo/replay.json, approvals simulated in the browser).
export const pageHtml = (mode: 'live' | 'replay', token = '') => PAGE.replace('__TOKEN__', token).replace('__MODE__', mode);

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>StockMind AI — café finance desk</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#07090b;--panel:rgba(22,27,29,.72);--panel2:rgba(30,37,40,.78);--glass:rgba(255,255,255,.035);--line:rgba(255,255,255,.07);--line2:rgba(255,255,255,.12);
--text:#f1f5f3;--muted:#8f9a96;--dim:#5c6763;--mint:#3ecf9b;--mint2:#1f8f6b;--violet:#8f86f5;--violet2:#6c61e8;--lime:#d5f36b;
--ok:#3ecf9b;--held:#f2766b;--wait:#f5c451;--info:#7cb8ff;--analyst:#8f86f5;--invoice:#7cb8ff;--note:#3ecf9b;--claims:#f5a25d;--reviewer:#f07fb6;--r:22px}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;color:var(--text);font:14px/1.5 Poppins,Inter,system-ui,-apple-system,Segoe UI,sans-serif;
background:radial-gradient(900px 600px at 85% 10%,rgba(62,207,155,.20),transparent 60%),radial-gradient(700px 500px at 15% 100%,rgba(143,134,245,.12),transparent 60%),linear-gradient(160deg,#0b0f10,#050607)}
button{font:inherit;cursor:pointer;color:inherit}a{color:var(--mint)}
.app{display:grid;grid-template-columns:84px 1fr;min-height:100vh;max-width:1480px;margin:0 auto}
.side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;align-items:center;gap:14px;padding:22px 0}
.logo{width:42px;height:42px;border-radius:14px;background:conic-gradient(from 210deg,var(--mint),var(--mint2),#0d3d2e,var(--mint));display:grid;place-items:center;font-weight:700;color:#04140d;box-shadow:0 8px 30px rgba(62,207,155,.35);margin-bottom:18px}
.nav{display:flex;flex-direction:column;gap:10px;padding:10px;border-radius:30px;background:var(--panel);border:1px solid var(--line)}
.nav button{width:44px;height:44px;border-radius:50%;border:0;background:transparent;color:var(--muted);display:grid;place-items:center;position:relative;transition:.15s}
.nav button:hover{background:var(--glass);color:var(--text)}.nav button.on{background:var(--text);color:#0b0f10;box-shadow:0 6px 20px rgba(255,255,255,.18)}
.nav button[data-n]::after{content:attr(data-n);position:absolute;top:2px;right:0;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:var(--wait);color:#1b1400;font-size:10px;font-weight:700;display:grid;place-items:center}
.nav svg{width:20px;height:20px}
.main{padding:22px 30px 40px 8px;min-width:0}
.top{display:flex;align-items:center;gap:16px;margin-bottom:22px}
.brand{font-weight:600;font-size:15px;white-space:nowrap}.brand small{display:block;color:var(--muted);font-weight:400;font-size:11px}
.search{flex:1;max-width:420px;display:flex;align-items:center;gap:10px;padding:11px 18px;border-radius:99px;background:var(--panel);border:1px solid var(--line)}
.search input{flex:1;background:transparent;border:0;outline:0;color:var(--text);font:inherit}.search svg{width:16px;height:16px;color:var(--muted)}
.who{margin-left:auto;display:flex;align-items:center;gap:12px}.who b{font-weight:600}.avatar{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--mint),var(--violet));display:grid;place-items:center;font-weight:700;color:#06120d;border:2px solid rgba(255,255,255,.2)}
.pill{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:99px;background:var(--panel2);border:1px solid var(--line);font-size:12px;color:var(--muted);white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;background:var(--wait)}.dot.live{background:var(--mint);animation:ping 1.4s infinite}
@keyframes ping{0%{box-shadow:0 0 0 0 rgba(62,207,155,.55)}100%{box-shadow:0 0 0 10px rgba(62,207,155,0)}}
.head{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap;margin-bottom:16px}
h1{font-size:34px;font-weight:500;margin:0;letter-spacing:-.02em}.sub{color:var(--muted);margin-top:2px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
.chip{padding:9px 20px;border-radius:99px;border:1px solid var(--line);background:var(--panel2);color:var(--muted);font-weight:500;transition:.15s}.chip:hover{color:var(--text)}.chip.on{background:var(--mint);border-color:transparent;color:#05140e;box-shadow:0 8px 26px rgba(62,207,155,.3)}
.chip .n{margin-left:6px;opacity:.7}
.grid{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(320px,1fr);gap:18px;align-items:start}
.col{display:flex;flex-direction:column;gap:18px;min-width:0}
.card{background:var(--panel);backdrop-filter:blur(18px);border:1px solid var(--line);border-radius:var(--r);padding:20px 22px;position:relative;min-width:0;box-shadow:0 20px 60px rgba(0,0,0,.25)}
.ch{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:10px}.ch h3{margin:0;font-size:16px;font-weight:500}.ch .more{color:var(--muted);font-size:12px;background:none;border:0}
.row2{display:grid;grid-template-columns:1.15fr 1fr;gap:18px}.stack{display:flex;flex-direction:column;gap:18px}
.stat .l{font-size:15px;font-weight:500}.stat .v{font-size:28px;font-weight:600;margin:6px 0 2px;letter-spacing:-.01em;font-variant-numeric:tabular-nums}.stat .s{color:var(--muted);font-size:12px}
.delta{position:absolute;right:20px;bottom:20px;padding:5px 12px;border-radius:99px;font-size:12px;font-weight:600}.up{background:var(--mint);color:#05140e}.down{background:var(--violet);color:#fff}.flat{background:var(--panel2);color:var(--muted)}
.bank{border:0;padding:0;background:none;box-shadow:none}
.bankcard{position:relative;border-radius:22px;padding:22px;min-height:178px;color:#eafff6;overflow:hidden;background:linear-gradient(140deg,#2fb487 0%,#1d7f61 55%,#11523f 100%);box-shadow:0 24px 60px rgba(31,143,107,.35)}
.bankcard::before,.bankcard::after{content:"";position:absolute;border-radius:50%;background:rgba(255,255,255,.08)}.bankcard::before{width:260px;height:260px;right:-90px;top:-120px}.bankcard::after{width:180px;height:180px;right:40px;bottom:-110px}
.bankcard .l{opacity:.85;font-size:13px}.bankcard .v{font-size:30px;font-weight:700;margin:4px 0 22px;letter-spacing:-.01em}.bankcard .acc{font-size:13px;letter-spacing:.08em;opacity:.9}.bankcard .acc small{display:block;letter-spacing:0;opacity:.75;margin-top:2px}
.bankcard .plus{position:absolute;right:18px;top:18px;width:38px;height:38px;border-radius:50%;background:#fff;color:#11523f;display:grid;place-items:center;font-weight:700;z-index:1}
.stackback{height:12px;margin:0 22px;border-radius:18px 18px 0 0;background:rgba(62,207,155,.35)}.stackback.b2{margin:0 40px;height:10px;background:rgba(62,207,155,.18)}
.list{display:flex;flex-direction:column}.item{display:flex;align-items:center;gap:12px;padding:10px 6px;border-radius:14px;cursor:pointer;transition:.12s}.item:hover{background:var(--glass)}
.ico{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:13px;flex:none}
.item .t{flex:1;min-width:0}.item .t b{display:block;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.item .t span{color:var(--muted);font-size:12px}
.item .a{text-align:right;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}.item .a span{display:block;font-size:11px;font-weight:600}
.s-ready,.s-approved{color:var(--ok)}.s-held{color:var(--held)}.s-needs_approval{color:var(--wait)}.s-reading{color:var(--dim)}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:4px 11px;border-radius:99px}
.b-ready,.b-approved{background:rgba(62,207,155,.15);color:var(--ok)}.b-held{background:rgba(242,118,107,.15);color:var(--held)}.b-needs_approval{background:rgba(245,196,81,.15);color:var(--wait)}.b-reading{background:var(--panel2);color:var(--muted)}
.mini{display:grid;grid-template-columns:1fr 1fr;gap:18px}.mini .card{padding:16px 18px}
.btn{border:1px solid var(--line2);background:var(--panel2);padding:9px 16px;border-radius:99px;font-weight:500}.btn:hover{border-color:var(--mint)}
.btn.primary{background:var(--mint);border-color:transparent;color:#05140e;font-weight:600}.btn.go{background:var(--mint);border:0;color:#05140e;font-weight:600;padding:11px 22px}.btn:disabled{opacity:.4;cursor:not-allowed}
.banner{display:flex;align-items:center;gap:14px;padding:14px 18px;border-radius:18px;margin-bottom:16px;border:1px solid rgba(245,196,81,.35);background:linear-gradient(90deg,rgba(245,196,81,.14),rgba(245,196,81,.02))}
.banner.rp{border-color:rgba(143,134,245,.4);background:linear-gradient(90deg,rgba(143,134,245,.16),rgba(143,134,245,.02))}.banner .grow{flex:1}.banner b{font-weight:600}
.svgwrap svg{width:100%;display:block;overflow:visible}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted)}.legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}
.donut{display:flex;align-items:center;gap:18px}.donut .lg div{margin:6px 0;font-size:13px}.donut .lg small{display:block;color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500;font-size:12px}td.n,th.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.gantt{display:grid;grid-template-columns:200px 1fr;gap:7px 14px;align-items:center}.gantt .nm{font-size:13px;color:#cfd8d4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.track{position:relative;height:20px;border-radius:99px;background:rgba(255,255,255,.035)}.bar{position:absolute;top:4px;height:12px;border-radius:99px;min-width:6px}
.bar.q{background:repeating-linear-gradient(135deg,rgba(255,255,255,.18) 0 3px,transparent 3px 7px)}.bar.run{animation:pulse 1s ease-in-out infinite alternate}@keyframes pulse{from{opacity:.55}to{opacity:1}}
.axis{display:flex;justify-content:space-between;color:var(--dim);font-size:11px;margin:6px 0 0 214px}
.find{padding:12px 0;border-top:1px solid var(--line)}.find:first-of-type{border-top:0}.find .h{font-weight:500}.find .x{color:var(--muted);font-size:13px}.find .a{font-size:13px;color:var(--mint);margin-top:2px}
.sev{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:3px 8px;border-radius:99px;margin-right:8px}.sev.high{background:rgba(242,118,107,.16);color:var(--held)}.sev.medium{background:rgba(245,196,81,.16);color:var(--wait)}.sev.low{background:var(--panel2);color:var(--muted)}
.kind{font-size:10px;font-weight:700;letter-spacing:.07em;padding:3px 8px;border-radius:99px;margin-right:8px}.k-fact{background:rgba(124,184,255,.15);color:var(--info)}.k-forecast{background:rgba(143,134,245,.18);color:var(--violet)}.k-rec{background:rgba(62,207,155,.15);color:var(--mint)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px}
.inv{cursor:pointer;transition:transform .15s,border-color .15s}.inv:hover{transform:translateY(-3px);border-color:var(--line2)}
.reasons{list-style:none;margin:12px 0 0;padding:0;font-size:13px;color:#cfd8d4}.reasons li{padding:6px 0;border-top:1px solid var(--line)}
.stake{color:var(--held);font-weight:600;white-space:nowrap}.muted{color:var(--muted)}.dim{color:var(--dim)}.ok{color:var(--ok)}.bad{color:var(--held)}.warn{color:var(--wait)}.empty{color:var(--dim);padding:8px 0}
.two{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.modal{position:fixed;inset:0;z-index:20;display:none;align-items:flex-start;justify-content:center;padding:40px 18px;overflow:auto;background:rgba(3,5,6,.72);backdrop-filter:blur(6px)}.modal.on{display:flex}
.sheet{width:min(1000px,100%);border-radius:26px;padding:26px 28px;background:linear-gradient(180deg,rgba(26,32,34,.96),rgba(14,18,19,.98));border:1px solid var(--line2);box-shadow:0 40px 120px rgba(0,0,0,.6)}
.sheet h2{margin:0;font-weight:600}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.meta div{background:var(--glass);border:1px solid var(--line);border-radius:16px;padding:10px 12px}.meta span{display:block;color:var(--muted);font-size:11px}
.check{display:flex;gap:10px;padding:7px 0;border-top:1px solid var(--line);font-size:13px}.check .ic{width:18px;flex:none;font-weight:700}
.policy{margin-top:16px;padding:14px 16px;border-radius:18px;border:1px solid var(--line);background:var(--glass)}
.actions{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}.mismatch td{background:rgba(242,118,107,.08)}
.toast{position:fixed;bottom:24px;right:24px;z-index:30;display:none;max-width:440px;padding:14px 18px;border-radius:18px;background:var(--panel2);border:1px solid var(--line2);box-shadow:0 20px 60px rgba(0,0,0,.4)}.toast.on{display:block}
footer{color:var(--dim);font-size:12px;margin-top:26px}
@media(max-width:1100px){.grid,.row2,.two,.mini{grid-template-columns:1fr}.meta{grid-template-columns:1fr 1fr}.app{grid-template-columns:70px 1fr}}
</style></head>
<body><div class="app">
<aside class="side">
  <div class="logo">S</div>
  <nav class="nav" id="nav"></nav>
</aside>
<main class="main">
  <div class="top">
    <div class="brand">StockMind AI<small>café finance desk · built on Mozaik</small></div>
    <label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" placeholder="Search invoice or supplier" oninput="Q=this.value;render()"></label>
    <span class="pill" id="st"><span class="dot"></span>connecting…</span>
    <div class="who"><span class="muted" style="text-align:right;font-size:12px">Kafe „Plava Šolja“<br><b style="color:var(--text);font-size:14px">Owner view</b></span><div class="avatar">PŠ</div></div>
  </div>
  <div id="banners"></div>
  <div id="view"></div>
  <footer>Decision support on synthetic data · not financial advice · no payment or e-mail is ever sent: the payment draft is a file for a person to review. Every figure is computed from data/ — full evidence with sources in out/review.md.</footer>
</main></div>
<div class="modal" id="modal"><div class="sheet" id="sheet"></div></div>
<div class="toast" id="toast"></div>
<script>
const TOKEN='__TOKEN__', MODE='__MODE__';
let R=null,playT=0,last=Date.now(),speed=4,paused=false;const simApproved=new Set();
async function replayFrame(){
  if(!R){R=await (await fetch('replay.json',{cache:'no-store'})).json();last=Date.now();}
  const now=Date.now();if(!paused)playT+=(now-last)*speed;last=now;
  const end=R.frames[R.frames.length-1].t;if(playT>end)playT=end;
  let f=R.frames[0];for(const x of R.frames){if(x.t<=playT)f=x;else break;}
  return JSON.parse(JSON.stringify(f.s));
}
// Approvals in the replay only change this page: same rule as the server.
function applySim(s){
  for(const c of s.cases){if(c.status==='needs_approval'&&simApproved.has(c.invoiceNo)){c.status='approved';c.approvedBy='you — simulated in this replay';if(s.paymentTotal!=null)s.paymentTotal+=c.amount;}}
  return s;
}
const $=(id)=>document.getElementById(id);
const esc=(s)=>String(s??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,d=2)=>n==null?'–':Number(n).toLocaleString('sr-RS',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtq=(n)=>n==null?'–':Number(n).toLocaleString('sr-RS',{maximumFractionDigits:2});
const rsd=(n)=>n==null?'–':fmt(n)+' RSD';
const kfmt=(n)=>n>=1000?fmtq(Math.round(n/100)/10)+'k':fmtq(Math.round(n));
const LABEL={ready:'Ready',approved:'Approved',needs_approval:'Needs approval',held:'Held',reading:'Reading…'};
const ICONS={overview:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',payments:'<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M7 15h4"/>',agents:'<circle cx="7" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><path d="M2 20c.8-3 2.8-5 5-5s4.2 2 5 5M12 20c.8-3 2.8-5 5-5s4.2 2 5 5"/>',insights:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',inventory:'<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/>'};
let S=null,view='overview',filter='all',Q='',openInv=null;
const svg=(k)=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+ICONS[k]+'</svg>';
const ini=(s)=>String(s||'?').replace(/\\(.*?\\)/g,'').trim().split(/\\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
const hue=(s)=>{let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))%360;return h;};

async function tick(){
  try{S=MODE==='live'?await (await fetch('/state',{cache:'no-store'})).json():applySim(await replayFrame());}
  catch{ if(MODE==='replay'){$('view').innerHTML='<div class="card"><div class="empty">No recording yet: run <code>npm run record</code> to create docs/demo/replay.json from a real run.</div></div>';$('st').innerHTML='<span class="dot"></span>no recording';}else{$('st').innerHTML='<span class="dot"></span>run ended — page is static';} return; }
  render(); setTimeout(tick,MODE==='replay'?250:S.finished?2500:500);
}
function go(v){view=v;render();}
function render(){
  const waiting=S.cases.filter(c=>c.status==='needs_approval');
  const running=S.timeline.filter(t=>t.status==='running').length;
  $('st').innerHTML='<span class="dot '+(S.finished?'':'live')+'"></span>'+(S.finished?'Run finished':running+' agents working · '+(S.elapsedMs/1000).toFixed(0)+' s');
  $('nav').innerHTML=[['overview','Overview'],['payments','Payment run'],['agents','Agents'],['insights','Insights'],['inventory','Inventory']].map(([k,t])=>'<button title="'+t+'" class="'+(view===k?'on':'')+'" '+(k==='payments'&&waiting.length?'data-n="'+waiting.length+'"':'')+' onclick="go(\\''+k+'\\')">'+svg(k)+'</button>').join('');
  let b='';
  if(MODE==='replay'&&R){const end=R.frames[R.frames.length-1].t;b+='<div class="banner rp"><span style="font-size:20px">▶</span><div class="grow"><b style="color:var(--violet)">Replay of a real run</b><div class="muted" style="font-size:13px">Recorded '+esc(R.recordedAt)+' · '+esc(R.model)+' · '+R.frames.length+' state changes. Nothing here calls a model; approvals are simulated in your browser.</div></div><button class="btn" onclick="playT=0">⏮</button><button class="btn" onclick="paused=!paused">'+(paused?'▶':'⏸')+'</button>'+[1,4,16].map(x=>'<button class="btn '+(speed===x?'primary':'')+'" onclick="speed='+x+'">'+x+'×</button>').join('')+'<button class="btn" onclick="playT='+end+'">⏭</button><span class="muted" style="min-width:80px;text-align:right">'+(playT/1000).toFixed(0)+' / '+(end/1000).toFixed(0)+' s</span></div>';}
  if(waiting.length)b+='<div class="banner"><span style="font-size:20px">⏸</span><div class="grow"><b class="warn">'+waiting.length+' invoice'+(waiting.length>1?'s':'')+' waiting for your approval</b><div class="muted" style="font-size:13px">'+waiting.map(c=>esc(c.invoiceNo)+' · '+rsd(c.amount)).join(' · ')+' — every check passed, but above the agent limit of '+rsd(S.limitRsd)+'.</div></div><button class="btn primary" onclick="openReview(\\''+esc(waiting[0].invoiceNo)+'\\')">Review &amp; approve</button></div>';
  $('banners').innerHTML=b;
  $('view').innerHTML=({overview,payments,agents,insights,inventory})[view]();
  if(openInv)renderReview();
}
function filtered(){const q=Q.trim().toLowerCase();return S.cases.filter(c=>(filter==='all'||c.status===filter||(filter==='ready'&&c.status==='approved'))&&(!q||(c.invoiceNo+' '+c.supplier).toLowerCase().includes(q)));}
function chipsRow(){const n=(st)=>S.cases.filter(c=>c.status===st||(st==='ready'&&c.status==='approved')).length;
  return '<div class="chips">'+[['all','All',S.cases.length],['needs_approval','Needs approval',n('needs_approval')],['held','Held',n('held')],['ready','Ready',n('ready')]].map(([k,t,c])=>'<button class="chip '+(filter===k?'on':'')+'" onclick="filter=\\''+k+'\\';render()">'+t+'<span class="n">'+c+'</span></button>').join('')+'</div>';}
function revenueChart(){
  const w=S.charts.weeks; if(!w.length)return '<div class="empty">no sales</div>';
  const max=Math.max(...w.map(x=>x.net)),H=170,bw=46,gap=26,left=44,W=left+w.length*(bw+gap);
  const full=w.filter(x=>x.days===7),hi=full.length?w.indexOf(full[full.length-1]):w.length-1;
  const ticks=[0,.25,.5,.75,1].map(f=>{const y=H-f*H;return '<text x="0" y="'+(y+4)+'" fill="#5c6763" font-size="11">'+kfmt(f*max)+'</text><line x1="'+(left-8)+'" x2="'+W+'" y1="'+y+'" y2="'+y+'" stroke="rgba(255,255,255,.04)"/>';}).join('');
  const bars=w.map((x,i)=>{const h=Math.max(6,x.net/max*H),X=left+i*(bw+gap),Y=H-h,on=i===hi;
    return '<g><title>'+esc(x.key)+' · '+x.days+' days · '+rsd(x.net)+' net</title><rect x="'+X+'" y="'+Y+'" width="'+bw+'" height="'+h+'" rx="18" fill="'+(on?'var(--violet)':'url(#hatch)')+'"/>'+(on?'<circle cx="'+(X+bw/2)+'" cy="'+(Y+14)+'" r="8" fill="none" stroke="#fff" stroke-width="3"/>':'')+
    '<text x="'+(X+bw/2)+'" y="'+(H+20)+'" fill="#8f9a96" font-size="11" text-anchor="middle">'+esc(x.key.split(' ')[0])+(x.days<7?'*':'')+'</text></g>';}).join('');
  const prev=full.length>1?full[full.length-2]:null,cur=full[full.length-1];const d=prev&&cur?Math.round((cur.net-prev.net)/prev.net*1000)/10:null;
  const tip=cur?'<g transform="translate('+(left+hi*(bw+gap)+bw/2)+','+(H-cur.net/max*H-28)+')"><rect x="-44" y="-16" width="88" height="26" rx="13" fill="rgba(255,255,255,.12)"/><text x="0" y="2" fill="#fff" font-size="12" text-anchor="middle">'+kfmt(cur.net)+' RSD</text></g>':'';
  return '<div class="svgwrap"><svg viewBox="0 0 '+W+' '+(H+30)+'"><defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="rgba(143,134,245,.18)"/><line x1="0" y1="0" x2="0" y2="8" stroke="rgba(143,134,245,.75)" stroke-width="3"/></pattern></defs>'+ticks+bars+tip+'</svg></div>'+
    '<div class="muted" style="font-size:12px;margin-top:6px">Net revenue excl. VAT per 7-day week from the POS export'+(w.some(x=>x.days<7)?' · * partial week':'')+(d!=null?' · last full week <b style="color:'+(d>=0?'var(--mint)':'var(--held)')+'">'+(d>0?'+':'')+fmtq(d)+' %</b> vs the week before':'')+'</div>';
}
function donut(){
  const groups=[['held','Held','var(--held)'],['needs_approval','Needs approval','var(--wait)'],['ready','Ready / approved','var(--mint)']];
  const val=(k)=>S.cases.filter(c=>c.amount!=null&&(c.status===k||(k==='ready'&&c.status==='approved'))).reduce((s,c)=>s+c.amount,0);
  const vals=groups.map(g=>val(g[0])),tot=vals.reduce((a,b)=>a+b,0)||1,r=56,C=2*Math.PI*r;let off=0;
  const arcs=vals.map((v,i)=>{const len=v/tot*C,gap=vals.filter(x=>x>0).length>1?6:0;const a='<circle r="'+r+'" cx="75" cy="75" fill="none" stroke="'+groups[i][2]+'" stroke-width="20" stroke-linecap="round" stroke-dasharray="'+Math.max(0,len-gap)+' '+C+'" stroke-dashoffset="'+(-off)+'" transform="rotate(-90 75 75)"/>';off+=len;return v>0?a:'';}).join('');
  return '<div class="donut"><svg width="150" height="150" viewBox="0 0 150 150"><circle r="'+r+'" cx="75" cy="75" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="20"/>'+arcs+'<text x="75" y="72" text-anchor="middle" fill="#fff" font-size="17" font-weight="600">'+kfmt(tot)+'</text><text x="75" y="91" text-anchor="middle" fill="#8f9a96" font-size="11">RSD invoiced</text></svg><div class="lg">'+groups.map((g,i)=>'<div><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+g[2]+';margin-right:7px"></i>'+g[1]+'<small>'+rsd(vals[i])+'</small></div>').join('')+'</div></div>';
}
function sparkline(){
  const d=S.charts.days;if(d.length<2)return '';const max=Math.max(...d.map(x=>x.net)),W=260,H=70;
  const pts=d.map((x,i)=>[i/(d.length-1)*W,H-6-x.net/max*(H-12)]);let p='M'+pts[0][0]+' '+pts[0][1];for(let i=1;i<pts.length;i++){const [x0,y0]=pts[i-1],[x1,y1]=pts[i],cx=(x0+x1)/2;p+=' C'+cx+' '+y0+' '+cx+' '+y1+' '+x1+' '+y1;}
  return '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:70px"><defs><linearGradient id="sg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="rgba(62,207,155,.35)"/><stop offset="1" stop-color="rgba(62,207,155,0)"/></linearGradient></defs><path d="'+p+' L'+W+' '+H+' L0 '+H+' Z" fill="url(#sg)"/><path d="'+p+'" fill="none" stroke="var(--mint)" stroke-width="3" stroke-linecap="round"/></svg>';
}
function invList(rows){return '<div class="list">'+(rows.length?rows.map(c=>{const h=hue(c.supplier);return '<div class="item" onclick="openReview(\\''+esc(c.invoiceNo)+'\\')"><div class="ico" style="background:hsla('+h+',60%,55%,.16);color:hsl('+h+',70%,70%)">'+ini(c.supplier)+'</div><div class="t"><b>'+esc(c.supplier||'Reading…')+'</b><span>'+esc(c.invoiceNo)+'</span></div><div class="a">'+rsd(c.amount)+'<span class="s-'+c.status+'">'+LABEL[c.status]+'</span></div></div>';}).join(''):'<div class="empty">no invoice matches</div>')+'</div>';}
function overview(){
  const running=S.timeline.filter(t=>t.status==='running').length;
  const ready=S.cases.filter(c=>c.status==='ready'||c.status==='approved');
  const held=S.cases.filter(c=>c.status==='held');
  const w=S.charts.weeks.filter(x=>x.days===7),cur=w[w.length-1],prev=w[w.length-2];const d=cur&&prev?Math.round((cur.net-prev.net)/prev.net*1000)/10:null;
  const expired=(S.planning?.expired??[]).reduce((s,l)=>s+(l.costAtRisk||0),0);
  const found=S.analyses.reduce((s,a)=>s+a.accepted.length,0);
  const total=S.paymentTotal!=null?S.paymentTotal:ready.reduce((s,c)=>s+(c.amount||0),0);
  return '<div class="head"><div><h1>Finance desk</h1><div class="sub">Invoices checked against deliveries and agreed prices, with stock, demand and margins — every number from data/.</div></div></div>'+chipsRow()+
  '<div class="grid"><div class="col">'+
    '<div class="card"><div class="ch"><h3>Revenue flow</h3><button class="more" onclick="go(\\'insights\\')">Insights ›</button></div>'+revenueChart()+'</div>'+
    '<div class="row2"><div class="card"><div class="ch"><h3>Invoices by decision</h3><button class="more" onclick="go(\\'payments\\')">View all ›</button></div>'+donut()+'</div>'+
    '<div class="stack"><div class="card stat"><div class="l">At stake on held invoices</div><div class="v">'+rsd(S.atStake)+'</div><div class="s">'+held.length+' held · claims drafted to suppliers</div><span class="delta '+(held.length?'down':'flat')+'">'+held.length+' held</span></div>'+
    '<div class="card stat"><div class="l">Net revenue, last full week</div><div class="v">'+(cur?rsd(cur.net):'–')+'</div><div class="s">'+(cur?esc(cur.key.split(' ').slice(1).join(' ')):'')+'</div>'+(d!=null?'<span class="delta '+(d>=0?'up':'down')+'">'+(d>0?'+':'')+fmtq(d)+' %</span>':'')+'</div></div></div>'+
    '<div class="mini"><div class="card stat"><div class="l">Expired stock</div><div class="v">'+(S.planning?rsd(expired):'…')+'</div><div class="s">'+(S.planning?S.planning.expired.length+' lots · at purchase cost':'after delivery notes are verified')+'</div></div>'+
    '<div class="card stat" style="cursor:pointer" onclick="go(\\'insights\\')"><div class="l">Findings</div><div class="v">'+found+'</div><div class="s">'+S.analyses.filter(a=>a.done).length+' / '+S.analyses.length+' analysts done · '+(S.review?'reviewer done':'reviewer pending')+'</div></div></div>'+
  '</div><div class="col">'+
    '<div class="card"><div class="ch"><h3>Payment draft</h3><button class="more" onclick="go(\\'payments\\')">View all ›</button></div><div class="stackback b2"></div><div class="stackback"></div><div class="bankcard"><div class="plus">'+(S.finished?'✓':'…')+'</div><div class="l">'+(S.finished?'Ready to pay':'Ready so far')+'</div><div class="v">'+rsd(total)+'</div><div class="acc">'+ready.length+' order'+(ready.length===1?'':'s')+' · šifra plaćanja 221<small>draft only — nothing is sent</small></div></div></div>'+
    '<div class="card"><div class="ch"><h3>Invoices</h3><button class="more" onclick="go(\\'payments\\')">View all ›</button></div>'+invList(filtered().slice(0,7))+'</div>'+
    '<div class="mini"><div class="card" style="cursor:pointer" onclick="go(\\'agents\\')"><div class="l" style="font-weight:500">Agents</div><div style="font-size:26px;font-weight:600;margin:4px 0">'+S.timeline.filter(t=>t.answeredAt!=null).length+'<span class="muted" style="font-size:14px"> / '+S.timeline.length+'</span></div><div class="muted" style="font-size:12px">'+running+' working now · timeline ›</div></div>'+
    '<div class="card"><div class="l" style="font-weight:500">Daily sales</div>'+sparkline()+'</div></div>'+
  '</div></div>';
}
function payments(){
  return '<div class="head"><div><h1>Payment run</h1><div class="sub">Each invoice is read by an invoice clerk and its delivery note by a receiving clerk; code matches both against the agreed prices.</div></div></div>'+chipsRow()+
  '<div class="cards">'+filtered().map(c=>{const f=c.checks.filter(x=>!x.ok&&x.blocking),w=c.checks.filter(x=>!x.ok&&!x.blocking);
    const r=[...c.errors.map(e=>'<li class="bad">'+esc(e)+'</li>'),...f.map(x=>'<li>'+esc(x.detail)+(x.impactRsd?' <span class="stake">'+rsd(x.impactRsd)+'</span>':'')+'</li>'),...w.map(x=>'<li class="warn">⚠ '+esc(x.detail)+'</li>')];
    if(c.status==='needs_approval')r.push('<li>All '+c.checks.length+' checks passed · above the agent limit</li>');if(c.status==='ready')r.push('<li class="ok">All '+c.checks.length+' checks passed</li>');if(c.approvedBy)r.push('<li class="ok">Approved — '+esc(c.approvedBy)+'</li>');if(c.claim)r.push('<li>✉ Claim drafted to '+esc(c.claim.to)+'</li>');
    const h=hue(c.supplier);
    return '<div class="card inv" onclick="openReview(\\''+esc(c.invoiceNo)+'\\')"><div class="item" style="padding:0;cursor:inherit"><div class="ico" style="background:hsla('+h+',60%,55%,.16);color:hsl('+h+',70%,70%)">'+ini(c.supplier)+'</div><div class="t"><b>'+esc(c.invoiceNo)+'</b><span>'+esc(c.supplier||'Reading…')+'</span></div><div class="a">'+rsd(c.amount)+'</div></div><div style="margin-top:12px"><span class="badge b-'+c.status+'">'+LABEL[c.status]+'</span></div><ul class="reasons">'+r.join('')+'</ul></div>';}).join('')+'</div>';
}
function agents(){
  const end=Math.max(S.elapsedMs,1),pct=(x)=>(100*x/end).toFixed(2)+'%',order={analyst:0,invoice:1,note:1,claims:2,reviewer:3};
  const rows=[...S.timeline].sort((a,b)=>(order[a.role]-order[b.role])||((a.startedAt??1e12)-(b.startedAt??1e12)));
  const peak=Math.max(0,...rows.map(t=>t.startedAt==null?0:rows.filter(u=>u.startedAt!=null&&u.startedAt<=t.startedAt&&(u.answeredAt??end)>t.startedAt).length));
  const g=rows.map(t=>{const q=t.queuedAt??0,st=t.startedAt,an=t.answeredAt;let b='';
    if(st==null)b='<div class="bar q" style="left:'+pct(q)+';width:'+pct(end-q)+'"></div>';else{if(st>q)b+='<div class="bar q" style="left:'+pct(q)+';width:'+pct(st-q)+'"></div>';b+='<div class="bar '+(an==null?'run':'')+'" style="left:'+pct(st)+';width:'+pct((an??end)-st)+';background:var(--'+t.role+')"></div>';}
    const tip=esc(t.agent)+' · '+t.status+(st!=null?' · started '+(st/1000).toFixed(1)+' s':'')+(an!=null?' · answered '+(an/1000).toFixed(1)+' s':'');
    return '<div class="nm" title="'+tip+'">'+esc(t.agent)+'</div><div class="track" title="'+tip+'">'+b+'</div>';}).join('');
  return '<div class="head"><div><h1>Agents</h1><div class="sub">7 roles running as parallel Mozaik loops on one shared state. Up to <b style="color:var(--mint)">'+peak+'</b> agents worked at the same time.</div></div></div>'+
  '<div class="card"><div class="ch"><h3>Timeline</h3><div class="legend">'+[['analyst','Analyst'],['invoice','Invoice clerk'],['note','Receiving clerk'],['claims','Claims writer'],['reviewer','Reviewer']].map(([k,t])=>'<span><i style="background:var(--'+k+')"></i>'+t+'</span>').join('')+'<span><i style="background:repeating-linear-gradient(135deg,rgba(255,255,255,.4) 0 2px,transparent 2px 4px)"></i>queued for the rate limit</span></div></div><div class="gantt">'+g+'</div><div class="axis">'+[0,.25,.5,.75,1].map(f=>'<span>'+(f*end/1000).toFixed(0)+' s</span>').join('')+'</div></div>';
}
function insights(){
  const rv=S.review?'<div class="card"><div class="ch"><h3>Reviewer — priorities this week</h3><span class="badge b-ready">checks the specialists against each other</span></div><p style="margin-top:0">'+esc(S.review.summary)+'</p>'+S.review.actions.map((a,i)=>'<div class="find"><div class="h"><span class="sev low">'+(i+1)+'</span>'+esc(a.action)+'</div><div class="x">'+esc(a.why)+' <span class="dim">('+a.itemIds.map(esc).join(', ')+')</span></div></div>').join('')+'</div>':'<div class="card"><div class="ch"><h3>Reviewer</h3></div><div class="empty">'+esc(S.reviewNote??'starts when every specialist has finished…')+'</div></div>';
  return '<div class="head"><div><h1>Insights</h1><div class="sub">Analysts interpret code-computed rows; any figure not in the cited row is rejected.</div></div></div><div class="col">'+rv+'<div class="cards">'+S.analyses.map(a=>'<div class="card"><div class="ch"><h3>'+esc(a.agent)+'</h3><span class="muted" style="font-size:12px">'+(a.done?(a.error?'<span class="bad">failed</span>':a.accepted.length+' accepted · '+a.rejected.length+' rejected'):'working…')+'</span></div><div class="dim" style="font-size:12px;margin:-8px 0 6px">'+esc(a.title)+'</div>'+
    (a.accepted.length?a.accepted.map(f=>'<div class="find"><div class="h"><span class="sev '+f.severity+'">'+f.severity+'</span>'+esc(f.headline)+'</div><div class="x">'+esc(f.explanation)+'</div><div class="a">→ '+esc(f.action)+' <span class="dim">('+esc(f.id)+')</span></div></div>').join(''):'<div class="empty">'+(a.done?'no findings accepted':'waiting for the agent…')+'</div>')+
    (a.rejected.length?'<div class="dim" style="font-size:12px;margin-top:8px">🚫 '+a.rejected.map(r=>esc(r.reason)).join(' · ')+'</div>':'')+'</div>').join('')+'</div></div>';
}
function inventory(){
  const P=S.planning;const head='<div class="head"><div><h1>Inventory</h1><div class="sub">Lots from verified delivery notes · stock is a book estimate (deliveries − recipe use), not a count.</div></div></div>';
  if(!P)return head+'<div class="card"><div class="empty">Starts when every delivery note has been read and verified…</div></div>';
  const kind=(k)=>'<span class="kind '+({fact:'k-fact',forecast:'k-forecast',recommendation:'k-rec'})[k]+'">'+k.toUpperCase()+'</span>';
  const exp='<table><tr><th>Item</th><th>Lot</th><th>Expiry</th><th class="n">Left</th><th class="n">At cost</th></tr>'+P.expired.map(l=>'<tr><td>'+esc(l.item)+'</td><td class="muted">'+esc(l.noteNo)+'</td><td>'+esc(l.expiryDate)+(l.status==='expired_on_arrival'?' <span class="bad">· on arrival</span>':'')+'</td><td class="n">'+fmtq(l.remainingAsOf)+' '+l.unit+'</td><td class="n">'+rsd(l.costAtRisk)+'</td></tr>').join('')+'</table>';
  const risk=P.atRisk.length?'<table><tr><th>Item</th><th>Expires</th><th class="n">Left now</th><th class="n">Forecast left</th></tr>'+P.atRisk.map(l=>'<tr><td>'+esc(l.item)+'</td><td>'+esc(l.expiryDate)+' <span class="dim">('+l.daysToExpiry+' d)</span></td><td class="n">'+fmtq(l.remainingAsOf)+' '+l.unit+'</td><td class="n warn">'+fmtq(l.projectedLeftover)+' '+l.unit+'</td></tr>').join('')+'</table>':'<div class="empty">no lot is forecast to expire with stock left</div>';
  const promo=P.promotions.length?P.promotions.map(p=>'<div class="find"><div class="h">'+esc(p.action)+'</div><div class="x">'+fmtq(p.unitsAtRisk)+' '+p.unit+' forecast unsold ('+rsd(p.costAtRisk)+' at cost) · needs '+fmtq(p.requiredDailySales)+'/day vs '+fmtq(p.currentDailySales)+' now'+(p.maxDiscountPct!=null?' · discount ceiling '+fmtq(p.maxDiscountPct)+' %':'')+'</div><div class="dim" style="font-size:12px">'+esc(p.limitations[0])+'</div></div>').join(''):'<div class="empty">none</div>';
  const fl={stockout_risk:'<span class="badge b-held">stock-out risk</span>',overstock:'<span class="badge b-needs_approval">overstock</span>',no_demand:'<span class="badge b-reading">no demand</span>',insufficient_data:'<span class="badge b-reading">data missing</span>'};
  const repl='<table><tr><th>Item</th><th>Status</th><th class="n">Book stock</th><th class="n">Days of cover</th><th>Proposal</th><th>Conf.</th></tr>'+P.replenishment.map(r=>'<tr><td>'+esc(r.item)+'</td><td>'+(fl[r.flag]||esc(r.flag))+'</td><td class="n">'+fmtq(r.bookStock)+' '+r.unit+'</td><td class="n">'+fmtq(r.daysOfCover)+'</td><td>'+(r.orderQuantity?'<b>order '+r.orderQuantity+' '+esc(r.purchaseUnit)+'</b>':r.flag==='overstock'?'pause reordering':'–')+'</td><td class="dim">'+r.confidence+'</td></tr>').join('')+'</table>';
  const top='<table><tr><th>#</th><th>Product</th><th class="n">Total gross profit</th><th class="n">Per unit</th><th class="n">Margin</th></tr>'+P.topProfit.map(x=>'<tr><td>'+x.rank+'</td><td>'+esc(x.name)+'</td><td class="n"><b>'+rsd(x.grossProfit)+'</b></td><td class="n">'+rsd(x.avgProfitPerUnit)+'</td><td class="n">'+fmtq(x.marginPct)+' %</td></tr>').join('')+'</table>';
  const mv=P.moving.map(m=>'<div class="find"><div class="h">'+(m.flag==='rising'?'📈':'📉')+' '+esc(m.name)+'</div><div class="x">'+m.previous+' → '+m.latest+' units ('+(m.changePct>0?'+':'')+fmtq(m.changePct)+' %)</div></div>').join('')||'<div class="empty">no product moved enough to flag</div>';
  return head+'<div class="col"><div class="two"><div class="card"><div class="ch"><h3>'+kind('fact')+'Expired stock by lot</h3></div>'+exp+'</div><div class="card"><div class="ch"><h3>'+kind('forecast')+'At risk of expiring unsold</h3></div>'+risk+'</div></div>'+
    '<div class="card"><div class="ch"><h3>'+kind('recommendation')+'Promotion candidates</h3><span class="muted" style="font-size:12px">no promotion history — no uplift is estimated</span></div>'+promo+'</div>'+
    '<div class="card"><div class="ch"><h3>'+kind('recommendation')+'Replenishment</h3>'+(P.syntheticParams?'<span class="warn" style="font-size:12px">⚠ lead times are synthetic (data/planiranje.json)</span>':'')+'</div>'+repl+'</div>'+
    '<div class="two"><div class="card"><div class="ch"><h3>'+kind('fact')+'Top products by total gross profit</h3></div>'+top+'</div><div class="card"><div class="ch"><h3>'+kind('fact')+'Week vs previous week</h3></div>'+mv+'</div></div>'+
    '<div class="dim" style="font-size:12px">As of '+esc(P.asOf)+' · full rows with sources: out/recommendations.csv, out/sales-by-product.csv</div></div>';
}
function openReview(no){openInv=no;renderReview();$('modal').classList.add('on');}
function closeReview(){openInv=null;$('modal').classList.remove('on');}
$('modal').addEventListener('click',(e)=>{if(e.target.id==='modal')closeReview();});
addEventListener('keydown',(e)=>{if(e.key==='Escape')closeReview();});
function renderReview(){
  const c=S.cases.find(x=>x.invoiceNo===openInv);if(!c)return;const can=c.status==='needs_approval',fails=c.checks.filter(x=>!x.ok);
  const lines=c.lines.map(l=>{const bad=l.delivered!=null&&l.delivered!==l.quantity;return '<tr class="'+(bad?'mismatch':'')+'"><td class="dim">'+esc(l.code)+'</td><td>'+esc(l.name)+'</td><td class="n">'+fmtq(l.quantity)+' '+esc(l.unit)+'</td><td class="n '+(bad?'bad':'')+'">'+(l.delivered==null?'<span class="bad">not delivered</span>':fmtq(l.delivered))+'</td><td class="n">'+fmt(l.unitPrice)+'</td><td class="n">'+l.vatRate+' %</td><td class="n">'+fmt(l.lineTotal)+'</td><td>'+(l.expiry?esc(l.expiry):'<span class="dim">–</span>')+'</td></tr>';}).join('');
  const checks=[...c.errors.map(e=>'<div class="check"><span class="ic bad">✗</span><span>'+esc(e)+'</span></div>'),...c.checks.map(x=>'<div class="check"><span class="ic '+(x.ok?'ok':x.blocking?'bad':'warn')+'">'+(x.ok?'✓':x.blocking?'✗':'⚠')+'</span><span><b>'+esc(x.name)+'</b> — '+esc(x.detail)+(x.impactRsd?' <span class="stake">'+rsd(x.impactRsd)+'</span>':'')+'</span></div>')].join('');
  const policy=can?'<div class="policy"><b class="warn">Why it waits for you</b><div class="muted">Every check passed, but '+rsd(c.amount)+' is above the agent limit of '+rsd(S.limitRsd)+'. Approving adds it to the payment draft — a file; nothing is paid or sent.</div></div>'
    :c.status==='held'?'<div class="policy"><b class="bad">Held — can\\'t be approved</b><div class="muted">Resolve the problems above with the supplier first (a claim is drafted below when the documents show a discrepancy). Approval never overrides a failed check.</div></div>'
    :c.status==='approved'?'<div class="policy"><b class="ok">Approved</b><div class="muted">'+esc(c.approvedBy)+' · it is in the payment draft.</div></div>':c.status==='ready'?'<div class="policy"><b class="ok">Ready</b><div class="muted">Within the agent limit — no approval needed. It is in the payment draft.</div></div>':'<div class="policy muted">The clerks are still reading this invoice and its delivery note…</div>';
  const claim=c.claim?'<div class="policy"><b>✉ Claim draft (not sent) — to '+esc(c.claim.to)+'</b><div class="muted" style="margin:6px 0">'+esc(c.claim.subject)+'</div><div style="white-space:pre-wrap;font-size:13px">'+esc(c.claim.body)+'</div></div>':c.claimError?'<div class="policy dim">Claim writer: '+esc(c.claimError)+'</div>':'';
  const pre=MODE==='live'?'/doc/':'doc/',h=hue(c.supplier);
  $('sheet').innerHTML='<div class="item" style="padding:0;cursor:default"><div class="ico" style="width:48px;height:48px;background:hsla('+h+',60%,55%,.16);color:hsl('+h+',70%,70%)">'+ini(c.supplier)+'</div><div class="t"><h2>'+esc(c.invoiceNo)+'</h2><span>'+esc(c.supplier)+'</span></div><span class="badge b-'+c.status+'">'+LABEL[c.status]+'</span><button class="btn" style="margin-left:8px" onclick="closeReview()">✕</button></div>'+
    '<div class="meta"><div><span>Total to pay</span><b>'+rsd(c.amount)+'</b></div><div><span>Issued → due</span>'+esc(c.issueDate)+' → '+esc(c.dueDate)+'</div><div><span>Supplier PIB</span>'+esc(c.pib)+'</div><div><span>Account</span>'+esc(c.account)+'</div></div>'+
    '<div class="muted" style="font-size:13px;margin-bottom:8px">📄 <a href="'+pre+c.invoicePdf.replace('data/','')+'" target="_blank">Invoice PDF</a> · <a href="'+pre+c.notePdf.replace('data/','')+'" target="_blank">Delivery note PDF</a> · '+c.checks.filter(x=>x.ok).length+' checks passed, '+fails.length+' failed</div>'+
    '<table><tr><th>Code</th><th>Item</th><th class="n">Invoiced</th><th class="n">Delivered</th><th class="n">Price</th><th class="n">VAT</th><th class="n">Total</th><th>Expiry</th></tr>'+lines+'</table>'+
    '<div style="margin-top:16px"><b>Checks</b>'+checks+'</div>'+policy+claim+
    '<div class="actions"><button class="btn" onclick="closeReview()">Close</button>'+(can?'<button class="btn go" id="appr" onclick="approve(\\''+esc(c.invoiceNo)+'\\')">Approve for payment</button>':'')+'</div>';
}
async function approve(no){
  if(MODE==='replay'){simApproved.add(no);toast('✓ '+no+' approved in this replay — simulated in your browser, nothing is saved');render();return;}
  if(!confirm('Approve '+no+' for the payment draft?\\n\\nThis only adds it to out/payment-draft.csv — nothing is paid or sent.'))return;
  const b=$('appr');if(b)b.disabled=true;
  try{const r=await fetch('/approve',{method:'POST',headers:{'content-type':'application/json','x-stockmind-token':TOKEN},body:JSON.stringify({invoiceNo:no})});const j=await r.json();toast((j.ok?'✓ ':'✗ ')+j.message);}catch(e){toast('✗ could not reach the dashboard');}
}
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),4500);}
tick();
</script></body></html>`;
