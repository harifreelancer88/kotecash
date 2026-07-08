export default {
  async fetch(request, env, ctx) {
    const html = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>kotecash — Mockup</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.23/dist/full.min.css" rel="stylesheet">
<script src="https://unpkg.com/lucide@latest"></script>
<style>
  :root {
    --c-bg: #F7F8F0; --c-surface: #EDF0E8; --c-primary: #355872;
    --c-focus: #7AAACE; --c-accent: #9CD5FF; --c-success: #4A8C6F;
    --c-danger: #C44B4B; --c-warning: #D4A24E; --c-ink: #355872; --c-sub: #6B7D8E;
  }
  body { background: var(--c-bg); color: var(--c-ink); font-family: 'Inter', system-ui, sans-serif; }
  .sidebar { background: var(--c-surface); border-right: 1px solid rgba(53,88,114,0.08); }
  .card { background: var(--c-surface); border: 1px solid rgba(53,88,114,0.08); border-radius: 12px; }
  .nav-item { color: var(--c-sub); transition: all .15s; }
  .nav-item:hover, .nav-item.active { color: var(--c-primary); background: rgba(53,88,114,0.06); }
  .btn-primary { background: var(--c-primary); color: #fff; border: none; }
  .btn-primary:hover { background: #2A4A63; }
  .badge-under { color: var(--c-success); background: rgba(74,140,111,0.1); }
  .badge-over { color: var(--c-danger); background: rgba(196,75,75,0.1); }
  .badge-track { color: var(--c-focus); background: rgba(122,170,206,0.1); }
  .health-outstanding { background: var(--c-success); color: #fff; }
  .mono { font-family: 'JetBrains Mono', monospace; }
  .page { display: none; }
  .page.active { display: block; }
  .mobile-nav { display: none; }
  @media (max-width: 768px) {
    .sidebar { display: none; }
    .mobile-nav { display: flex; position: fixed; bottom: 0; left: 0; right: 0; background: var(--c-surface); border-top: 1px solid rgba(53,88,114,0.08); z-index: 50; justify-content: space-around; padding: 8px 0; }
    .main-content { margin-left: 0 !important; padding-bottom: 72px; }
  }
</style>
</head>
<body class="min-h-screen">

<!-- Mobile Bottom Nav -->
<nav class="mobile-nav" id="mobileNav"></nav>

<div class="flex min-h-screen">
  <!-- Sidebar -->
  <aside class="sidebar w-60 min-h-screen p-4 flex flex-col gap-1 fixed left-0 top-0 bottom-0 z-40">
    <div class="text-lg font-bold text-[#355872] px-3 py-2 mb-4">📒 kotecash</div>
    <nav id="sidebarNav" class="flex flex-col gap-0.5 flex-1"></nav>
    <div class="text-[10px] text-[#6B7D8E] px-3 pt-4">v0.2 mockup — review only</div>
  </aside>

  <!-- Main -->
  <main class="main-content flex-1 ml-60 p-4 md:p-6">
    <div id="pageContent"></div>
  </main>
</div>

<script>
// ── Navigation ──
const pages = [
  { id:'dashboard', label:'Dashboard', icon:'layout-dashboard' },
  { id:'ledger', label:'Ledger', icon:'scroll-text' },
  { id:'stats', label:'Statistics', icon:'bar-chart-3' },
  { id:'categories', label:'Categories', icon:'tags' },
  { id:'budgets', label:'Budgets', icon:'wallet' },
  { id:'cicilan', label:'Cicilan', icon:'credit-card' },
  { id:'networth', label:'Net Worth', icon:'line-chart' },
  { id:'scenarios', label:'What-If', icon:'calculator' },
  { id:'tokens', label:'API Tokens', icon:'key' },
  { id:'share', label:'Share', icon:'share-2' },
  { id:'ai', label:'AI Docs', icon:'bot' },
];

function buildNav(target, mobile) {
  target.innerHTML = pages.map((p,i) => \`
    <a href="#" onclick="navigate('\${p.id}');return false"
       class="nav-item flex items-center gap-2 px-3 py-2 rounded-lg text-sm \${i===0?'active':''}"
       data-page="\${p.id}">
      <i data-lucide="\${p.icon}" class="w-4 h-4"></i>
      <span class="\${mobile?'text-[10px]':'text-sm'}">\${mobile?p.label.split(' ')[0]:p.label}</span>
    </a>\`).join('');
  lucide.createIcons();
}
buildNav(document.getElementById('sidebarNav'), false);
buildNav(document.getElementById('mobileNav'), true);

let currentPage = 'dashboard';
function navigate(id) {
  currentPage = id;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === id));
  document.getElementById('pageContent').innerHTML = renderPage(id);
  lucide.createIcons();
}

// ── Mock Data ──
const M = {
  income: 11774644, expense: 8150000, net: 3624644,
  savingsRate: 0.308, dti: 0.263,
  categories: ['Makan','Transport','BRI','CC TOKPED','CC BCA','Belanja Cash','PAK AYAN','BERAS','CANANG','Listrik Kampung','BPJS Ibu','Hiburan','Kesehatan','Lain-lain','Gaji M2','Freelance'],
  budgets: [
    {cat:'Makan',budget:3000000,actual:580000},
    {cat:'Transport',budget:1000000,actual:125000},
    {cat:'BRI',budget:1800000,actual:1800000},
    {cat:'CC TOKPED',budget:1000000,actual:0},
    {cat:'CC BCA',budget:300000,actual:0},
    {cat:'Belanja Cash',budget:4000000,actual:0},
    {cat:'Hiburan',budget:1000000,actual:149000},
    {cat:'Kesehatan',budget:500000,actual:85000},
  ],
  cicilan: [
    {name:'BRI',total:50000000,sisa:32000000,monthly:1800000,tenor:24,bunga:8.5,due:'2027-01-01',status:'active'},
    {name:'CC TOKPED',total:5000000,sisa:5000000,monthly:1000000,tenor:5,bunga:0,due:'2026-05-01',status:'active'},
    {name:'CC BCA',total:1500000,sisa:1500000,monthly:300000,tenor:5,bunga:0,due:'2026-06-01',status:'active'},
  ],
  txns: [
    {date:'2026-06-18',cat:'Makan',desc:'GrabFood dinner',amount:65000,method:'OVO',type:'expense'},
    {date:'2026-06-15',cat:'Belanja Cash',desc:'Sewa kos',amount:2000000,method:'Transfer',type:'expense'},
    {date:'2026-06-14',cat:'Lain-lain',desc:'Pulsa & kuota',amount:100000,method:'OVO',type:'expense'},
    {date:'2026-06-12',cat:'Kesehatan',desc:'Vitamin + obat',amount:85000,method:'Cash',type:'expense'},
    {date:'2026-06-10',cat:'Makan',desc:'Makan bareng teman',amount:120000,method:'Cash',type:'expense'},
    {date:'2026-06-08',cat:'Transport',desc:'Gojek meeting',amount:25000,method:'OVO',type:'expense'},
    {date:'2026-06-07',cat:'Hiburan',desc:'Netflix',amount:149000,method:'CC BCA',type:'expense'},
    {date:'2026-06-05',cat:'BRI',desc:'Cicilan BRI',amount:1800000,method:'BCA Transfer',type:'expense'},
    {date:'2026-06-03',cat:'Makan',desc:'Belanja Indomaret',amount:350000,method:'BCA Debit',type:'expense'},
    {date:'2026-06-02',cat:'Transport',desc:'Bensin Pertalite',amount:100000,method:'Cash',type:'expense'},
    {date:'2026-06-01',cat:'Makan',desc:'GoFood lunch',amount:45000,method:'OVO',type:'expense'},
    {date:'2026-05-20',cat:'Gaji M2',desc:'Gaji MAY 2026',amount:11774644,method:'Transfer',type:'income'},
  ],
  networth: [
    {month:'2026-01',assets:15000000,liabilities:60000000},
    {month:'2026-02',assets:15000000,liabilities:58200000},
    {month:'2026-03',assets:15000000,liabilities:56400000},
    {month:'2026-04',assets:15000000,liabilities:54600000},
    {month:'2026-05',assets:26774644,liabilities:52800000},
    {month:'2026-06',assets:26774644,liabilities:51000000},
  ],
};

function fmt(n) { return n.toLocaleString('id-ID'); }
function pct(n) { return (n*100).toFixed(1)+'%'; }

// ── Page Renderers ──
function renderPage(id) {
  switch(id) {
    case 'dashboard': return renderDashboard();
    case 'ledger': return renderLedger();
    case 'stats': return renderStats();
    case 'categories': return renderCategories();
    case 'budgets': return renderBudgets();
    case 'cicilan': return renderCicilan();
    case 'networth': return renderNetWorth();
    case 'scenarios': return renderScenarios();
    case 'tokens': return renderTokens();
    case 'share': return renderShare();
    case 'ai': return renderAI();
    default: return '<p>Page not found</p>';
  }
}

function renderDashboard() {
  const healthTier = M.savingsRate >= 0.3 ? ['Outstanding','health-outstanding','award']
    : M.savingsRate >= 0.2 ? ['Excellent','bg-[#7AAACE] text-white','star']
    : M.savingsRate >= 0.1 ? ['Good','bg-[#D4A24E] text-white','thumbs-up']
    : ['Needs Improvement','bg-[#C44B4B] text-white','alert-triangle'];
  const dtiTier = M.dti < 0.3 ? ['Healthy','text-[#4A8C6F]'] : M.dti < 0.5 ? ['High','text-[#D4A24E]'] : ['Critical','text-[#C44B4B]'];
  return \`
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-[#355872]">Dashboard</h1>
      <span class="text-sm text-[#6B7D8E]">June 2026</span>
    </div>
    <!-- Totals -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <div class="card p-4"><div class="text-xs text-[#6B7D8E] uppercase tracking-wide">Income</div><div class="text-2xl font-bold mono text-[#4A8C6F] mt-1">Rp \${fmt(M.income)}</div></div>
      <div class="card p-4"><div class="text-xs text-[#6B7D8E] uppercase tracking-wide">Expense</div><div class="text-2xl font-bold mono text-[#C44B4B] mt-1">Rp \${fmt(M.expense)}</div></div>
      <div class="card p-4"><div class="text-xs text-[#6B7D8E] uppercase tracking-wide">Net Balance</div><div class="text-2xl font-bold mono mt-1 \${M.net>=0?'text-[#4A8C6F]':'text-[#C44B4B]'}">Rp \${fmt(Math.abs(M.net))}</div></div>
    </div>
    <!-- Health -->
    <div class="card p-4 mb-6">
      <h2 class="text-sm font-semibold text-[#6B7D8E] uppercase tracking-wide mb-3">Financial Health</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="text-center"><div class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-semibold \${healthTier[1]}"><i data-lucide="\${healthTier[2]}" class="w-4 h-4"></i> \${healthTier[0]}</div><div class="text-xs text-[#6B7D8E] mt-1">Savings: \${pct(M.savingsRate)}</div></div>
        <div class="text-center"><div class="text-lg font-bold mono \${dtiTier[1]}">\${pct(M.dti)}</div><div class="text-xs text-[#6B7D8E]">DTI — \${dtiTier[0]}</div></div>
        <div class="text-center"><div class="text-lg font-bold mono \${(M.expense/M.income)>0.5?'text-[#C44B4B]':'text-[#4A8C6F]'}">\${pct(M.expense/M.income)}</div><div class="text-xs text-[#6B7D8E]">50/30/20 Needs</div></div>
        <div class="text-center"><div class="text-lg font-bold mono text-[#4A8C6F]">\${pct(M.savingsRate)}</div><div class="text-xs text-[#6B7D8E]">50/30/20 Savings</div></div>
      </div>
    </div>
    <!-- Budgets -->
    <div class="card p-4 mb-6">
      <h2 class="text-sm font-semibold text-[#6B7D8E] uppercase tracking-wide mb-3">Budgets</h2>
      <div class="space-y-2">\${M.budgets.slice(0,5).map(b=>{
        const pctUsed = b.budget > 0 ? b.actual/b.budget : 0;
        const status = pctUsed > 1 ? ['OVER','badge-over','alert-triangle'] : pctUsed > 0.9 ? ['ON TRACK','badge-track','check-circle'] : ['UNDER','badge-under','check-circle-2'];
        return \`<div class="flex items-center gap-3 text-sm"><span class="w-24 text-[#6B7D8E]">\${b.cat}</span>
          <div class="flex-1 bg-white rounded-full h-2"><div class="h-2 rounded-full \${pctUsed>1?'bg-[#C44B4B]':'bg-[#7AAACE]'}" style="width:\${Math.min(pctUsed*100,100)}%"></div></div>
          <span class="mono text-xs w-28 text-right">Rp\${fmt(b.actual)} / \${fmt(b.budget)}</span>
          <span class="\${status[1]} inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"><i data-lucide="\${status[2]}" class="w-3 h-3"></i> \${status[0]}</span></div>\`;
      }).join('')}</div>
    </div>
    <!-- Upcoming Cicilan -->
    <div class="card p-4"><h2 class="text-sm font-semibold text-[#6B7D8E] uppercase tracking-wide mb-3">Upcoming Cicilan</h2>
      <div class="space-y-2">\${M.cicilan.filter(c=>c.status==='active').map(c=>\`<div class="flex items-center justify-between text-sm"><span>\${c.name}</span><span class="mono">Rp\${fmt(c.monthly)}</span><span class="text-xs text-[#6B7D8E]">Due: \${c.due}</span></div>\`).join('')}</div>
    </div>\`;
}

function renderLedger() {
  return \`<div class="flex items-center justify-between mb-6"><h1 class="text-2xl font-bold text-[#355872]">Ledger</h1>
    <button class="btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-1"><i data-lucide="plus" class="w-4 h-4"></i> Add</button></div>
    <div class="card p-4 mb-4 flex flex-wrap gap-2"><input placeholder="Search notes..." class="input input-sm bg-white border-[#7AAACE] text-sm flex-1 min-w-[150px]">
      <select class="select select-sm bg-white border-[#7AAACE] text-sm"><option>All Categories</option>\${M.categories.map(c=>\`<option>\${c}</option>\`).join('')}</select>
      <select class="select select-sm bg-white border-[#7AAACE] text-sm"><option>All Types</option><option>Income</option><option>Expense</option></select>
      <select class="select select-sm bg-white border-[#7AAACE] text-sm"><option>All Methods</option><option>Cash</option><option>Transfer</option><option>OVO</option><option>BCA Debit</option><option>CC BCA</option></select></div>
    <div class="card overflow-x-auto"><table class="w-full text-sm"><thead><tr class="text-[10px] text-[#6B7D8E] uppercase tracking-wide border-b border-[rgba(53,88,114,0.08)]">
      <th class="p-2 text-left">Date</th><th class="p-2 text-left">Category</th><th class="p-2 text-left">Description</th><th class="p-2 text-left">Method</th><th class="p-2 text-right mono">Amount</th><th class="p-2"></th></tr></thead>
    <tbody>\${M.txns.map((t,i)=>
      \`<tr class="border-b border-[rgba(53,88,114,0.04)] \${i%2?'bg-white':''}"><td class="p-2 mono text-xs">\${t.date}</td>
        <td class="p-2">\${t.cat}</td><td class="p-2 text-[#6B7D8E]">\${t.desc}</td><td class="p-2 text-xs">\${t.method}</td>
        <td class="p-2 text-right mono \${t.type==='income'?'text-[#4A8C6F]':'text-[#C44B4B]'}">\${t.type==='income'?'+':'-'} Rp\${fmt(t.amount)}</td>
        <td class="p-2"><div class="flex gap-1"><button class="text-[#6B7D8E] hover:text-[#355872]"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button><button class="text-[#6B7D8E] hover:text-[#C44B4B]"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></div></td></tr>\`
    ).join('')}</tbody></table>
    <div class="flex items-center justify-between p-3 text-xs text-[#6B7D8E]"><span>Showing \${M.txns.length} transactions</span><div class="flex gap-1"><button class="px-2 py-1 rounded border border-[rgba(53,88,114,0.08)]">Prev</button><button class="px-2 py-1 rounded bg-[#355872] text-white">1</button><button class="px-2 py-1 rounded border border-[rgba(53,88,114,0.08)]">Next</button></div></div></div>\`;
}

function renderStats() {
  return \`<h1 class="text-2xl font-bold text-[#355872] mb-6">Statistics</h1>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="card p-4"><h3 class="text-sm font-semibold text-[#6B7D8E] uppercase mb-3">Income vs Expense (Monthly)</h3>
        <div class="h-48 flex items-end gap-2 px-2">\${['Jan','Feb','Mar','Apr','Mei','Jun'].map((m,i)=>{
          const isMei = m==='Mei'; const inc = isMei ? M.income : 0; const exp = 8150000;
          const maxH = 140; const incH = inc/M.income * maxH; const expH = exp/10000000 * maxH;
          return \`<div class="flex-1 flex flex-col items-center gap-1"><div class="w-full flex flex-col items-center" style="height:\${maxH}px;justify-content:flex-end">
            <div class="w-5 bg-[#4A8C6F] rounded-t" style="height:\${incH}px"></div><div class="w-5 bg-[#C44B4B] rounded-t mt-0.5" style="height:\${expH}px"></div></div><span class="text-[10px] text-[#6B7D8E]">\${m}</span></div>\`;
        }).join('')}</div>
        <div class="flex gap-4 justify-center mt-2 text-xs"><span class="flex items-center gap-1"><span class="w-3 h-3 bg-[#4A8C6F] rounded"></span> Income</span><span class="flex items-center gap-1"><span class="w-3 h-3 bg-[#C44B4B] rounded"></span> Expense</span></div></div>
      <div class="card p-4"><h3 class="text-sm font-semibold text-[#6B7D8E] uppercase mb-3">Spending by Category</h3>
        <div class="space-y-2">\${[{cat:'Makan',amt:580000},{cat:'BRI',amt:1800000},{cat:'Belanja Cash',amt:2000000},{cat:'Hiburan',amt:149000},{cat:'Transport',amt:125000}].map(c=>{
          const p = c.amt/M.expense*100;
          return \`<div class="flex items-center gap-2 text-xs"><span class="w-20 text-[#6B7D8E]">\${c.cat}</span><div class="flex-1 bg-white rounded-full h-2"><div class="h-2 rounded-full bg-[#7AAACE]" style="width:\${p}%"></div></div><span class="mono w-24 text-right">Rp\${fmt(c.amt)}</span><span class="w-10 text-right">\${p.toFixed(0)}%</span></div>\`;
        }).join('')}</div></div>
    </div>\`;
}

function renderCategories() {
  return \`<div class="flex items-center justify-between mb-6"><h1 class="text-2xl font-bold text-[#355872]">Categories</h1>
    <button class="btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-1"><i data-lucide="plus" class="w-4 h-4"></i> Add</button></div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="card p-4"><h2 class="text-sm font-semibold text-[#6B7D8E] uppercase mb-3">Expense Categories</h2>
        <div class="space-y-1">\${['Makan','Transport','BRI','CC TOKPED','CC BCA','Belanja Cash','PAK AYAN','BERAS','CANANG','Listrik Kampung','BPJS Ibu','Hiburan','Kesehatan','Lain-lain'].map(c=>\`<div class="flex items-center justify-between px-2 py-1 rounded hover:bg-white text-sm"><span>\${c}</span><div class="flex gap-1"><button class="text-[#6B7D8E] hover:text-[#355872]"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button></div></div>\`).join('')}</div></div>
      <div class="card p-4"><h2 class="text-sm font-semibold text-[#6B7D8E] uppercase mb-3">Income Categories</h2>
        <div class="space-y-1">\${['Gaji M2','Freelance','Lain-lain Income'].map(c=>\`<div class="flex items-center justify-between px-2 py-1 rounded hover:bg-white text-sm"><span>\${c}</span><div class="flex gap-1"><button class="text-[#6B7D8E] hover:text-[#355872]"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button></div></div>\`).join('')}</div></div>
    </div>\`;
}

function renderBudgets() {
  return \`<div class="flex items-center justify-between mb-6"><h1 class="text-2xl font-bold text-[#355872]">Budgets</h1><span class="text-sm text-[#6B7D8E]">June 2026</span></div>
    <div class="card"><table class="w-full text-sm"><thead><tr class="text-[10px] text-[#6B7D8E] uppercase tracking-wide border-b border-[rgba(53,88,114,0.08)]">
      <th class="p-3 text-left">Category</th><th class="p-3 text-right mono">Budget</th><th class="p-3 text-right mono">Actual</th><th class="p-3 text-right mono">Remaining</th><th class="p-3 text-center">Status</th></tr></thead>
    <tbody>\${M.budgets.map(b=>{
      const rem = b.budget - b.actual; const pct = b.actual/b.budget;
      const st = rem < 0 ? ['OVER','badge-over','alert-triangle'] : rem === 0 ? ['ON TRACK','badge-track','check-circle'] : ['UNDER','badge-under','check-circle-2'];
      return \`<tr class="border-b border-[rgba(53,88,114,0.04)]"><td class="p-3">\${b.cat}</td>
        <td class="p-3 text-right mono">Rp\${fmt(b.budget)}</td><td class="p-3 text-right mono">Rp\${fmt(b.actual)}</td>
        <td class="p-3 text-right mono \${rem<0?'text-[#C44B4B]':'text-[#4A8C6F]'}">Rp\${fmt(Math.abs(rem))}</td>
        <td class="p-3 text-center"><span class="\${st[1]} inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold"><i data-lucide="\${st[2]}" class="w-3 h-3"></i> \${st[0]}</span></td></tr>\`;
    }).join('')}</tbody></table></div>\`;
}

function renderCicilan() {
  return \`<div class="flex items-center justify-between mb-6"><h1 class="text-2xl font-bold text-[#355872]">Cicilan</h1>
    <button class="btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-1"><i data-lucide="plus" class="w-4 h-4"></i> Add</button></div>
    <div class="space-y-4">\${M.cicilan.map(c=>{
      const remaining = Math.ceil(c.sisa / c.monthly);
      const pctPaid = ((c.total-c.sisa)/c.total*100).toFixed(0);
      return \`<div class="card p-4"><div class="flex items-start justify-between mb-3"><div><h3 class="font-semibold">\${c.name}</h3><p class="text-xs text-[#6B7D8E]">\${c.sisa===0?'Paid Off':'Active'} · \${remaining} months left</p></div>
        <span class="mono text-lg font-bold text-[#355872]">Rp\${fmt(c.sisa)}</span></div>
        <div class="bg-white rounded-full h-2 mb-3"><div class="h-2 rounded-full bg-[#7AAACE]" style="width:\${pctPaid}%"></div></div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs"><div><span class="text-[#6B7D8E]">Monthly</span><br><span class="mono">Rp\${fmt(c.monthly)}</span></div>
          <div><span class="text-[#6B7D8E]">Interest</span><br><span class="mono">\${c.bunga}%</span></div>
          <div><span class="text-[#6B7D8E]">Due Date</span><br><span class="mono">\${c.due}</span></div>
          <div><span class="text-[#6B7D8E]">Total</span><br><span class="mono">Rp\${fmt(c.total)}</span></div></div></div>\`;
    }).join('')}</div>\`;
}

function renderNetWorth() {
  const last = M.networth[M.networth.length-1];
  const prev = M.networth[M.networth.length-2];
  const nw = last.assets - last.liabilities;
  const delta = nw - (prev.assets - prev.liabilities);
  const maxAbs = Math.max(...M.networth.map(n=>Math.abs(n.assets-n.liabilities)));
  return \`<h1 class="text-2xl font-bold text-[#355872] mb-6">Net Worth</h1>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <div class="card p-4"><div class="text-xs text-[#6B7D8E] uppercase">Assets</div><div class="text-xl font-bold mono text-[#4A8C6F]">Rp\${fmt(last.assets)}</div></div>
      <div class="card p-4"><div class="text-xs text-[#6B7D8E] uppercase">Liabilities</div><div class="text-xl font-bold mono text-[#C44B4B]">Rp\${fmt(last.liabilities)}</div></div>
      <div class="card p-4"><div class="text-xs text-[#6B7D8E] uppercase">Net Worth</div><div class="text-xl font-bold mono \${nw>=0?'text-[#4A8C6F]':'text-[#C44B4B]'}">Rp\${fmt(Math.abs(nw))} <span class="text-sm \${delta>=0?'text-[#4A8C6F]':'text-[#C44B4B]'}">\${delta>=0?'+':''}\${fmt(delta)}</span></div></div></div>
    <div class="card p-4"><h3 class="text-sm font-semibold text-[#6B7D8E] uppercase mb-3">Trend (12 months)</h3>
      <div class="h-48 flex items-end gap-2 px-2">\${M.networth.map(n=>{
        const val = n.assets - n.liabilities; const h = 120; const barH = Math.abs(val)/maxAbs * h;
        return \`<div class="flex-1 flex flex-col items-center gap-1"><div class="w-full flex items-end justify-center" style="height:\${h}px"><div class="w-4 \${val>=0?'bg-[#4A8C6F]':'bg-[#C44B4B]'} rounded-t" style="height:\${barH}px"></div></div><span class="text-[10px] text-[#6B7D8E]">\${n.month.slice(5)}</span></div>\`;
      }).join('')}</div></div>\`;
}

function renderScenarios() {
  const newIncome10 = M.income * 1.1; const newSavings10 = (newIncome10 - M.expense) / newIncome10;
  const newIncome20 = M.income * 1.2; const newSavings20 = (newIncome20 - M.expense) / newIncome20;
  return \`<h1 class="text-2xl font-bold text-[#355872] mb-6">What-If Simulator</h1>
    <div class="card p-4 mb-6"><h3 class="text-sm font-semibold text-[#6B7D8E] uppercase mb-3">Current</h3>
      <div class="grid grid-cols-3 gap-4 text-center"><div><div class="mono text-lg">Rp\${fmt(M.income)}</div><div class="text-xs text-[#6B7D8E]">Income</div></div>
        <div><div class="mono text-lg">Rp\${fmt(M.expense)}</div><div class="text-xs text-[#6B7D8E]">Expense</div></div>
        <div><div class="mono text-lg font-bold text-[#4A8C6F]">\${pct(M.savingsRate)}</div><div class="text-xs text-[#6B7D8E]">Savings Rate</div></div></div></div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="card p-4"><h3 class="text-sm font-semibold text-[#355872] mb-3">Income +10%</h3>
        <div class="text-center"><div class="mono text-xl font-bold text-[#7AAACE]">\${pct(newSavings10)}</div><div class="text-xs text-[#6B7D8E]">New Savings Rate</div><div class="text-xs mt-2 \${newSavings10>M.savingsRate?'text-[#4A8C6F]':'text-[#C44B4B]'}">↑ +\${pct(newSavings10-M.savingsRate)} from current</div></div></div>
      <div class="card p-4"><h3 class="text-sm font-semibold text-[#355872] mb-3">Income +20%</h3>
        <div class="text-center"><div class="mono text-xl font-bold text-[#7AAACE]">\${pct(newSavings20)}</div><div class="text-xs text-[#6B7D8E]">New Savings Rate</div><div class="text-xs mt-2 \${newSavings20>M.savingsRate?'text-[#4A8C6F]':'text-[#C44B4B]'}">↑ +\${pct(newSavings20-M.savingsRate)} from current</div></div></div>
    </div>\`;
}

function renderTokens() {
  return \`<div class="flex items-center justify-between mb-6"><h1 class="text-2xl font-bold text-[#355872]">API Tokens</h1>
    <button class="btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-1"><i data-lucide="plus" class="w-4 h-4"></i> Generate</button></div>
    <div class="card p-4 mb-4"><h3 class="text-sm font-semibold text-[#6B7D8E] uppercase mb-3">Active Tokens</h3>
      <table class="w-full text-sm"><thead><tr class="text-[10px] text-[#6B7D8E] uppercase tracking-wide border-b border-[rgba(53,88,114,0.08)]">
        <th class="p-2 text-left">Label</th><th class="p-2 text-left">Prefix</th><th class="p-2 text-left">Created</th><th class="p-2 text-left">Last Used</th><th class="p-2"></th></tr></thead>
      <tbody><tr class="border-b border-[rgba(53,88,114,0.04)]"><td class="p-2">hermes-agent</td><td class="p-2 mono text-xs">kote_a1b2...</td><td class="p-2 text-xs text-[#6B7D8E]">2026-06-15</td><td class="p-2 text-xs text-[#6B7D8E]">2026-06-20 14:30</td>
        <td class="p-2"><button class="text-[#C44B4B] text-xs hover:underline">Revoke</button></td></tr></tbody></table></div>\`;
}

function renderShare() {
  return \`<h1 class="text-2xl font-bold text-[#355872] mb-6">Share</h1>
    <div class="card p-4 mb-4"><h3 class="text-sm font-semibold text-[#6B7D8E] uppercase mb-3">Generate Share Link</h3>
      <p class="text-sm text-[#6B7D8E] mb-3">Create a read-only link for your spouse to view dashboard and statistics.</p>
      <button class="btn-primary px-4 py-2 rounded-lg text-sm">Generate Link</button></div>
    <div class="card p-4"><h3 class="text-sm font-semibold text-[#6B7D8E] uppercase mb-3">Active Share Links</h3>
      <div class="text-sm text-[#6B7D8E]">No active share links.</div></div>\`;
}

function renderAI() {
  return \`<h1 class="text-2xl font-bold text-[#355872] mb-6">AI Assistant Docs</h1>
    <div class="card p-4 mb-4"><h3 class="text-sm font-semibold text-[#6B7D8E] uppercase mb-3">Quick Start</h3>
      <pre class="bg-[#1e293b] text-[#e2e8f0] p-4 rounded-lg text-xs overflow-x-auto">
# Set your token
export KOTECASH_TOKEN="kote_***"
export KOTECASH_BASE="https://kotecash.workers.dev"

# Check health
curl -H "Authorization: Bearer \$KOTEE...EN" \\\\
     "\$KOTECASH_BASE/api/health"</pre></div>
    <div class="card p-4"><h3 class="text-sm font-semibold text-[#6B7D8E] uppercase mb-3">Endpoints</h3>
      <table class="w-full text-sm"><thead><tr class="text-[10px] text-[#6B7D8E] uppercase tracking-wide border-b border-[rgba(53,88,114,0.08)]">
        <th class="p-2 text-left">Method</th><th class="p-2 text-left">Endpoint</th><th class="p-2 text-left">Description</th></tr></thead>
      <tbody>\${[
        ['GET','/api/dashboard','Current month totals, health score, budgets, cicilan'],
        ['GET','/api/health','Savings rate, DTI, 50/30/20 breakdown'],
        ['POST','/api/transactions','Log a new transaction'],
        ['GET','/api/transactions','List transactions (paginated, filterable)'],
        ['PUT','/api/transactions/:id','Update a transaction'],
        ['DELETE','/api/transactions/:id','Delete a transaction'],
        ['GET','/api/cicilan','List all active installments'],
        ['GET','/api/budgets','Current month budgets with progress'],
        ['GET','/api/networth','Net worth time-series'],
      ].map(([m,e,d])=>\`<tr class="border-b border-[rgba(53,88,114,0.04)]"><td class="p-2"><span class="bg-[#355872] text-white px-1.5 py-0.5 rounded text-[10px] font-mono">\${m}</span></td><td class="p-2 mono text-xs">\${e}</td><td class="p-2 text-xs text-[#6B7D8E]">\${d}</td></tr>\`).join('')}</tbody></table></div>\`;
}

// ── Init ──
navigate('dashboard');
</script>
</body>
</html>
`;
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
};
