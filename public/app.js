/* =================================================================
   kotecash — frontend app
   Ported from the v3 mockup; mock data replaced by live API calls.
   ================================================================= */

var API_BASE = "";

// ── M (live data, shaped like the mockup) ────────────────────────
var M = {
  income: 0, expense: 0, net: 0, savingsRate: 0, dti: 0,
  wallets: [], creditCards: [], deposits: [], portfolios: [],
  cicilan: [], txns: [], networth: [], goals: [], earmarks: [],
  budgets: [], budgetSummary: [], cashFlow: {}, cashFlowCategories: [], cashFlowAlerts: [], recurringCandidates: [], expenseCats: [], incomeCats: [],
  recurring: [], liabilities: [], liabilitySummary: {},
  dashboard: {}, financialOverview: null, incomeSources: [], incomeSummary: {}, incomeForecast: {}, expectedCalendar: {},
};

// name/id resolution maps
var WMAP = {}, DMAP = {}, PMAP = {}, GMAP = {}, CATMAP = {};
var charts = {};
var currentPage = "dashboard";

// ── fetch wrapper (cookie auth) ──────────────────────────────────
async function api(path, opts) {
  var res = await fetch(API_BASE + path, {
    method: (opts && opts.method) || "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts && opts.headers || {}) },
    body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { window.location.href = "/login"; throw new Error("unauth"); }
  var text = await res.text();
  var data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
  return data;
}

// ── utilities ────────────────────────────────────────────────────
function fmt(n) { return Number(n || 0).toLocaleString("id-ID"); }
function pct(n) { return (Number(n || 0) * 100).toFixed(1) + "%"; }
function ordinal(n) {
  n = parseInt(n, 10) || 0;
  if (n % 100 >= 11 && n % 100 <= 13) return n + "th";
  return n + (["th", "st", "nd", "rd"][n % 10] || "th");
}

function healthBadge(rate) {
  if (rate >= 0.3) return ["Outstanding", "bg-[#4A8C6F] text-white", "award"];
  if (rate >= 0.2) return ["Excellent", "bg-[#7AAACE] text-white", "star"];
  if (rate >= 0.1) return ["Good", "bg-[#D4A24E] text-white", "thumbs-up"];
  return ["Needs Improvement", "bg-[#C44B4B] text-white", "alert-triangle"];
}
function budgetBadge(actual, budget) {
  var ratio = budget > 0 ? actual / budget : 0;
  if (ratio > 1) return ["OVER", "badge-over", "alert-triangle"];
  if (ratio > 0.9) return ["ON TRACK", "badge-track", "check-circle"];
  return ["UNDER", "badge-under", "check-circle-2"];
}

// derived (use API-computed values + flat earmark list)
function walletBalance(name) {
  var w = M.wallets.find(function (x) { return x.name === name; });
  return w ? w.balance : 0;
}
function walletEarmarked(name) {
  return M.earmarks
    .filter(function (e) { return e.source === name && isWalletSource(name); })
    .reduce(function (s, e) { return s + e.amount; }, 0);
}
function isWalletSource(name) { return !!WMAP[name]; }
function walletFree(name) { return walletBalance(name) - walletEarmarked(name); }
function goalProgress(name) {
  return M.earmarks.filter(function (e) { return e.goal === name; })
    .reduce(function (s, e) { return s + e.amount; }, 0);
}

// ── hydrate M from API (all endpoints in parallel) ──────────────
async function loadAll() {
  var data = await Promise.all([
    api("/api/categories"), api("/api/wallets"), api("/api/credit-cards"),
    api("/api/deposits"), api("/api/portfolios"), api("/api/cicilan"),
    api("/api/goals"), api("/api/budgets"), api("/api/transactions"),
    api("/api/dashboard"), api("/api/net-worth"), api("/api/recurring"), api("/api/net-worth/snapshots"), api("/api/liabilities"), api("/api/liabilities/summary"), api("/api/budgets/summary"), api("/api/cash-flow/monthly"), api("/api/cash-flow/categories"), api("/api/cash-flow/alerts"), api("/api/cash-flow/recurring-candidates"), api("/api/dashboard/financial-overview"), api("/api/income-sources"), api("/api/income/summary"), api("/api/income/forecast"), api("/api/cash-flow/expected-calendar"),
  ]);
  var cats = data[0], wallets = data[1], ccs = data[2], deps = data[3],
    ports = data[4], cics = data[5], goals = data[6], buds = data[7],
    txns = data[8], dash = data[9], nw = data[10], recur = data[11], nws = data[12] || {}, liabilities = data[13] || {}, liabilitySummary = data[14] || {}, budgetSummary = data[15] || [], cashFlow = data[16] || {}, cashFlowCategories = data[17] || [], cashFlowAlerts = data[18] || [], recurringCandidates = data[19] || [], financialOverview = data[20] || null, incomeSources = data[21] || [], incomeSummary = data[22] || {}, incomeForecast = data[23] || {}, expectedCalendar = data[24] || {};

  cats.forEach(function (c) { CATMAP[c.name] = c.id; });
  M.expenseCats = cats.filter(function (c) { return c.type === "expense"; }).map(function (c) { return c.name; });
  M.incomeCats = cats.filter(function (c) { return c.type === "income"; }).map(function (c) { return c.name; });

  M.wallets = wallets.map(function (w) {
    WMAP[w.name] = w.id;
    return { id: w.id, name: w.name, type: w.type, balance: w.balance, number: w.account_number, reconciliation: w.reconciliation, activity: w.activity };
  });

  M.creditCards = ccs.map(function (c) {
    return {
      id: c.id, name: c.name, limit: c.limit_amount, balance: c.balance,
      statementDay: c.statement_day, dueDay: c.due_day,
      minPayment: 0, minPaymentPct: c.min_payment_pct,
      interestRate: c.interest_rate, annualFee: c.annual_fee,
    };
  });

  M.deposits = deps.map(function (d) {
    DMAP[d.bank] = d.id;
    return { id: d.id, bank: d.bank, amount: d.amount, rate: d.rate, tenor: d.tenor_months, start: d.start_date, maturity: d.maturity_date, status: d.status };
  });

  M.portfolios = ports.map(function (p) {
    PMAP[p.name] = p.id;
    return { id: p.id, name: p.name, value: p.currentValue ?? p.value ?? 0, currentValue: p.currentValue ?? p.value ?? 0 };
  });

  M.cicilan = cics.map(function (c) {
    return { id: c.id, name: c.name, total: c.total_utang, sisa: c.sisa, monthly: c.monthly_payment, bunga: c.bunga_persen, start: c.start_date, due: c.due_date, status: c.status };
  });

  M.goals = goals.map(function (g) {
    GMAP[g.name] = g.id;
    return { id: g.id, name: g.name, target: g.target_amount, icon: g.icon || "target", goal_type: g.goal_type || "custom", priority: g.priority || "medium", status: g.status || "active", target_date: g.target_date, progress: g.progress || 0, pct: g.pct || 0, progress_details: g.progress_details || {} };
  });

  // flat earmarks, resolving source names
  M.earmarks = [];
  goals.forEach(function (g) {
    (g.earmarks || []).forEach(function (e) {
      var src = resolveSourceName(e.source_type, e.source_id);
      M.earmarks.push({ id: e.id, goal: g.name, source: src, amount: e.amount, source_type: e.source_type, source_id: e.source_id });
    });
  });

  M.budgets = buds.map(function (b) {
    return { id: b.id, cat: b.category_name, budget: b.effective_budget || b.budget_amount, actual: b.actual_spending ?? b.actual, status: b.status, projected: b.projected_month_end_spending, safe: b.daily_safe_to_spend, used: b.used_percentage, remaining: b.remaining_amount };
  });

  M.txns = txns.map(function (t) {
    return { id: t.id, date: t.date, cat: nameById(CATMAP, t.category_id), desc: t.description, amount: t.amount, method: t.payment_method, type: t.type, category_id: t.category_id, source: t.source, sync_status: t.sync_status, reference_number: t.reference_number };
  });

  M.income = dash.income; M.expense = dash.expense; M.net = dash.sisa;
  M.savingsRate = cashFlow.savings_rate ?? dash.savingsRate; M.dti = dash.dti; M.dashboard = dash || {}; M.financialOverview = financialOverview; M.incomeSources = incomeSources; M.incomeSummary = incomeSummary; M.incomeForecast = incomeForecast; M.expectedCalendar = expectedCalendar; M.budgetSummary = budgetSummary; M.cashFlow = cashFlow; M.cashFlowCategories = cashFlowCategories; M.cashFlowAlerts = cashFlowAlerts; M.recurringCandidates = recurringCandidates;

  M.networth = ((nws.snapshots && nws.snapshots.length) ? nws.snapshots.slice().reverse() : (nw.snapshots || [])).map(function (s) {
    var br = s.breakdown || {};
    return { id: s.id, month: s.month || s.snapshot_month, snapshot_date: s.snapshot_date, assets: s.assets_total ?? s.assets, liabilities: s.liabilities_total ?? s.liabilities, netWorth: s.net_worth ?? s.netWorth, investments_total: s.investments_total ?? br.assets?.investments, cash_total: s.cash_total, other_assets_total: s.other_assets_total, assetBreakdown: s.assetBreakdown || br.assets || {}, liabilityBreakdown: s.liabilityBreakdown || br.liabilities || {}, valuation_complete: s.valuation_complete, valuation_status: s.valuation_status, locked: s.locked, warnings: s.warnings || br.health?.warnings || [] };
  });
  M.networthAnalytics = nws.analytics || {};
  M.liabilities = liabilities.liabilities || [];
  M.liabilitySummary = liabilitySummary || {};

  M.recurring = (recur || []).map(function (r) {
    return {
      id: r.id, frequency: r.frequency, amount: r.amount, description: r.description,
      category_id: r.category_id, day_of_month: r.day_of_month, month_of_year: r.month_of_year,
      weekday: r.weekday, next_run: (r.next_run || "").slice(0, 10), active: r.active,
      src_kind: r.src_kind, src_id: r.src_id, dst_kind: r.dst_kind, dst_id: r.dst_id,
    };
  });
}

function nameById(map, id) {
  for (var k in map) if (String(map[k]) === String(id)) return k;
  return "?";
}
function resolveSourceName(type, id) {
  if (type === "wallet") { var w = M.wallets.find(function (x) { return x.id === id; }); return w ? w.name : "wallet"; }
  if (type === "deposit") { var d = M.deposits.find(function (x) { return x.id === id; }); return d ? d.bank : "deposit"; }
  if (type === "portfolio") { var p = M.portfolios.find(function (x) { return x.id === id; }); return p ? p.name : "portfolio"; }
  return "source";
}
function sourceTypeAndId(name) {
  if (WMAP[name]) return { source_type: "wallet", source_id: WMAP[name] };
  if (DMAP[name]) return { source_type: "deposit", source_id: DMAP[name] };
  if (PMAP[name]) return { source_type: "portfolio", source_id: PMAP[name] };
  return null;
}
function catId(name) { return CATMAP[name]; }

// ── router ───────────────────────────────────────────────────────
function pageFromUrl() {
  return new URLSearchParams(window.location.search).get("page") || "dashboard";
}

function navigate(id, push) {
  currentPage = id;
  if (push !== false) {
    var u = new URL(window.location.href);
    u.searchParams.set("page", id);
    window.history.pushState({ page: id }, "", u);
  }
  var c = document.getElementById("pageContent");
  if (!c) return;
  // destroy old charts
  Object.keys(charts).forEach(function (k) { try { charts[k].destroy(); } catch (e) {} delete charts[k]; });
  var html = renderPage(id);
  c.innerHTML = html;
  if (window.lucide) lucide.createIcons();
  if (id === "stats") initStatsCharts();
  if (id === "networth") initNetWorthChart();
  if (id === "scenarios") { initScenarioChart(); updateScenario(); }
  if (id === "account") loadAccountInfo();
  if (id === "api") loadTokens();
  if (id === "pennywise" && !M._pennywiseLoaded) loadPennyWiseSummary();
  if (id === "wealth" && window.WealthRouter) window.WealthRouter.load();
  if (id === "imports") setTimeout(loadImportsPage,0);
  if (id === "reconcile") setTimeout(loadReconcilePage,0);
  // update sidebar/mobile active
  document.querySelectorAll("[data-page]").forEach(function (el) {
    el.classList.toggle("active", el.getAttribute("data-page") === id);
  });
  // close mobile "more" overlay if open
  var ov = document.getElementById("mobile-more-overlay");
  if (ov) ov.classList.add("hidden");
  window.scrollTo(0, 0);
}

// Intercept sidebar / mobile-nav links for in-place SPA navigation
document.addEventListener("click", function (e) {
  var a = e.target.closest("a[data-page]");
  if (!a) return;
  var id = a.getAttribute("data-page");
  if (!id || !renderPage(id)) return;
  e.preventDefault();
  navigate(id, true);
});
window.addEventListener("popstate", function (e) {
  var id = (e.state && e.state.page) || pageFromUrl();
  navigate(id, false);
});

function renderPage(id) {
  switch (id) {
    case "dashboard": return renderDashboard();
    case "ledger": return renderLedger();
    case "stats": return renderStats();
    case "categories": return renderCategories();
    case "budgets": return renderBudgets();
    case "income": return renderIncome();
    case "cicilan": return renderCicilan();
    case "liabilities": return renderLiabilities();
    case "recurring": return renderRecurring();
    case "networth": return renderNetWorth();
    case "scenarios": return renderScenarios();
    case "creditcard": return renderCreditCard();
    case "assets": return renderAssets();
    case "wallets": return renderWallets();
    case "goals": return renderGoals();
    case "account": return renderAccount();
    case "api": return renderAPI();
    case "pennywise": return renderPennyWise();
    case "wealth": return window.renderWealthApp ? window.renderWealthApp() : "<p>Loading wealth…</p>";
    case "imports": return renderImports();
    case "reconcile": return renderReconcile();
    case "wealth-import": return window.renderWealthImport ? window.renderWealthImport() : "<p>Loading wealth import…</p>";
    default: return "<p>Page not found.</p>";
  }
}


function renderImports() {
  return '<div class="space-y-4 imports-page">' +
    '<div><h1 class="text-2xl font-bold">Imports</h1><p class="text-sm text-[var(--c-sub)]">Upload, map, preview, reconcile, commit, and roll back reviewed statement CSV imports.</p></div>' +
    '<div class="grid md:grid-cols-6 grid-cols-2 gap-2">' + ['Upload','Mapping','Preview','Reconciliation','History','Templates'].map(function(t){return '<span class="badge">'+t+'</span>';}).join('') + '</div>' +
    '<div class="card p-4 space-y-3"><h2 class="font-semibold">Upload CSV</h2>' +
      '<div class="grid md:grid-cols-3 gap-3"><select id="importType" class="select select-bordered"><option value="bank_statement">Bank statement</option><option value="credit_card_statement">Credit card</option><option value="loan_statement">Loan statement</option><option value="mutual_fund_statement">Mutual fund</option><option value="epf_statement">EPF</option><option value="nps_statement">NPS</option><option value="generic_ledger">Generic CSV</option></select><input id="importInstitution" class="input input-bordered" placeholder="Institution"><input id="importFile" type="file" accept=".csv,text/csv" class="file-input file-input-bordered"></div>' +
      '<button class="btn btn-primary" onclick="uploadStatementImport()">Upload for review</button><div id="importUploadResult" class="text-sm"></div></div>' +
    '<div class="grid lg:grid-cols-2 gap-4"><div class="card p-4"><h2 class="font-semibold mb-2">History</h2><div id="importHistory">Loading…</div></div><div class="card p-4"><h2 class="font-semibold mb-2">Templates</h2><div id="importTemplates">Loading…</div></div></div>' +
    '<div class="card p-4"><h2 class="font-semibold mb-2">Mobile-first safeguards</h2><p class="text-sm text-[var(--c-sub)]">Rows are reviewed as stacked cards on small screens; duplicate and low-confidence matches require explicit user decisions before commit.</p></div>' +
  '</div>';
}
async function loadImportsPage(){
  if(currentPage!=="imports") return;
  try{
    var h=await api('/api/imports');
    var el=document.getElementById('importHistory');
    if(el) el.innerHTML=(h.batches||[]).map(function(b){return '<div class="p-2 border-b border-[var(--c-border)]"><b>'+b.source_filename+'</b><div class="text-xs text-[var(--c-sub)]">'+b.import_type+' • '+b.status+' • created '+(b.committed_count||0)+' • dup '+(b.duplicate_count||0)+' • errors '+(b.error_count||0)+'</div></div>';}).join('') || '<p class="text-sm text-[var(--c-sub)]">No imports yet.</p>';
    var t=await api('/api/import-templates');
    var te=document.getElementById('importTemplates');
    if(te) te.innerHTML=(t.templates||[]).slice(0,8).map(function(x){return '<div class="p-2 border-b border-[var(--c-border)]"><b>'+x.name+'</b><div class="text-xs text-[var(--c-sub)]">'+x.import_type+' • '+(x.institution||'Generic')+'</div></div>';}).join('');
  }catch(e){ var el=document.getElementById('importHistory'); if(el) el.textContent=e.message; }
}
async function uploadStatementImport(){
  var f=document.getElementById('importFile').files[0]; if(!f) return toast('Choose a CSV file');
  var fd=new FormData(); fd.append('file',f); fd.append('import_type',document.getElementById('importType').value); fd.append('source_institution',document.getElementById('importInstitution').value||'');
  var res=await fetch('/api/imports/upload',{method:'POST',credentials:'include',body:fd}); var data=await res.json();
  document.getElementById('importUploadResult').textContent=res.ok ? ('Batch '+data.batch_id+' uploaded. Suggested mapping: '+JSON.stringify(data.suggested_mapping)) : (data.error||'Upload failed');
  loadImportsPage();
}

// ── modal ────────────────────────────────────────────────────────
function openModal(title, bodyHTML) {
  closeModal();
  var mask = document.createElement("div");
  mask.className = "modal-mask";
  mask.innerHTML =
    '<div class="modal-content">' +
      '<div class="flex items-center justify-between mb-4">' +
        '<h2 class="text-lg font-bold" style="color: var(--c-primary);">' + title + "</h2>" +
        '<button onclick="closeModal()" style="background:none;border:none;cursor:pointer;color:var(--c-sub);font-size:22px;line-height:1;">&times;</button>' +
      "</div>" + bodyHTML +
    "</div>";
  mask.addEventListener("click", function (e) { if (e.target === mask) closeModal(); });
  document.body.appendChild(mask);
}
function closeModal() {
  document.querySelectorAll(".modal-mask").forEach(function (m) { m.remove(); });
}
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

// reload helper after a mutation
async function reload(toPage) {
  try { await loadAll(); } catch (e) { return; }
  navigate(toPage || currentPage);
}

async function toast(msg, isErr) {
  var d = document.createElement("div");
  d.textContent = msg;
  d.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:" +
    (isErr ? "#C44B4B" : "#355872") + ";color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:200;box-shadow:0 4px 12px rgba(0,0,0,.15);";
  document.body.appendChild(d);
  setTimeout(function () { d.remove(); }, 2600);
}

/* =================================================================
   PAGE RENDERERS (ported from mockup)
   ================================================================= */


function renderIncome() {
  var s = M.incomeSummary || {}, f = M.incomeForecast || {}, sources = M.incomeSources || [], cal = (M.expectedCalendar && M.expectedCalendar.items) || [];
  function money(v){ return v == null ? '—' : 'Rp' + fmt(v); }
  function card(label,value,extra){ return '<div class="card p-4"><div class="text-[10px] uppercase tracking-wide" style="color:var(--c-sub);">'+label+'</div><div class="text-xl font-bold mono" style="color:var(--c-primary);">'+value+'</div>'+(extra?'<div class="text-xs mt-1" style="color:var(--c-sub);">'+extra+'</div>':'')+'</div>'; }
  var srcRows = sources.map(function(x){ return '<div class="card-row"><div class="min-w-0"><div class="font-semibold truncate">'+esc(x.name)+'</div><div class="text-xs" style="color:var(--c-sub);">'+esc(x.income_type)+' · '+esc(x.frequency)+' · '+(x.active?'active':'archived')+'</div></div><div class="mono text-sm">'+money(x.expected_net_credit||x.expected_amount||x.base_estimate)+'</div></div>'; }).join('') || '<div class="card p-4 text-sm" style="color:var(--c-sub);">No income sources yet. Add one through the Income API.</div>';
  var calRows = cal.map(function(x){ return '<div class="card-row"><div><b>'+esc(x.title)+'</b><div class="text-xs" style="color:var(--c-sub);">'+esc(x.date)+' · '+esc(x.status)+' · '+esc(x.confidence)+'</div></div><div class="mono text-sm text-[#4A8C6F]">+'+money(x.amount)+'</div></div>'; }).join('') || '<div class="card p-4 text-sm" style="color:var(--c-sub);">No expected credits in the selected horizon.</div>';
  return '<h1 class="text-2xl font-bold" style="color:var(--c-primary);">Income</h1><p class="page-subtitle">Expected versus actual income, salary tracking, reconciliation, forecasts, and trends.</p>'+ 
    '<div class="flex gap-2 overflow-x-auto pb-2 mb-3"><span class="btn btn-sm">Overview</span><span class="btn btn-sm">Sources</span><span class="btn btn-sm">Expected</span><span class="btn btn-sm">Received</span><span class="btn btn-sm">Reconciliation</span><span class="btn btn-sm">Forecast</span><span class="btn btn-sm">Trends</span></div>'+ 
    '<section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">'+card('Actual income',money(s.actual_income))+card('Expected income',money(s.expected_income))+card('Variance',money(s.income_variance))+card('Next expected credit',s.next_expected_credit?esc(s.next_expected_credit.expected_date):'—')+card('Expected salary',money(s.expected_salary))+card('Overdue expected',money(s.overdue_expected_income))+card('Projected month end',money(s.projected_month_end_income))+card('Sources',fmt(s.income_source_count||0))+'</section>'+ 
    '<section class="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4"><div><h2 class="section-title">Income by source</h2>'+srcRows+'</div><div><h2 class="section-title">Upcoming credits</h2>'+calRows+'</div></section>'+ 
    '<section class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">'+card('Conservative forecast',money(f.scenario==='conservative'?f.expected_income:s.expected_income))+card('Base forecast',money(s.expected_income))+card('Optimistic forecast',money(f.scenario==='optimistic'?f.expected_income:s.expected_income))+'</section>'+ 
    '<section class="card p-4 text-sm" style="color:var(--c-sub);">Backend-only calculations classify reimbursements, refunds, loan proceeds, transfers, and investment redemptions out of ordinary income. Matching links existing Ledger credits and never creates duplicate movements.</section>';
}

function renderDashboard() {
  var fo = M.financialOverview;
  if (!fo) return '<h1 class="text-2xl font-bold" style="color:var(--c-primary);">Home</h1><div class="card p-4">Dashboard data is loading.</div>';
  var nw = fo.net_worth || {}, cf = fo.cash_flow || {}, we = fo.wealth || {}, li = fo.liabilities || {}, go = fo.goals || {}, bu = fo.budgets || {}, al = fo.alerts || {}, im = fo.imports || {}, pw = fo.pennywise || {}, hh = fo.health || {};
  function money(v){ return v == null ? '—' : (v < 0 ? '−Rp' + fmt(Math.abs(v)) : 'Rp' + fmt(v)); }
  function smallMetric(label, value, extra){ return '<div class="card p-3 min-w-0"><div class="text-[10px] uppercase tracking-wide" style="color:var(--c-sub);">'+label+'</div><div class="text-base font-bold mono break-words" style="color:var(--c-ink);">'+value+'</div>'+(extra?'<div class="text-[11px] mt-1" style="color:var(--c-sub);">'+extra+'</div>':'')+'</div>'; }
  function action(label,path,icon){ return '<a class="btn btn-sm min-h-[44px] h-auto justify-start" href="'+path+'" data-page="'+((path.match(/page=([^&]+)/)||[])[1]||'dashboard')+'"><i data-lucide="'+icon+'" class="w-4 h-4"></i> '+label+'</a>'; }
  function statusPill(s){ var c=s==='good'?'var(--c-success)':s==='attention'?'var(--c-danger)':s==='watch'?'var(--c-warning)':'var(--c-sub)'; return '<span class="text-[10px] px-2 py-1 rounded-full" style="background:rgba(53,88,114,.06);color:'+c+';">'+esc(s||'unavailable')+'</span>'; }
  var trend = (nw.trend||[]).slice(-6); var max = Math.max.apply(null, trend.map(function(t){return Math.abs(t.net_worth||0);}).concat([1]));
  var bars = trend.map(function(t){ var h=Math.max(8, Math.round(Math.abs(t.net_worth||0)/max*42)); return '<div class="flex flex-col items-center gap-1" aria-label="'+esc(t.month)+' net worth '+money(t.net_worth)+'"><div style="height:'+h+'px;width:12px;border-radius:6px;background:'+(t.net_worth>=0?'var(--c-success)':'var(--c-danger)')+';"></div><span class="text-[9px]" style="color:var(--c-sub);">'+esc((t.month||'').slice(5))+'</span></div>'; }).join('');
  var attention = (al.initial_items||[]).slice(0,5).map(function(a){ return '<div class="card-row items-start"><span class="text-[10px] px-2 py-1 rounded-full flex-shrink-0" style="background:rgba(196,75,75,.08);color:var(--c-danger);">'+esc(a.severity)+'</span><div class="min-w-0 flex-1"><div class="text-sm font-semibold">'+esc(a.title)+'</div><div class="text-xs truncate" style="color:var(--c-sub);">'+esc(a.explanation)+'</div></div><a class="btn btn-xs min-h-[36px]" href="'+esc(a.destination_path||'/')+'" data-page="'+(((a.destination_path||'').match(/page=([^&]+)/)||[])[1]||'dashboard')+'">Open</a></div>'; }).join('') || '<div class="card p-4 text-sm" style="color:var(--c-sub);">No attention items right now.</div>';
  var upcoming = (fo.upcoming||[]).slice(0,5).map(function(u){ return '<div class="card-row"><div class="min-w-0 flex-1"><div class="text-sm font-medium truncate">'+esc(u.title||u.type)+'</div><div class="text-xs" style="color:var(--c-sub);">'+esc(u.type)+' · '+esc(u.date)+'</div></div><div class="mono text-xs">'+money(u.amount)+'</div></div>'; }).join('') || '<div class="card p-4 text-sm" style="color:var(--c-sub);">No dated items in the next 30 days.</div>';
  var activity = (fo.recent_activity||[]).slice(0,8).map(function(a){ return '<div class="card-row"><div class="min-w-0 flex-1"><div class="text-sm font-medium truncate">'+esc(a.title||a.source_type)+'</div><div class="text-xs" style="color:var(--c-sub);">'+esc(a.source_type)+' · '+esc(a.date_time)+' · '+esc(a.status||'')+'</div></div><div class="mono text-xs">'+money(a.amount)+'</div></div>'; }).join('') || '<div class="card p-4 text-sm" style="color:var(--c-sub);">No recent activity.</div>';
  var healthCards = Object.keys(hh).map(function(k){ var h=hh[k]||{}; return '<div class="card p-3"><div class="flex items-center justify-between gap-2"><div class="text-xs font-semibold">'+esc(k.replace(/_/g,' '))+'</div>'+statusPill(h.status)+'</div><p class="text-[11px] mt-1" style="color:var(--c-sub);">'+esc(h.explanation||'')+'</p></div>'; }).join('');
  return '<h1 class="text-2xl font-bold" style="color:var(--c-primary);">Home</h1><p class="page-subtitle">Unified financial command center</p>'+
    '<section class="card p-4 mb-4" aria-labelledby="dashHero"><div class="flex items-start justify-between gap-3"><div><h2 id="dashHero" class="text-[10px] uppercase tracking-wide" style="color:var(--c-sub);">Net Worth</h2><div class="text-2xl font-bold mono" style="color:var(--c-primary);">'+money(nw.current_live_net_worth)+'</div><div class="text-xs mt-1" style="color:var(--c-sub);">Live value · latest snapshot '+esc(nw.latest_snapshot_month||'unavailable')+' · '+esc(nw.valuation_status||'unknown')+'</div></div><a class="btn btn-sm min-h-[44px]" href="/?page=networth" data-page="networth">View Net Worth</a></div><div class="flex items-end gap-2 mt-3" role="img" aria-label="Compact net-worth trend">'+(bars||'<span class="text-xs" style="color:var(--c-sub);">No snapshot trend yet</span>')+'</div><div class="grid grid-cols-2 gap-2 mt-3">'+smallMetric('Monthly change', money(nw.month_on_month_change), nw.month_on_month_percentage==null?'No comparison':pct(nw.month_on_month_percentage/100))+smallMetric('YTD change', money(nw.year_to_date_change), nw.year_to_date_percentage==null?'No comparison':pct(nw.year_to_date_percentage/100))+'</div></section>'+
    '<section class="mb-4"><div class="flex items-center justify-between mb-2"><h2 class="section-title" style="margin:0;">This Month</h2><a class="btn btn-sm min-h-[44px]" href="/?page=budgets" data-page="budgets">View Budget / Cash Flow</a></div><div class="grid grid-cols-2 md:grid-cols-4 gap-2">'+smallMetric('Income', money(cf.income))+smallMetric('Expenses', money(cf.ordinary_expenses))+smallMetric('Savings rate', cf.savings_rate==null?'—':pct(cf.savings_rate))+smallMetric('Budget remaining', money(bu.remaining_budget))+smallMetric('Projected result', money(cf.projected_month_end_result))+smallMetric('Investments', money(cf.investment_contributions))+smallMetric('Debt payments', money(cf.debt_payments))+smallMetric('Top category', cf.top_spending_category?esc(cf.top_spending_category.name):'—')+'</div></section>'+
    '<section class="mb-4"><div class="flex items-center justify-between mb-2"><h2 class="section-title" style="margin:0;">Income</h2><a class="btn btn-sm min-h-[44px]" href="/?page=income" data-page="income">Open Income</a></div><div class="grid grid-cols-2 md:grid-cols-4 gap-2">'+smallMetric('Actual income', money((M.incomeSummary||{}).actual_income))+smallMetric('Expected income', money((M.incomeSummary||{}).expected_income))+smallMetric('Variance', money((M.incomeSummary||{}).income_variance))+smallMetric('Next credit', ((M.incomeSummary||{}).next_expected_credit||{}).expected_date||'—')+'</div></section>'+
    '<section class="mb-4"><div class="flex items-center justify-between mb-2"><h2 class="section-title" style="margin:0;">Needs Attention</h2><a class="btn btn-sm min-h-[44px]" href="/?page=budgets&budgetTab=alerts" data-page="budgets">View all alerts</a></div>'+attention+'</section>'+
    '<section class="mb-4"><h2 class="section-title">Quick Actions</h2><div class="grid grid-cols-2 md:grid-cols-4 gap-2">'+action('Add transaction','/?page=ledger','plus')+action('Review PennyWise','/?page=pennywise','message-square')+action('Add valuation','/?page=wealth','line-chart')+action('Add liability payment','/?page=liabilities','landmark')+action('Add goal contribution','/?page=goals','target')+action('Import statement','/?page=imports','upload')+action('Generate snapshot','/?page=networth','camera')+'</div></section>'+
    '<section class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">'+smallMetric('Wealth', money(we.current_investment_value), 'Gain/loss '+money(we.total_gain_loss)+' · XIRR '+(we.xirr==null?'—':pct(we.xirr)))+smallMetric('Liabilities', money(li.total_outstanding), 'Monthly EMI '+money(li.monthly_emi_commitment)+' · overdue '+money(li.overdue_amount))+smallMetric('Goals', fmt(go.active_goals||0)+' active', (go.goals_behind||0)+' behind · monthly '+money(go.monthly_contribution_required))+smallMetric('Budget', bu.used_percentage==null?'—':pct(bu.used_percentage/100), 'Remaining '+money(bu.remaining_budget)+' · alerts '+((bu.exceeded_categories||[]).length+(bu.approaching_limit_categories||[]).length))+'</section>'+
    '<section class="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4"><div><h2 class="section-title">Upcoming</h2>'+upcoming+'</div><div><h2 class="section-title">Recent Activity</h2>'+activity+'</div></section>'+
    '<section class="mb-4"><h2 class="section-title">Data Health</h2><div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">'+healthCards+'</div><div class="card p-3 mt-2 text-xs" style="color:var(--c-sub);">Imports unresolved: '+fmt(im.unresolved_rows||0)+' · PennyWise failed: '+fmt(pw.failed_sync_count||0)+' · Partial sections: '+(fo.meta&&fo.meta.partial?'yes':'no')+'</div></section>';
}

function ledgerRowHTML(t) {
  var isIncome = t.type === "income";
  var amt = (isIncome ? "+" : "−") + " Rp" + fmt(t.amount);
  var amtColor = isIncome ? "text-[#4A8C6F]" : "text-[#C44B4B]";
  // Desktop: flat single-line row
  var desktop =
    '<div class="card-row ledger-row hidden md:flex">' +
      '<span class="mono text-[11px] flex-shrink-0" style="color:var(--c-sub);width:68px;">' + (t.date || "") + "</span>" +
      '<span class="text-[11px] font-medium flex-shrink-0" style="width:60px;">' + esc(t.cat || "?") + "</span>" +
      '<span class="text-[11px] flex-1 truncate" style="color:var(--c-sub);min-width:0;">' + esc(t.desc || "") + (t.source === "pennywise_sms" ? ' <span class="px-1.5 py-0.5 rounded-full" style="background:rgba(122,170,206,.16);color:var(--c-primary);">PennyWise SMS</span>' : '') + (t.reference_number ? ' <span class="mono">' + esc(t.reference_number) + '</span>' : '') + "</span>" +
      '<span class="text-[10px] flex-shrink-0 hidden sm:inline" style="color:var(--c-sub);width:48px;">' + esc(t.method || "") + "</span>" +
      '<span class="mono text-[11px] text-right flex-shrink-0 font-medium ' + amtColor + '" style="width:105px;">' + amt + "</span>" +
      '<span class="hidden md:flex gap-1 flex-shrink-0">' +
        '<button class="p-1" style="color:var(--c-sub);" onclick="editTransaction(' + t.id + ')"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>' +
        '<button class="p-1" style="color:var(--c-sub);" onclick="deleteTransaction(' + t.id + ')"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>' +
      "</span>" +
    "</div>";
  // Mobile: 2-line stacked row
  var mobile =
    '<div class="card-row ledger-row flex md:hidden flex-col items-stretch gap-1">' +
      '<div class="flex items-start justify-between gap-2 min-w-0">' +
        '<span class="text-sm font-medium min-w-0 truncate" style="color:var(--c-ink);">' + esc(t.desc || (t.cat || "")) + "</span>" +
        '<span class="mono text-sm font-semibold flex-shrink-0 ' + amtColor + '">' + amt + "</span>" +
      "</div>" +
      '<div class="flex items-center gap-1.5 text-[11px] min-w-0" style="color:var(--c-sub);">' +
        "<span>" + esc(t.cat || "?") + "</span>" +
        (t.method ? '<span>·</span><span>' + esc(t.method) + "</span>" : "") +
        (t.source === "pennywise_sms" ? '<span>·</span><span style="color:var(--c-primary);">PennyWise SMS</span>' : "") +
        "<span>·</span><span class='mono'>" + (t.date || "") + "</span>" +
        '<button class="ml-auto p-1 flex-shrink-0" style="color:var(--c-sub);" onclick="toggleLedgerDropdown(this)"><i data-lucide="ellipsis-vertical" class="w-4 h-4"></i></button>' +
      "</div>" +
      '<div class="ledger-dropdown" style="display:none;position:absolute;right:4px;top:38px;background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--radius);box-shadow:0 4px 12px rgba(53,88,114,0.10);z-index:30;padding:4px;min-width:120px;">' +
        '<button class="flex items-center gap-2 w-full px-3 py-2 rounded text-xs hover:bg-[rgba(53,88,114,0.05)]" style="color:var(--c-ink);" onclick="editTransaction(' + t.id + ')"><i data-lucide="pencil" class="w-3.5 h-3.5"></i> Edit</button>' +
        '<button class="flex items-center gap-2 w-full px-3 py-2 rounded text-xs hover:bg-[rgba(196,75,75,0.05)]" style="color:var(--c-danger);" onclick="deleteTransaction(' + t.id + ')"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Delete</button>' +
      "</div>" +
    "</div>";
  return desktop + mobile;
}

function renderLedger() {
  var rows = M.txns.map(ledgerRowHTML).join("");
  var cats = M.expenseCats.concat(M.incomeCats);
  var catOpts = cats.map(function (c) { return "<option>" + esc(c) + "</option>"; }).join("");

  return (
    '<h1 class="text-2xl font-bold" style="color: var(--c-primary);">Ledger</h1>' +
    '<p class="page-subtitle">View and manage all your financial transactions</p>' +
    '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">' +
      '<div class="flex flex-col sm:flex-row flex-wrap gap-2 flex-1">' +
        '<input id="ledSearch" placeholder="Search notes..." class="input input-sm bg-white text-sm w-full sm:flex-1 sm:min-w-[150px] sm:max-w-xs" style="border-color: var(--c-focus);" oninput="filterLedger()">' +
        '<div class="flex gap-2">' +
          '<select id="ledCat" class="select select-sm bg-white text-sm flex-1" style="border-color: var(--c-focus);" onchange="filterLedger()"><option value="">All Categories</option>' + catOpts + "</select>" +
          '<select id="ledType" class="select select-sm bg-white text-sm flex-1" style="border-color: var(--c-focus);" onchange="filterLedger()"><option value="">All</option><option>Income</option><option>Expense</option></select>' +
        "</div>" +
      "</div>" +
      '<button class="btn-primary px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-1.5 flex-shrink-0" onclick="showAddTransaction()"><i data-lucide="plus" class="w-4 h-4"></i> Add</button>' +
    "</div>" +
    '<div id="ledgerRows">' + (rows || '<div class="card-row"><span class="text-xs" style="color:var(--c-sub);">No transactions</span></div>') + "</div>"
  );
}

function filterLedger() {
  var q = (document.getElementById("ledSearch").value || "").toLowerCase();
  var cat = document.getElementById("ledCat").value;
  var type = document.getElementById("ledType").value.toLowerCase();
  var rows = M.txns.filter(function (t) {
    if (q && (t.desc || "").toLowerCase().indexOf(q) < 0) return false;
    if (cat && t.cat !== cat) return false;
    if (type && t.type !== type) return false;
    return true;
  });
  var html = rows.map(ledgerRowHTML).join("");
  document.getElementById("ledgerRows").innerHTML = html || '<div class="card-row"><span class="text-xs" style="color:var(--c-sub);">No transactions</span></div>';
  if (window.lucide) lucide.createIcons();
}

function toggleLedgerDropdown(btn) {
  document.querySelectorAll(".ledger-dropdown").forEach(function (d) { if (d !== btn.parentElement.querySelector(".ledger-dropdown")) d.style.display = "none"; });
  var dd = btn.parentElement.querySelector(".ledger-dropdown");
  dd.style.display = dd.style.display === "none" ? "block" : "none";
}

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }

/* ── STATISTICS ── */
function renderStats() {
  return '<h1 class="text-2xl font-bold" style="color: var(--c-primary);">Statistics</h1>' +
    '<p class="page-subtitle">Visualize income, expenses, and spending patterns</p>' +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-5">' +
      '<div class="card p-5"><div class="section-title">Income vs Expense</div><div style="height:260px"><canvas id="chartIncomeExpense"></canvas></div></div>' +
      '<div class="card p-5"><div class="section-title">Spending by Category</div><div style="height:260px"><canvas id="chartPie"></canvas></div></div>' +
    "</div>";
}
function initStatsCharts() {
  var ctx1 = document.getElementById("chartIncomeExpense");
  if (ctx1 && window.Chart) {
    charts.bar = new Chart(ctx1.getContext("2d"), {
      type: "bar",
      data: { labels: ["This Month"], datasets: [
        { label: "Income", data: [M.income], backgroundColor: "#4A8C6F", borderRadius: 4 },
        { label: "Expense", data: [M.expense], backgroundColor: "#C44B4B", borderRadius: 4 },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#6B7D8E", font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: "#6B7D8E", font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: "#6B7D8E", font: { size: 10 }, callback: function (v) { return (v / 1e6).toFixed(1) + "M"; } }, grid: { color: "rgba(53,88,114,0.06)" } },
        },
      },
    });
  }
  // spend by category (this-month expenses)
  var byCat = {};
  M.txns.filter(function (t) { return t.type === "expense"; }).forEach(function (t) {
    byCat[t.cat || "Other"] = (byCat[t.cat || "Other"] || 0) + t.amount;
  });
  var entries = Object.keys(byCat).map(function (k) { return { cat: k, amt: byCat[k] }; }).sort(function (a, b) { return b.amt - a.amt; });
  var ctx2 = document.getElementById("chartPie");
  if (ctx2 && window.Chart) {
    charts.pie = new Chart(ctx2.getContext("2d"), {
      type: "doughnut",
      data: { labels: entries.map(function (d) { return d.cat; }), datasets: [{ data: entries.map(function (d) { return d.amt; }), backgroundColor: ["#7AAACE", "#355872", "#4A8C6F", "#9CD5FF", "#D4A24E", "#6B7D8E", "#C44B4B"] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { color: "#6B7D8E", font: { size: 10 }, padding: 12 } } } },
    });
  }
}

/* ── CATEGORIES ── */
function renderCategories() {
  function row(name, id) {
    return '<div class="flex items-center justify-between py-2.5 px-2 rounded-lg hover:bg-[#F7F8F0] text-sm"><span>' + esc(name) + '</span><button class="p-1" style="color:var(--c-sub);" onclick="deleteCategory(' + id + ')"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></div>';
  }
  return '<h1 class="text-2xl font-bold" style="color: var(--c-primary);">Categories</h1>' +
    '<p class="page-subtitle">Manage your income and expense categories</p>' +
    '<div class="flex justify-end mb-4"><button class="btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-1.5" onclick="showAddCategory()"><i data-lucide="plus" class="w-4 h-4"></i> Add Category</button></div>' +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-5">' +
      '<div class="card p-5"><div class="section-title">Expense Categories</div>' + (M.expenseCats.length ? M.expenseCats.map(function (n, i) { return row(n, catIdByName(n)); }).join("") : '<div class="text-xs" style="color:var(--c-sub);">None</div>') + "</div>" +
      '<div class="card p-5"><div class="section-title">Income Categories</div>' + (M.incomeCats.length ? M.incomeCats.map(function (n) { return row(n, catIdByName(n)); }).join("") : '<div class="text-xs" style="color:var(--c-sub);">None</div>') + "</div>" +
    "</div>";
}
function catIdByName(name) { return CATMAP[name]; }

/* ── BUDGETS ── */
function renderBudgets() {
  var tab = new URLSearchParams(window.location.search).get("budgetTab") || "overview";
  var tabs = [["overview","Overview"],["categories","Category Budgets"],["cashflow","Cash Flow"],["recurring","Recurring"],["alerts","Alerts"],["trends","Trends"]].map(function(t){return '<a class="btn btn-sm '+(tab===t[0]?'btn-primary':'')+'" href="/?page=budgets&budgetTab='+t[0]+'" data-page="budgets" onclick="event.preventDefault(); var u=new URL(location.href); u.searchParams.set(\'page\',\'budgets\'); u.searchParams.set(\'budgetTab\',\''+t[0]+'\'); history.pushState({page:\'budgets\'},\'\',u); navigate(\'budgets\',false);">'+t[1]+'</a>';}).join('');
  var cf = M.cashFlow || {}; var totalRemaining = M.budgets.reduce(function(s,b){return s+(b.remaining||0);},0); var topAlert = (M.cashFlowAlerts||[])[0];
  var cards = '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">' +
    '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Monthly income</div><div class="font-bold mono">Rp'+fmt(cf.total_income)+'</div></div>'+
    '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Monthly expenses</div><div class="font-bold mono">Rp'+fmt(cf.total_expenses)+'</div></div>'+
    '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Savings rate</div><div class="font-bold mono">'+(cf.savings_rate==null?'—':pct(cf.savings_rate))+'</div></div>'+
    '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Budget remaining</div><div class="font-bold mono">Rp'+fmt(totalRemaining)+'</div></div>'+
    '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Projected result</div><div class="font-bold mono">Rp'+fmt(cf.projected_month_end_surplus_or_deficit)+'</div></div>'+
    '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Investment contributions</div><div class="font-bold mono">Rp'+fmt(cf.investment_contributions)+'</div></div>'+
    '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Debt payments</div><div class="font-bold mono">Rp'+fmt(cf.debt_payments)+'</div></div>'+
    '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Safe to spend/day</div><div class="font-bold mono">Rp'+fmt(M.budgets.reduce(function(s,b){return s+(b.safe||0);},0))+'</div></div></div>';
  var budgetRows = M.budgets.map(function (b) { var rem = b.remaining ?? (b.budget-b.actual); var pctUsed = b.budget > 0 ? Math.min((b.actual / b.budget) * 100, 100) : 0; return '<tr><td class="p-2">'+esc(b.cat||'Total')+'</td><td class="p-2 text-right mono">Rp'+fmt(b.budget)+'</td><td class="p-2 text-right mono">Rp'+fmt(b.actual)+'</td><td class="p-2 text-right mono">Rp'+fmt(rem)+'</td><td class="p-2"><div style="min-width:120px;height:8px;background:var(--c-bg);border-radius:4px"><div style="height:8px;width:'+pctUsed+'%;background:var(--c-focus);border-radius:4px"></div></div></td><td class="p-2">'+esc(b.status||'')+'</td><td class="p-2 text-right"><button class="btn btn-xs" onclick="deleteBudget('+b.id+')">Archive</button></td></tr>'; }).join('');
  var catRows = (M.cashFlowCategories||[]).map(function(c){return '<tr><td class="p-2">'+esc(c.category_name)+'</td><td class="p-2 text-right mono">Rp'+fmt(c.current_month_spending)+'</td><td class="p-2 text-right mono">Rp'+fmt(c.previous_month_spending)+'</td><td class="p-2 text-right mono">'+(c.change_percentage==null?'—':pct(c.change_percentage))+'</td><td class="p-2 text-right mono">Rp'+fmt(c.three_month_average)+'</td><td class="p-2 text-right mono">'+(c.budget_used_percentage==null?'—':pct(c.budget_used_percentage))+'</td></tr>';}).join('');
  var alerts = (M.cashFlowAlerts||[]).map(function(a){return '<div class="card p-3 mb-2"><div class="flex justify-between gap-2"><b>'+esc(a.title)+'</b><span class="badge">'+esc(a.severity)+'</span></div><p class="text-xs mt-1" style="color:var(--c-sub)">'+esc(a.explanation)+'</p></div>';}).join('') || '<div class="card p-3 text-xs">No alerts.</div>';
  var rec = (M.recurringCandidates||[]).map(function(r){return '<tr><td class="p-2">'+esc(r.merchant)+'</td><td class="p-2">'+esc(r.frequency)+'</td><td class="p-2 text-right mono">Rp'+fmt(r.typical_amount)+'</td><td class="p-2">'+esc(r.next_expected_date)+'</td><td class="p-2 text-right">'+Math.round((r.confidence||0)*100)+'%</td></tr>';}).join('');
  var body = tab==='categories' ? '<div class="flex justify-end mb-2"><button class="btn-primary px-3 py-2 rounded-lg text-xs" onclick="showSetBudget()">Add budget</button></div><div style="overflow-x:auto"><table class="w-full text-xs" style="min-width:720px"><thead><tr><th class="p-2 text-left">Category</th><th class="p-2 text-right">Budget</th><th class="p-2 text-right">Actual</th><th class="p-2 text-right">Remaining</th><th class="p-2">Progress</th><th class="p-2">Status</th><th></th></tr></thead><tbody>'+ (budgetRows||'<tr><td class="p-3" colspan="7">No budgets.</td></tr>') +'</tbody></table></div>' :
    tab==='cashflow' ? cards + '<div class="card p-4"><div class="section-title">Category breakdown</div><div style="overflow-x:auto"><table class="w-full text-xs" style="min-width:700px"><tbody>'+catRows+'</tbody></table></div></div>' :
    tab==='recurring' ? '<div class="card p-4"><div class="section-title">Detected candidates require confirmation before becoming recurring items</div><div style="overflow-x:auto"><table class="w-full text-xs" style="min-width:560px"><tbody>'+ (rec||'<tr><td class="p-3">No candidates.</td></tr>') +'</tbody></table></div></div>' :
    tab==='alerts' ? alerts :
    tab==='trends' ? '<div class="card p-4"><div class="section-title">Trends</div><p class="text-xs" style="color:var(--c-sub)">Monthly trend data is served by /api/cash-flow/trends. Use the Cash Flow and Category tabs for the mobile-readable summaries.</p></div>' :
    cards + (topAlert ? '<div class="card p-3 mb-4 text-xs" style="background:rgba(212,162,78,.10)"><b>'+esc(topAlert.title)+':</b> '+esc(topAlert.explanation)+'</div>' : '') + '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4"><div class="card p-4"><div class="section-title">Budget progress</div><div style="overflow-x:auto"><table class="w-full text-xs" style="min-width:620px"><tbody>'+budgetRows+'</tbody></table></div></div><div class="card p-4"><div class="section-title">Top spending categories</div><div style="overflow-x:auto"><table class="w-full text-xs" style="min-width:520px"><tbody>'+catRows+'</tbody></table></div></div></div>';
  return '<h1 class="text-2xl font-bold" style="color: var(--c-primary);">Budget</h1><p class="page-subtitle">Monthly budgets, cash flow, recurring spend, trends, and explainable alerts.</p><div class="flex gap-2 mb-4 overflow-x-auto pb-1">'+tabs+'</div>'+body;
}
function curMonthLabel() {
  var d = new Date(); var m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return m[d.getMonth()] + " " + d.getFullYear();
}

/* ── CICILAN ── */
function cicilanSchedule(c) {
  var rows = [];
  if (!c.monthly || c.monthly <= 0) return rows;
  var monthsLeft = Math.max(1, Math.ceil(c.sisa / c.monthly));
  var remaining = c.sisa;
  var monthlyRate = (c.bunga || 0) / 100 / 12;
  var monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var start = c.start ? new Date(c.start) : new Date();
  for (var m = 1; m <= monthsLeft; m++) {
    var interest = Math.round(remaining * monthlyRate);
    var principal = c.monthly - interest;
    if (m === monthsLeft) { principal = remaining; interest = Math.max(0, c.monthly - principal); }
    remaining -= principal;
    if (remaining < 0) remaining = 0;
    var d = new Date(start); d.setMonth(d.getMonth() + m);
    rows.push({ label: monthNames[d.getMonth()] + " " + d.getFullYear(), payment: c.monthly, principal: principal, interest: interest, remaining: remaining });
    if (remaining <= 0) break;
  }
  return rows;
}

function renderLiabilities() {
  var s = M.liabilitySummary || {};
  var rows = (M.liabilities || []).map(function (l) {
    var cc = l.liability_type === "credit_card";
    return '<div class="card p-4 mb-3">' +
      '<div class="flex items-start justify-between gap-3"><div><div class="font-semibold">' + esc(l.name) + '</div><div class="text-xs" style="color:var(--c-sub);">' + esc(l.institution || l.liability_type) + ' · ' + esc(l.due_status || 'no_due_date') + '</div></div><div class="text-right"><div class="mono font-bold">Rp' + fmt(l.current_outstanding) + '</div><div class="text-[10px]" style="color:var(--c-sub);">' + esc(l.auto_calculation_mode) + '</div></div></div>' +
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs"><div>EMI<br><span class="mono">Rp' + fmt(l.emi_amount || l.minimum_due) + '</span></div><div>Rate<br><span class="mono">' + (l.interest_rate || 0) + '%</span></div><div>Due<br><span class="mono">' + esc(l.next_due_date || l.due_date || '—') + '</span></div><div>' + (cc ? 'Utilization' : 'Progress') + '<br><span class="mono">' + (cc && l.utilization_percentage != null ? l.utilization_percentage.toFixed(1) + '%' : (l.original_principal ? ((l.original_principal - l.current_outstanding) / l.original_principal * 100).toFixed(1) + '%' : '—')) + '</span></div></div>' +
      '<div class="mt-3 flex flex-wrap gap-2"><button class="btn-secondary px-3 py-2 rounded-lg text-xs" onclick="showLiabilityPayment(' + l.id + ')">Record payment</button><button class="btn-secondary px-3 py-2 rounded-lg text-xs" onclick="showLiabilitySnapshot(' + l.id + ')">Add balance snapshot</button><button class="btn-secondary px-3 py-2 rounded-lg text-xs" onclick="showLiabilitySchedule(' + l.id + ')">Schedule</button></div></div>';
  }).join('');
  return '<h1 class="text-2xl font-bold" style="color: var(--c-primary);">Liabilities</h1><p class="page-subtitle">Loans, credit cards, EMI tracking, payments, and balance reconciliation.</p>' +
    '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5"><div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Total outstanding</div><div class="font-bold mono">Rp' + fmt(s.total_outstanding) + '</div></div><div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Monthly EMI</div><div class="font-bold mono">Rp' + fmt(s.monthly_emi_commitment) + '</div></div><div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Overdue</div><div class="font-bold mono">Rp' + fmt(s.overdue_amount) + '</div></div><div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Active</div><div class="font-bold mono">' + fmt(s.active_liability_count) + '</div></div></div>' +
    '<div class="flex justify-end mb-4"><button class="btn-primary px-4 py-3 rounded-lg text-sm" onclick="showAddLiability()">Add Liability</button></div>' +
    '<div class="flex gap-2 overflow-x-auto mb-4 text-xs"><span class="px-3 py-2 rounded-full card">Overview</span><span class="px-3 py-2 rounded-full card">Loans</span><span class="px-3 py-2 rounded-full card">Credit Cards</span><span class="px-3 py-2 rounded-full card">Payments</span><span class="px-3 py-2 rounded-full card">Schedule</span><span class="px-3 py-2 rounded-full card">Balance History</span></div>' +
    (rows || '<div class="card-row"><span class="text-xs" style="color:var(--c-sub);">No liabilities yet</span></div>');
}
function showAddLiability(){ openModal('Add Liability', '<div style="display:flex;flex-direction:column;gap:12px;">' + fld('liType','Type',sel(['home_loan','personal_loan','vehicle_loan','education_loan','gold_loan','business_loan','credit_card','bnpl','informal_loan','other'].map(function(x){return opt(x,x.replace(/_/g,' '));}).join(''))) + fld('liName','Name',inp('text')) + fld('liInstitution','Institution',inp('text')) + '<div class="grid grid-cols-2 gap-3">' + fld('liPrincipal','Original principal / limit',inp('number')) + fld('liOutstanding','Current outstanding',inp('number')) + '</div><div class="grid grid-cols-2 gap-3">' + fld('liRate','Interest rate %',inp('number')) + fld('liEmi','EMI / minimum due',inp('number')) + '</div><div class="grid grid-cols-2 gap-3">' + fld('liStart','Start date',inp('date')) + fld('liDue','Next due date',inp('date')) + '</div>' + saveBtn('Save Liability','saveLiability()') + '</div>'); }
async function saveLiability(){ var type=document.getElementById('liType').value; var principal=parseInt(document.getElementById('liPrincipal').value)||0; var body={liability_type:type,name:document.getElementById('liName').value,institution:document.getElementById('liInstitution').value,original_principal: type==='credit_card'?0:principal,credit_limit:type==='credit_card'?principal:null,current_outstanding:parseInt(document.getElementById('liOutstanding').value)||0,interest_rate:parseFloat(document.getElementById('liRate').value)||0,emi_amount:type==='credit_card'?0:(parseInt(document.getElementById('liEmi').value)||0),minimum_due:type==='credit_card'?(parseInt(document.getElementById('liEmi').value)||0):null,start_date:document.getElementById('liStart').value||null,next_due_date:document.getElementById('liDue').value||null,due_date:document.getElementById('liDue').value||null,interest_type:type==='credit_card'?'revolving':'reducing',auto_calculation_mode:type==='credit_card'?'manual':'hybrid'}; try{ await api('/api/liabilities',{method:'POST',body:body}); closeModal(); await reload('liabilities'); toast('Liability saved'); }catch(e){ toast(e.message,true); } }
function showLiabilityPayment(id){ openModal('Record Payment', '<div style="display:flex;flex-direction:column;gap:12px;">' + fld('lpDate','Payment date',inp('date')) + fld('lpAmount','Amount',inp('number')) + '<div class="grid grid-cols-2 gap-3">' + fld('lpPrincipal','Principal',inp('number')) + fld('lpInterest','Interest',inp('number')) + '</div>' + fld('lpMovement','Existing Ledger movement ID (optional)',inp('number')) + saveBtn('Save Payment','saveLiabilityPayment('+id+')') + '</div>'); }
async function saveLiabilityPayment(id){ var body={payment_date:document.getElementById('lpDate').value,payment_amount:parseInt(document.getElementById('lpAmount').value)||0,principal_component:parseInt(document.getElementById('lpPrincipal').value)||null,interest_component:parseInt(document.getElementById('lpInterest').value)||null,movement_id:parseInt(document.getElementById('lpMovement').value)||null,payment_type:'emi'}; try{ await api('/api/liabilities/'+id+'/payments',{method:'POST',body:body}); closeModal(); await reload('liabilities'); toast('Payment saved; Ledger movement was not duplicated'); }catch(e){ toast(e.message,true); } }
function showLiabilitySnapshot(id){ openModal('Add Balance Snapshot', '<div style="display:flex;flex-direction:column;gap:12px;">' + fld('lsDate','Snapshot date',inp('date')) + fld('lsBal','Outstanding balance',inp('number')) + saveBtn('Save Snapshot','saveLiabilitySnapshot('+id+')') + '</div>'); }
async function saveLiabilitySnapshot(id){ try{ await api('/api/liabilities/'+id+'/balance-snapshots',{method:'POST',body:{snapshot_date:document.getElementById('lsDate').value,outstanding_balance:parseInt(document.getElementById('lsBal').value)||0,source:'manual'}}); closeModal(); await reload('liabilities'); toast('Snapshot saved'); }catch(e){ toast(e.message,true); } }
async function showLiabilitySchedule(id){ try{ var r=await api('/api/liabilities/'+id+'/schedule'); openModal('Estimated Schedule','<div class="text-xs mb-2" style="color:var(--c-sub);">Calculated schedules are estimates only.</div><div style="overflow-x:auto;max-height:60vh;"><table class="w-full text-xs"><tbody>'+r.schedule.slice(0,120).map(function(x){return '<tr><td class="p-1">'+esc(x.due_date)+'</td><td class="p-1 text-right mono">Rp'+fmt(x.payment_amount)+'</td><td class="p-1 text-right mono">Rp'+fmt(x.principal)+'</td><td class="p-1 text-right mono">Rp'+fmt(x.interest)+'</td><td class="p-1 text-right mono">Rp'+fmt(x.remaining)+'</td></tr>';}).join('')+'</tbody></table></div>'); }catch(e){ toast(e.message,true); } }

function renderCicilan() {
  var cards = M.cicilan.map(function (c, idx) {
    var monthsLeft = c.monthly > 0 ? Math.ceil(c.sisa / c.monthly) : 0;
    var pctPaid = c.total > 0 ? ((c.total - c.sisa) / c.total * 100).toFixed(0) : 0;
    var sched = cicilanSchedule(c);
    var amortRows = sched.map(function (r) {
      return '<tr style="font-size:11px;"><td class="p-1">' + r.label + '</td><td class="p-1 text-right mono">Rp' + fmt(r.payment) + '</td><td class="p-1 text-right mono">Rp' + fmt(r.principal) + '</td><td class="p-1 text-right mono">Rp' + fmt(r.interest) + '</td><td class="p-1 text-right mono">Rp' + fmt(r.remaining) + "</td></tr>";
    }).join("");
    return '<div class="card p-5 mb-3" onclick="toggleCicilan(this)" style="cursor:pointer;">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;min-height:40px;"><div><h3 class="font-semibold">' + esc(c.name) + ' <button onclick="event.stopPropagation();showEditCicilan(' + idx + ')" style="background:none;border:none;cursor:pointer;color:var(--c-sub);font-size:11px;margin-left:4px;"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button> <span style="font-size:10px;color:var(--c-sub);">click for schedule</span></h3><p class="text-xs" style="color: var(--c-sub);">Active · ' + monthsLeft + " months remaining</p></div>" +
      '<span class="mono text-lg font-bold flex-shrink-0" style="color: var(--c-primary);">Rp' + fmt(c.sisa) + "</span></div>" +
      '<div style="height:6px;border-radius:3px;margin-bottom:16px;background:var(--c-bg);"><div style="height:6px;border-radius:3px;width:' + pctPaid + "%;background:var(--c-focus);\"></div></div>" +
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs"><div><span style="color: var(--c-sub);">Monthly</span><br><span class="mono">Rp' + fmt(c.monthly) + '</span></div><div><span style="color: var(--c-sub);">Interest</span><br><span class="mono">' + c.bunga + '%</span></div><div><span style="color: var(--c-sub);">Due Date</span><br><span class="mono">' + (c.due || "").slice(0, 10) + '</span></div><div><span style="color: var(--c-sub);">Total</span><br><span class="mono">Rp' + fmt(c.total) + "</span></div></div>" +
      '<div class="cicilan-expand" style="display:none;margin-top:16px;padding-top:12px;border-top:1px solid var(--c-border);"><div class="text-xs font-semibold mb-2" style="color: var(--c-sub);">Payment Schedule</div><div style="overflow-x:auto;"><table class="w-full" style="font-size:11px;"><thead><tr style="color:var(--c-sub);text-transform:uppercase;font-size:10px;letter-spacing:0.03em;"><th class="p-1 text-left">Month</th><th class="p-1 text-right">Payment</th><th class="p-1 text-right">Principal</th><th class="p-1 text-right">Interest</th><th class="p-1 text-right">Remaining</th></tr></thead><tbody>' + amortRows + '</tbody></table></div>' + (sched.length ? '<div class="text-xs mt-2" style="color:var(--c-success);">Debt-free in ' + sched.length + ' months</div>' : "") + "</div>" +
      "</div>";
  }).join("");
  return '<h1 class="text-2xl font-bold" style="color: var(--c-primary);">Cicilan</h1><p class="page-subtitle">Track your active installments and debt payments</p>' +
    '<div class="flex justify-end mb-4"><button class="btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-1.5" onclick="showAddCicilan()"><i data-lucide="plus" class="w-4 h-4"></i> Add Cicilan</button></div>' +
    (cards || '<div class="card-row"><span class="text-xs" style="color:var(--c-sub);">No active cicilan</span></div>');
}
function toggleCicilan(card) {
  var e = card.querySelector(".cicilan-expand");
  if (e) e.style.display = e.style.display === "none" ? "block" : "none";
}

/* ── RECURRING ── */
function accountLabel(kind, id) {
  if (!kind) return "Outside";
  if (kind === "wallet") { var w = M.wallets.find(function (x) { return x.id === id; }); return w ? w.name : "wallet"; }
  if (kind === "deposit") { var d = M.deposits.find(function (x) { return x.id === id; }); return d ? d.bank : "deposit"; }
  if (kind === "portfolio") { var p = M.portfolios.find(function (x) { return x.id === id; }); return p ? p.name : "portfolio"; }
  if (kind === "credit_card") { var cc = M.creditCards.find(function (x) { return x.id === id; }); return cc ? cc.name : "card"; }
  if (kind === "cicilan") { var ci = M.cicilan.find(function (x) { return x.id === id; }); return ci ? ci.name : "cicilan"; }
  return kind;
}
function accountOptions(sel) {
  var o = '<option value="outside"' + (!sel || sel === "outside" ? " selected" : "") + ">Outside (income / expense)</option>";
  M.wallets.forEach(function (w) { o += opt("wallet:" + w.id, "Wallet · " + w.name, sel); });
  M.deposits.forEach(function (d) { o += opt("deposit:" + d.id, "Deposit · " + d.bank, sel); });
  M.portfolios.forEach(function (p) { o += opt("portfolio:" + p.id, "Portfolio · " + p.name, sel); });
  M.creditCards.forEach(function (c) { o += opt("credit_card:" + c.id, "Card · " + c.name, sel); });
  M.cicilan.forEach(function (c) { o += opt("cicilan:" + c.id, "Cicilan · " + c.name, sel); });
  return o;
}
function opt(val, label, sel) { return '<option value="' + val + '"' + (sel === val ? " selected" : "") + ">" + esc(label) + "</option>"; }
function decodeAccount(v) {
  if (!v || v === "outside") return { kind: null, id: null };
  var p = v.split(":");
  return { kind: p[0], id: Number(p[1]) };
}
function renderRecurring() {
  var rows = M.recurring.map(function (r) {
    var freqLabel = { monthly: "Monthly", yearly: "Yearly", weekly: "Weekly", daily: "Daily" }[r.frequency] || r.frequency;
    var when = r.frequency === "yearly" ? "Day " + (r.day_of_month || "?") + " / month " + (r.month_of_year || "?")
      : r.frequency === "monthly" ? "Day " + (r.day_of_month || "?") + " each month"
      : r.frequency === "weekly" ? "Every week" : "Every day";
    var catName = nameById(CATMAP, r.category_id) || "—";
    return '<div class="card-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span class="font-semibold text-sm">' + esc(r.description || "(no description)") + '</span>' +
          '<span class="text-[10px] px-2 py-0.5 rounded-full" style="background:rgba(53,88,114,0.08);color:var(--c-primary);">' + freqLabel + '</span>' +
          (r.active ? "" : '<span class="text-[10px] px-2 py-0.5 rounded-full" style="background:rgba(196,75,75,0.08);color:var(--c-danger);">Paused</span>') + '</div>' +
        '<div class="text-xs mt-0.5 truncate" style="color:var(--c-sub);">' + when + ' · ' + esc(accountLabel(r.src_kind, r.src_id)) + ' → ' + esc(accountLabel(r.dst_kind, r.dst_id)) + ' · ' + esc(catName) + '</div>' +
      '</div>' +
      '<div class="text-right flex-shrink-0"><div class="mono text-sm font-semibold">Rp' + fmt(r.amount) + '</div>' +
        '<div class="text-[10px]" style="color:var(--c-sub);">next ' + esc(r.next_run || "—") + '</div></div>' +
      '<div class="flex gap-1 flex-shrink-0">' +
        '<button onclick="toggleRecurring(' + r.id + "," + (r.active ? 0 : 1) + ')" style="background:none;border:none;cursor:pointer;color:var(--c-sub);" title="' + (r.active ? "Pause" : "Resume") + '"><i data-lucide="' + (r.active ? "pause" : "play") + '" class="w-4 h-4"></i></button>' +
        '<button onclick="deleteRecurring(' + r.id + ')" style="background:none;border:none;cursor:pointer;color:var(--c-danger);" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
      '</div>' +
    '</div>';
  }).join("");
  return '<h1 class="text-2xl font-bold" style="color: var(--c-primary);">Recurring</h1>' +
    '<p class="page-subtitle">Automatic movements — bills, savings transfers, debt payments. Due items materialize when the dashboard loads.</p>' +
    '<div class="flex justify-end mb-4"><button class="btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-1.5" onclick="showAddRecurring()"><i data-lucide="plus" class="w-4 h-4"></i> Add Recurring</button></div>' +
    (rows || '<div class="card-row"><span class="text-xs" style="color:var(--c-sub);">No recurring templates yet</span></div>');
}
function showAddRecurring() {
  var freqOpts = opt("monthly", "Monthly", "monthly") + opt("yearly", "Yearly") + opt("weekly", "Weekly") + opt("daily", "Daily");
  var catOpts = '<option value="">— none —</option>' +
    M.expenseCats.map(function (n) { return opt(catId(n), "Expense · " + n); }).join("") +
    M.incomeCats.map(function (n) { return opt(catId(n), "Income · " + n); }).join("");
  openModal("Add Recurring", '<div style="display:flex;flex-direction:column;gap:12px;">' +
    fld("rcDesc", "Description", inp("text")) +
    '<div class="grid grid-cols-2 gap-3">' + fld("rcAmount", "Amount (IDR)", inp("number")) + fld("rcFreq", "Frequency", sel(freqOpts)) + '</div>' +
    '<div class="grid grid-cols-2 gap-3">' + fld("rcDay", "Day of month (1–31)", inp("number")) + fld("rcMonth", "Month of year (1–12, yearly only)", inp("number")) + '</div>' +
    fld("rcCat", "Category", sel(catOpts)) +
    fld("rcSrc", "From (source)", sel(accountOptions("outside"))) +
    fld("rcDst", "To (destination)", sel(accountOptions("outside"))) +
    fld("rcNext", "First run date", inp("date").replace('value=""', ""), today()) +
    saveBtn("Save Recurring", "saveRecurring()") + "</div>");
}
async function saveRecurring() {
  var src = decodeAccount(document.getElementById("rcSrc").value);
  var dst = decodeAccount(document.getElementById("rcDst").value);
  var freq = document.getElementById("rcFreq").value;
  var body = {
    description: document.getElementById("rcDesc").value,
    amount: parseInt(document.getElementById("rcAmount").value) || 0,
    frequency: freq,
    day_of_month: (freq === "monthly" || freq === "yearly") ? (parseInt(document.getElementById("rcDay").value) || null) : null,
    month_of_year: freq === "yearly" ? (parseInt(document.getElementById("rcMonth").value) || null) : null,
    category_id: document.getElementById("rcCat").value ? Number(document.getElementById("rcCat").value) : null,
    src_kind: src.kind, src_id: src.id, dst_kind: dst.kind, dst_id: dst.id,
    next_run: document.getElementById("rcNext").value || today(),
  };
  if (!body.amount || body.amount <= 0) return toast("Amount required", true);
  if (!body.src_kind && !body.dst_kind) return toast("Pick at least one real account (not both Outside)", true);
  if (freq === "yearly" && !body.month_of_year) return toast("Yearly needs month of year", true);
  try { await api("/api/recurring", { method: "POST", body: body }); closeModal(); await reload("recurring"); toast("Saved"); } catch (e) { toast(e.message, true); }
}
async function toggleRecurring(id, active) {
  try { await api("/api/recurring/" + id, { method: "PUT", body: { active: active } }); await reload("recurring"); toast(active ? "Resumed" : "Paused"); } catch (e) { toast(e.message, true); }
}
async function deleteRecurring(id) {
  if (!confirm("Delete this recurring template? Already-created movements are kept.")) return;
  try { await api("/api/recurring/" + id, { method: "DELETE" }); await reload("recurring"); toast("Deleted"); } catch (e) { toast(e.message, true); }
}

/* ── NET WORTH ── */
function renderNetWorth() {
  var rowsData = M.networth || [];
  var last = rowsData[rowsData.length - 1] || { assets: 0, liabilities: 0, netWorth: 0, assetBreakdown: {}, liabilityBreakdown: {}, warnings: [] };
  var a = M.networthAnalytics || {};
  var nw = a.current_net_worth ?? last.netWorth ?? (last.assets - last.liabilities);
  var mom = a.month_on_month_change;
  var ytd = a.year_to_date_change;
  var warn = last.valuation_complete === false || (last.warnings || []).length;
  function moneyCell(v){ return '<span class="mono">Rp' + fmt(v || 0) + '</span>'; }
  var snapRows = rowsData.slice().reverse().map(function(r,idx){
    var prev = rowsData[rowsData.length - idx - 2];
    var change = prev ? (r.netWorth - prev.netWorth) : null;
    return '<tr class="border-b" style="border-color:rgba(53,88,114,.06)"><td class="p-2">' + esc(r.month) + '</td><td class="p-2">' + esc(r.snapshot_date || '') + '</td><td class="p-2 text-right">' + moneyCell(r.assets) + '</td><td class="p-2 text-right">' + moneyCell(r.investments_total || 0) + '</td><td class="p-2 text-right">' + moneyCell(r.liabilities) + '</td><td class="p-2 text-right font-semibold">' + moneyCell(r.netWorth) + '</td><td class="p-2 text-right mono">' + (change == null ? '—' : (change >= 0 ? '+' : '−') + 'Rp' + fmt(Math.abs(change))) + '</td><td class="p-2">' + esc(r.valuation_status || (r.valuation_complete === false ? 'partial' : 'complete')) + '</td><td class="p-2">' + (r.locked ? '🔒 Locked' : 'Unlocked') + '</td><td class="p-2 whitespace-nowrap"><button class="text-xs" onclick="generateSnapshot(\'' + esc(r.month) + '\',true)">Recalc</button> · <button class="text-xs" onclick="toggleSnapshotLock(\'' + esc(r.month) + '\',' + (!r.locked) + ')">' + (r.locked ? 'Unlock' : 'Lock') + '</button>' + (!r.locked ? ' · <button class="text-xs" onclick="deleteSnapshot(\'' + esc(r.month) + '\')">Delete</button>' : '') + '</td></tr>';
  }).join('');
  var br = last.assetBreakdown || {};
  var invCats = br.investment_categories || br;
  var catRows = Object.keys(invCats).map(function(k){ return '<tr><td class="p-2">' + esc(k.replace(/_/g,' ')) + '</td><td class="p-2 text-right">' + moneyCell(invCats[k]) + '</td></tr>'; }).join('');
  return '<h1 class="text-2xl font-bold" style="color: var(--c-primary);">Net Worth</h1><p class="page-subtitle">Monthly snapshots, trends, valuation health, and month-end reporting.</p>' +
    (warn ? '<div class="card p-3 mb-4 text-xs" style="color:var(--c-warning);background:rgba(212,162,78,.10);">Partial valuation: historical values depend on available dated transactions, prices, and manual valuations. Liabilities remain limited until Phase 11. ' + esc((last.warnings || []).slice(0,2).join(', ')) + '</div>' : '') +
    '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' +
      '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Current net worth</div><div class="font-bold mono">Rp' + fmt(nw) + '</div></div>' +
      '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Monthly change</div><div class="font-bold mono">' + (mom == null ? '—' : (mom >= 0 ? '+' : '−') + 'Rp' + fmt(Math.abs(mom))) + '</div></div>' +
      '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">YTD change</div><div class="font-bold mono">' + (ytd == null ? '—' : (ytd >= 0 ? '+' : '−') + 'Rp' + fmt(Math.abs(ytd))) + '</div></div>' +
      '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Valuation status</div><div class="font-bold">' + esc(last.valuation_status || 'live') + '</div></div>' +
      '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Total assets</div><div class="font-bold mono">Rp' + fmt(last.assets) + '</div></div>' +
      '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Investments</div><div class="font-bold mono">Rp' + fmt(last.investments_total || 0) + '</div></div>' +
      '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Liabilities</div><div class="font-bold mono">Rp' + fmt(last.liabilities) + '</div></div>' +
      '<div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Latest snapshot</div><div class="font-bold">' + esc(last.month || 'none') + (last.locked ? ' 🔒' : '') + '</div></div>' +
    '</div>' +
    '<div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4"><div class="card p-5 lg:col-span-2"><div class="section-title">Net-worth trend</div><div style="height:280px"><canvas id="chartNetWorth"></canvas></div></div><div class="card p-5"><div class="section-title">Investment category breakdown</div><table class="w-full text-sm"><tbody>' + catRows + '</tbody></table></div></div>' +
    '<div class="card p-4 mb-4"><div class="section-title">Snapshot controls</div><div class="flex flex-wrap gap-2"><input id="snapshotMonth" type="month" class="input input-sm" value="' + today().slice(0,7) + '"><button class="btn btn-sm" onclick="generateSnapshot(document.getElementById(\'snapshotMonth\').value,false)">Generate</button><button class="btn btn-sm" onclick="generateSnapshot(document.getElementById(\'snapshotMonth\').value,true)">Recalculate</button><button class="btn btn-sm" onclick="previewBackfill()">Preview backfill</button></div><div id="backfillPreview" class="text-xs mt-2" style="color:var(--c-sub)">Current month uses today until month end; future months are rejected.</div></div>' +
    '<div class="card p-5"><div class="section-title">Monthly snapshot history</div><div style="overflow-x:auto"><table class="w-full text-xs" style="min-width:920px"><thead><tr><th class="p-2 text-left">Month</th><th class="p-2 text-left">Date</th><th class="p-2 text-right">Assets</th><th class="p-2 text-right">Investments</th><th class="p-2 text-right">Liabilities</th><th class="p-2 text-right">Net worth</th><th class="p-2 text-right">Change</th><th class="p-2 text-left">Status</th><th class="p-2 text-left">Lock</th><th class="p-2 text-left">Actions</th></tr></thead><tbody>' + (snapRows || '<tr><td class="p-3" colspan="10">No snapshots yet. Generate a month to begin history.</td></tr>') + '</tbody></table></div></div>';
}
async function generateSnapshot(month, force){ if(!month)return toast('Pick a month',true); if(force && !confirm('Recalculate this unlocked snapshot from current historical data? Locked snapshots are preserved.')) return; try{ await api('/api/net-worth/snapshots/generate',{method:'POST',body:{month:month,force_recalculate:!!force}}); await reload('networth'); toast('Snapshot ready'); }catch(e){ toast(e.message,true); } }
async function toggleSnapshotLock(month, lock){ if(!confirm((lock?'Lock':'Unlock') + ' snapshot ' + month + '?')) return; try{ await api('/api/net-worth/snapshots/' + month + '/' + (lock?'lock':'unlock'),{method:'POST'}); await reload('networth'); }catch(e){ toast(e.message,true); } }
async function deleteSnapshot(month){ if(!confirm('Delete unlocked snapshot ' + month + '?')) return; try{ await api('/api/net-worth/snapshots/' + month,{method:'DELETE'}); await reload('networth'); }catch(e){ toast(e.message,true); } }
async function previewBackfill(){ var end=today().slice(0,7), start=end.slice(0,5)+'01'; try{ var r=await api('/api/net-worth/snapshots/preview-range',{method:'POST',body:{start_month:start,end_month:end}}); document.getElementById('backfillPreview').textContent = r.months.map(function(m){return m.month + (m.locked?' locked':m.already_present?' present':' create');}).join(' · '); }catch(e){ toast(e.message,true); } }
function initNetWorthChart() {
  var ctx = document.getElementById("chartNetWorth");
  if (!ctx || !window.Chart) return;
  var data = M.networth.map(function (n) { return { month: n.month.slice(5), assets: n.assets, liabilities: n.liabilities, net: n.assets - n.liabilities }; });
  charts.nw = new Chart(ctx.getContext("2d"), {
    type: "line",
    data: { labels: data.map(function (d) { return d.month; }), datasets: [
      { label: "Assets", data: data.map(function (d) { return d.assets; }), borderColor: "#4A8C6F", backgroundColor: "rgba(74,140,111,0.05)", fill: true, tension: 0.3, pointRadius: 4 },
      { label: "Liabilities", data: data.map(function (d) { return d.liabilities; }), borderColor: "#C44B4B", backgroundColor: "rgba(196,75,75,0.05)", fill: true, tension: 0.3, pointRadius: 4 },
      { label: "Net Worth", data: data.map(function (d) { return d.net; }), borderColor: "#7AAACE", borderWidth: 2, tension: 0.3, pointRadius: 4, pointBackgroundColor: "#355872" },
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: "#6B7D8E", font: { size: 11 } } } }, scales: { x: { ticks: { color: "#6B7D8E", font: { size: 10 } }, grid: { display: false } }, y: { ticks: { color: "#6B7D8E", font: { size: 10 }, callback: function (v) { return (v / 1e6).toFixed(0) + "M"; } }, grid: { color: "rgba(53,88,114,0.06)" } } } },
  });
}

/* ── WHAT-IF ── */
function renderScenarios() {
  return '<h1 class="text-2xl font-bold" style="color: var(--c-primary);">What-If Simulator</h1><p class="page-subtitle">Model income and expense changes to see impact on your financial health</p>' +
    '<div class="card p-5 mb-6"><div class="section-title">Adjust Parameters</div><div class="grid grid-cols-1 md:grid-cols-2 gap-6">' +
      '<div><label class="flex items-center justify-between text-xs mb-2" style="color: var(--c-sub);"><span>Income Change (%)</span><span class="mono text-sm font-semibold" id="incomeVal" style="color:var(--c-ink);">0%</span></label><input type="range" id="incomeSlider" min="-50" max="100" value="0" step="5" class="w-full" oninput="updateScenario()"></div>' +
      '<div><label class="flex items-center justify-between text-xs mb-2" style="color: var(--c-sub);"><span>Expense Change (%)</span><span class="mono text-sm font-semibold" id="expenseVal" style="color:var(--c-ink);">0%</span></label><input type="range" id="expenseSlider" min="-50" max="100" value="0" step="5" class="w-full" oninput="updateScenario()"></div>' +
    "</div></div>" +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"><div id="scenarioCards" class="grid grid-cols-2 gap-3"></div><div class="card p-5 min-w-0"><div class="section-title">Savings Rate Comparison</div><div style="height:220px"><canvas id="chartScenario"></canvas></div></div></div>' +
    '<div class="card p-5 mb-6"><div class="section-title">Detailed Breakdown</div><div id="scenarioDetail" class="text-sm"></div></div>';
}
function updateScenario() {
  var incPct = parseInt(document.getElementById("incomeSlider").value);
  var expPct = parseInt(document.getElementById("expenseSlider").value);
  document.getElementById("incomeVal").textContent = (incPct >= 0 ? "+" : "") + incPct + "%";
  document.getElementById("expenseVal").textContent = (expPct >= 0 ? "+" : "") + expPct + "%";
  var newInc = M.income * (1 + incPct / 100);
  var newExp = M.expense * (1 + expPct / 100);
  var newNet = newInc - newExp;
  var newSR = newInc > 0 ? newNet / newInc : 0;
  var totalCicilan = M.cicilan.reduce(function (s, c) { return s + c.monthly; }, 0);
  var newDTI = newInc > 0 ? totalCicilan / newInc : 0;
  var incColor = incPct >= 0 ? "text-[#4A8C6F]" : "text-[#C44B4B]";
  var expColor = expPct <= 0 ? "text-[#4A8C6F]" : "text-[#C44B4B]";
  var srColor = newSR >= M.savingsRate ? "text-[#4A8C6F]" : "text-[#C44B4B]";
  var dtiColor = newDTI < 0.3 ? "text-[#4A8C6F]" : (newDTI < 0.5 ? "text-[#D4A24E]" : "text-[#C44B4B]");
  var netColor = newNet >= 0 ? "text-[#4A8C6F]" : "text-[#C44B4B]";
  document.getElementById("scenarioCards").innerHTML =
    '<div class="scenario-card p-4 text-center min-w-0"><div class="text-[10px] uppercase mb-1" style="color: var(--c-sub);">New Income</div><div class="mono font-bold break-words ' + incColor + '">Rp' + fmt(Math.round(newInc)) + '</div></div>' +
    '<div class="scenario-card p-4 text-center min-w-0"><div class="text-[10px] uppercase mb-1" style="color: var(--c-sub);">New Expense</div><div class="mono font-bold break-words ' + expColor + '">Rp' + fmt(Math.round(newExp)) + '</div></div>' +
    '<div class="scenario-card p-4 text-center min-w-0"><div class="text-[10px] uppercase mb-1" style="color: var(--c-sub);">New Savings Rate</div><div class="mono text-lg font-bold ' + srColor + '">' + pct(newSR) + '</div></div>' +
    '<div class="scenario-card p-4 text-center min-w-0"><div class="text-[10px] uppercase mb-1" style="color: var(--c-sub);">New DTI</div><div class="mono text-lg font-bold ' + dtiColor + '">' + pct(newDTI) + "</div></div>";
  var netDelta = Math.round(newNet - M.net);
  var srDelta = Math.abs(newSR - M.savingsRate);
  var dtiDelta = Math.abs(newDTI - M.dti);
  document.getElementById("scenarioDetail").innerHTML =
    '<div style="overflow-x:auto"><table class="w-full" style="min-width:380px"><thead><tr class="border-b" style="border-color: rgba(53,88,114,0.08); font-size: 10px; color: var(--c-sub); text-transform: uppercase; letter-spacing: 0.05em;"><th class="p-2 text-left">Metric</th><th class="p-2 text-right">Current</th><th class="p-2 text-right">Scenario</th><th class="p-2 text-right">Δ</th></tr></thead><tbody>' +
    '<tr class="border-b" style="border-color: rgba(53,88,114,0.04);"><td class="p-2">Income</td><td class="p-2 text-right mono">Rp' + fmt(M.income) + '</td><td class="p-2 text-right mono ' + incColor + '">Rp' + fmt(Math.round(newInc)) + '</td><td class="p-2 text-right mono">' + (incPct >= 0 ? "+" : "") + incPct + "%</td></tr>" +
    '<tr class="border-b" style="border-color: rgba(53,88,114,0.04);"><td class="p-2">Expense</td><td class="p-2 text-right mono">Rp' + fmt(M.expense) + '</td><td class="p-2 text-right mono ' + expColor + '">Rp' + fmt(Math.round(newExp)) + '</td><td class="p-2 text-right mono">' + (expPct >= 0 ? "+" : "") + expPct + "%</td></tr>" +
    '<tr class="border-b" style="border-color: rgba(53,88,114,0.04);"><td class="p-2">Net Balance</td><td class="p-2 text-right mono">Rp' + fmt(M.net) + '</td><td class="p-2 text-right mono ' + netColor + '">Rp' + fmt(Math.abs(Math.round(newNet))) + '</td><td class="p-2 text-right mono ' + (netDelta >= 0 ? "text-[#4A8C6F]" : "text-[#C44B4B]") + '">' + (netDelta >= 0 ? "+" : "") + fmt(netDelta) + "</td></tr>" +
    '<tr class="border-b" style="border-color: rgba(53,88,114,0.04);"><td class="p-2">Savings Rate</td><td class="p-2 text-right mono">' + pct(M.savingsRate) + '</td><td class="p-2 text-right mono font-bold ' + srColor + '">' + pct(newSR) + '</td><td class="p-2 text-right mono ' + srColor + '">' + (newSR >= M.savingsRate ? "+" : "") + pct(srDelta) + "</td></tr>" +
    '<tr><td class="p-2">DTI Ratio</td><td class="p-2 text-right mono">' + pct(M.dti) + '</td><td class="p-2 text-right mono">' + pct(newDTI) + '</td><td class="p-2 text-right mono ' + (newDTI <= M.dti ? "text-[#4A8C6F]" : "text-[#C44B4B]") + '">' + (newDTI <= M.dti ? "↓" : "↑") + " " + pct(dtiDelta) + "</td></tr>" +
    "</tbody></table></div>";
  if (charts.sc) { charts.sc.data.datasets[0].data = [M.savingsRate * 100, newSR * 100]; charts.sc.update(); }
}
function initScenarioChart() {
  var ctx = document.getElementById("chartScenario");
  if (!ctx || !window.Chart) return;
  charts.sc = new Chart(ctx.getContext("2d"), { type: "bar", data: { labels: ["Current", "Scenario"], datasets: [{ data: [M.savingsRate * 100, M.savingsRate * 100], backgroundColor: ["#7AAACE", "#355872"], borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 60, ticks: { color: "#6B7D8E", callback: function (v) { return v + "%"; } }, grid: { color: "rgba(53,88,114,0.06)" } }, x: { ticks: { color: "#6B7D8E" }, grid: { display: false } } } } });
}

/* ── CREDIT CARD ── */
function renderCreditCard() {
  var cards = M.creditCards.map(function (c, idx) {
    var utilization = c.limit > 0 ? (c.balance / c.limit * 100).toFixed(0) : 0;
    var utilColor = utilization > 50 ? "var(--c-danger)" : utilization > 30 ? "var(--c-warning)" : "var(--c-success)";
    var minPay = Math.max(c.minPayment, Math.round(c.balance * c.minPaymentPct / 100));
    return '<div class="card p-5 mb-3"><div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;min-height:40px;"><div><h3 class="font-semibold">' + esc(c.name) + ' <button onclick="showEditCreditCard(' + idx + ')" style="background:none;border:none;cursor:pointer;color:var(--c-sub);font-size:11px;margin-left:4px;"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button></h3><p class="text-xs" style="color: var(--c-sub);">Limit: Rp' + fmt(c.limit) + " · Statement: " + ordinal(c.statementDay) + " · Due: " + ordinal(c.dueDay) + '</p></div><div class="text-right flex-shrink-0"><div class="mono text-lg font-bold" style="color: var(--c-ink);">Rp' + fmt(c.balance) + '</div><div class="text-xs" style="color:' + utilColor + ';">' + utilization + "% utilized</div></div></div>" +
      '<div style="height:6px;border-radius:3px;margin-bottom:16px;background:var(--c-bg);"><div style="height:6px;border-radius:3px;width:' + utilization + "%;background:" + utilColor + ';"></div></div>' +
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs"><div><span style="color:var(--c-sub);">Min Payment</span><br><span class="mono">Rp' + fmt(minPay) + '</span></div><div><span style="color:var(--c-sub);">Interest</span><br><span class="mono">' + c.interestRate + '%/mo</span></div><div><span style="color:var(--c-sub);">Annual Fee</span><br><span class="mono">Rp' + fmt(c.annualFee) + '</span></div><div><span style="color:var(--c-sub);">Available</span><br><span class="mono text-[#4A8C6F]">Rp' + fmt(c.limit - c.balance) + "</span></div></div></div>";
  }).join("");
  var totalBalance = M.creditCards.reduce(function (s, c) { return s + c.balance; }, 0);
  var totalLimit = M.creditCards.reduce(function (s, c) { return s + c.limit; }, 0);
  return '<h1 class="text-2xl font-bold" style="color: var(--c-primary);">Credit Card</h1><p class="page-subtitle">Track credit card balances, utilization, and billing cycles</p>' +
    '<div class="flex mb-4"><button class="btn-primary px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-1.5 w-full sm:w-auto" onclick="showAddCreditCard()"><i data-lucide="plus" class="w-4 h-4"></i> Add Card</button></div>' +
    '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4"><div class="card p-3 text-center min-w-0"><div class="text-[10px] text-[#6B7D8E] uppercase">Total Balance</div><div class="mono font-bold text-[#C44B4B] break-words">Rp' + fmt(totalBalance) + '</div></div><div class="card p-3 text-center min-w-0"><div class="text-[10px] text-[#6B7D8E] uppercase">Total Limit</div><div class="mono font-bold break-words">Rp' + fmt(totalLimit) + '</div></div><div class="card p-3 text-center min-w-0"><div class="text-[10px] text-[#6B7D8E] uppercase">Utilization</div><div class="mono font-bold">' + (totalLimit > 0 ? (totalBalance / totalLimit * 100).toFixed(0) : 0) + "%</div></div></div>" +
    (cards || '<div class="card-row"><span class="text-xs" style="color:var(--c-sub);">No credit cards</span></div>');
}

/* ── ASSETS ── */
function renderAssets() {
  var depRows = M.deposits.map(function (d, idx) {
    var interest = d.amount * (d.rate / 100) * (d.tenor / 12);
    var matVal = d.amount + interest;
    var isActive = d.status === "active";
    return '<div class="card p-4 mb-2"><div style="display:flex;align-items:center;justify-content:space-between;"><div><span class="text-sm font-medium">' + esc(d.bank) + ' <button onclick="showEditDeposit(' + idx + ')" style="background:none;border:none;cursor:pointer;color:var(--c-sub);font-size:11px;margin-left:4px;"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button></span><span class="text-xs ml-2" style="color: var(--c-sub);">' + d.rate + "% p.a. · " + d.tenor + 'mo</span></div><div class="text-right"><span class="mono text-sm font-bold">Rp' + fmt(d.amount) + '</span><span class="ml-2 text-xs px-1.5 py-0.5 rounded ' + (isActive ? "text-[#4A8C6F] bg-[rgba(74,140,111,0.08)]" : "text-[#6B7D8E] bg-[rgba(107,125,142,0.08)]") + '">' + (isActive ? "Active" : "Matured") + '</span></div></div><div class="grid grid-cols-3 gap-2 mt-2 text-xs"><div><span style="color:var(--c-sub);">Interest</span><br><span class="mono text-[#4A8C6F]">Rp' + fmt(Math.round(interest)) + '</span></div><div><span style="color:var(--c-sub);">Maturity Value</span><br><span class="mono">Rp' + fmt(Math.round(matVal)) + '</span></div><div><span style="color:var(--c-sub);">' + (isActive ? "Matures" : "Matured") + "</span><br><span class=\"mono\">" + (d.maturity || "").slice(0, 10) + "</span></div></div></div>";
  }).join("");
  var totalDep = M.deposits.reduce(function (s, d) { return s + d.amount; }, 0);
  var totalPorto = M.portfolios.reduce(function (s, p) { return s + p.value; }, 0);
  var portoCards = M.portfolios.map(function (p, idx) {
    return '<div class="card-row"><span class="text-sm font-medium flex-1">' + esc(p.name) + '</span><span class="mono text-sm font-bold">Rp' + fmt(p.value) + '</span><button onclick="showEditPortfolio(' + idx + ')" style="background:none;border:none;cursor:pointer;color:var(--c-sub);font-size:13px;"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button></div>';
  }).join("");
  return '<h1 class="text-2xl font-bold" style="color: var(--c-primary);">Assets</h1><p class="page-subtitle">Track deposits and total asset value — update monthly</p>' +
    '<div class="card p-5 mb-4"><div class="flex items-center justify-between mb-3"><div class="section-title" style="margin-bottom:0;">Deposits</div><button class="btn-primary px-3 py-1.5 rounded-lg text-xs flex items-center gap-1" onclick="showAddDeposit()"><i data-lucide="plus" class="w-3.5 h-3.5"></i> Add</button></div>' + (depRows || '<div class="text-xs" style="color:var(--c-sub);">No deposits</div>') + '<div class="text-right text-xs mt-2 mono" style="color: var(--c-sub);">Total Deposits: Rp' + fmt(totalDep) + "</div></div>" +
    '<div class="card p-5"><div class="flex items-center justify-between mb-3"><div class="section-title" style="margin-bottom:0;">Investment Accounts</div><button class="btn-primary px-3 py-1.5 rounded-lg text-xs flex items-center gap-1" onclick="showAddPortfolio()"><i data-lucide="plus" class="w-3.5 h-3.5"></i> Add</button></div>' + (portoCards || '<div class="text-xs" style="color:var(--c-sub);">No portfolios</div>') + '<div class="text-right text-xs mt-2 mono" style="color: var(--c-sub);">Total Portfolio: Rp' + fmt(totalPorto) + "</div></div>";
}

/* ── ACCOUNT ── */
function renderAccount() {
  return '<h1 class="text-2xl font-bold" style="color: var(--c-primary);">Account</h1><p class="page-subtitle">Manage your account credentials</p>' +
    '<div class="card p-5 mb-4 max-w-md"><div class="section-title">Change Password</div><div class="space-y-3"><div><label class="block text-xs mb-1" style="color: var(--c-sub);">New Password</label><input id="acctPwd" type="password" class="w-full px-3 py-2 rounded-lg border text-sm" style="border-color: var(--c-focus); background: #fff; color: var(--c-ink);"></div><button class="btn-primary px-4 py-2 rounded-lg text-sm" onclick="changePassword()">Update Password</button></div></div>' +
    '<div class="card p-5 max-w-md"><div class="section-title">Account Info</div><div id="acctInfo" class="text-sm space-y-2"><span style="color: var(--c-sub);">Loading…</span></div></div>';
}

/* ── WALLETS ── */
function renderWallets() {
  var totalLiquid = M.wallets.reduce(function (s, w) { return s + w.balance; }, 0);
  var walletCards = M.wallets.map(function (w, idx) {
    var bal = w.balance;
    var isNeg = bal < 0;
    var walletIcon = w.type === "bank" ? "building-2" : w.type === "e-wallet" ? "smartphone" : "banknote";
    var iconBg = w.type === "bank" ? "rgba(122,170,206,0.08)" : w.type === "e-wallet" ? "rgba(74,140,111,0.08)" : "rgba(212,162,78,0.08)";
    var iconColor = w.type === "bank" ? "var(--c-focus)" : w.type === "e-wallet" ? "var(--c-success)" : "var(--c-warning)";
    var bd = w.reconciliation || { income: 0, transfersIn: 0, expenses: 0, transfersOut: 0 };
    var txnRows = (w.activity || []).slice(0, 8).map(function (t) {
      var isIn = t.type === "income" || t.type === "transfer_in";
      var icon = t.type === "income" ? "arrow-down-left" : t.type === "transfer_in" ? "arrow-right-left" : t.type === "transfer_out" ? "arrow-right-left" : "shopping-cart";
      return '<div class="flex items-center gap-2 py-1.5 text-[11px]" style="border-bottom:1px solid rgba(53,88,114,0.04);"><span class="mono flex-shrink-0" style="color:var(--c-sub);width:62px;">' + (t.date || "").slice(5) + '</span><i data-lucide="' + icon + '" class="w-3 h-3 flex-shrink-0" style="color:' + (isIn ? "var(--c-success)" : "var(--c-danger)") + ';"></i><span class="flex-1 truncate" style="color:var(--c-sub);">' + esc(t.description || t.cat || "") + '</span><span class="mono font-medium flex-shrink-0 ' + (isIn ? "text-[#4A8C6F]" : "text-[#C44B4B]") + '">' + (isIn ? "+" : "−") + "Rp" + fmt(t.amount) + "</span></div>";
    }).join("");
    return '<div class="card p-4 mb-3" onclick="toggleWalletDetail(this)" style="cursor:pointer;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;"><div style="display:flex;align-items:center;gap:10px;"><div style="width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:' + iconBg + ';"><i data-lucide="' + walletIcon + '" class="w-4 h-4" style="color:' + iconColor + ';"></i></div><div><div class="text-sm font-semibold">' + esc(w.name) + '</div><div class="text-[10px]" style="color:var(--c-sub);">' + esc(w.number || w.type) + "</div></div></div>" +
      '<div class="text-right"><div class="mono text-base font-bold ' + (isNeg ? "text-[#C44B4B]" : "text-[#4A8C6F]") + '">Rp' + fmt(Math.abs(bal)) + '</div><div class="text-[10px]" style="color:var(--c-sub);">' + (isNeg ? "deficit" : "available") + '</div></div><button class="flex-shrink-0 p-2" style="color:var(--c-sub);background:none;border:none;cursor:pointer;" onclick="event.stopPropagation();showWalletActions(' + idx + ')" aria-label="Wallet actions"><i data-lucide="ellipsis-vertical" class="w-4 h-4"></i></button></div>' +
      '<div class="wallet-detail" style="display:none;margin-top:16px;padding-top:12px;border-top:1px solid var(--c-border);"><div class="text-[10px] font-semibold uppercase mb-2" style="color:var(--c-sub);letter-spacing:0.05em;">Reconciliation</div><div class="grid grid-cols-2 gap-2 mb-3"><div class="flex justify-between text-[11px] px-2 py-1 rounded" style="background:rgba(74,140,111,0.04);"><span style="color:var(--c-sub);">Income</span><span class="mono text-[#4A8C6F]">+Rp' + fmt(bd.income || 0) + '</span></div><div class="flex justify-between text-[11px] px-2 py-1 rounded" style="background:rgba(74,140,111,0.04);"><span style="color:var(--c-sub);">Transfers In</span><span class="mono text-[#4A8C6F]">+Rp' + fmt(bd.transfersIn || 0) + '</span></div><div class="flex justify-between text-[11px] px-2 py-1 rounded" style="background:rgba(196,75,75,0.04);"><span style="color:var(--c-sub);">Expenses</span><span class="mono text-[#C44B4B]">−Rp' + fmt(bd.expenses || 0) + '</span></div><div class="flex justify-between text-[11px] px-2 py-1 rounded" style="background:rgba(196,75,75,0.04);"><span style="color:var(--c-sub);">Transfers Out</span><span class="mono text-[#C44B4B]">−Rp' + fmt(bd.transfersOut || 0) + '</span></div></div><div class="flex justify-between text-xs font-semibold px-2 py-2 rounded mb-3" style="background:rgba(53,88,114,0.04);"><span>Net Balance</span><span class="mono ' + (bal >= 0 ? "text-[#4A8C6F]" : "text-[#C44B4B]") + '">Rp' + fmt(Math.abs(bal)) + '</span></div><div class="text-[10px] font-semibold uppercase mb-2" style="color:var(--c-sub);letter-spacing:0.05em;">Activity</div>' + (txnRows || '<div class="text-xs" style="color:var(--c-sub);">No transactions yet</div>') + "</div></div>";
  }).join("");
  return '<h1 class="text-2xl font-bold" style="color:var(--c-primary);">Wallets</h1><p class="page-subtitle">Track balances — income, expenses, and transfers — all reconcilable</p>' +
    '<div class="card p-4 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><div class="text-[10px] uppercase" style="color:var(--c-sub);">Total Liquid</div><div class="mono text-lg font-bold ' + (totalLiquid >= 0 ? "text-[#4A8C6F]" : "text-[#C44B4B]") + '">Rp' + fmt(Math.abs(totalLiquid)) + '</div></div><div class="flex flex-col sm:flex-row gap-2 w-full sm:w-auto"><button class="btn-primary px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-1.5" onclick="showAddWallet()"><i data-lucide="plus" class="w-4 h-4"></i> Add Wallet</button><button class="btn-primary px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-1.5" onclick="showTransfer()"><i data-lucide="arrow-left-right" class="w-4 h-4"></i> Transfer</button></div></div>' +
    (walletCards || '<div class="card-row"><span class="text-xs" style="color:var(--c-sub);">No wallets</span></div>');
}
function toggleWalletDetail(card) { var d = card.querySelector(".wallet-detail"); if (d) d.style.display = d.style.display === "block" ? "none" : "block"; }

/* ── GOALS ── */
function renderGoals() {
  var totalEarmarked = M.goals.reduce(function (s, g) { return s + (g.progress || 0); }, 0);
  var goalCards = M.goals.map(function (g, idx) {
    var prog = g.progress || goalProgress(g.name);
    var pctD = g.progress_details && g.progress_details.progress_percent != null ? g.progress_details.progress_percent : (g.target > 0 ? (prog / g.target * 100) : 0);
    var rem = g.target - prog;
    var earmarkRows = M.earmarks.filter(function (e) { return e.goal === g.name; }).map(function (e) {
      return '<div class="flex items-center justify-between text-[11px] py-1 px-2 rounded" style="background:rgba(53,88,114,0.02);"><span style="color:var(--c-sub);">' + esc(e.source) + ' <button onclick="event.stopPropagation();deleteEarmark(' + e.id + ')" style="background:none;border:none;cursor:pointer;color:var(--c-sub);">×</button></span><span class="mono font-medium" style="color:var(--c-ink);">Rp' + fmt(e.amount) + "</span></div>";
    }).join("");
    return '<div class="card p-5 mb-3"><div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;"><div class="flex items-center gap-3"><div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:rgba(122,170,206,0.10);"><i data-lucide="' + (g.icon || "target") + '" class="w-5 h-5" style="color:var(--c-focus);"></i></div><div><h3 class="font-semibold">' + esc(g.name) + ' <button onclick="showEditGoal(' + idx + ')" style="background:none;border:none;cursor:pointer;color:var(--c-sub);font-size:11px;margin-left:4px;"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button></h3><p class="text-xs" style="color:var(--c-sub);">Target: Rp' + fmt(g.target) + ' · ' + esc(g.goal_type || "custom") + '</p></div></div><div class="text-right"><div class="mono text-lg font-bold ' + (prog >= g.target ? "text-[#4A8C6F]" : "text-[#355872]") + '">Rp' + fmt(prog) + '</div><div class="text-[10px]" style="color:var(--c-sub);">' + pctD.toFixed(0) + "% · " + esc((g.progress_details && g.progress_details.status) || g.status || "active") + "</div></div></div>" +
      '<div style="height:8px;border-radius:4px;margin-bottom:16px;background:var(--c-bg);"><div style="height:8px;border-radius:4px;width:' + Math.min(pctD, 100) + "%;background:" + (pctD >= 100 ? "var(--c-success)" : "var(--c-focus)") + ';"></div></div><div class="text-[10px] font-semibold uppercase mb-2" style="color:var(--c-sub);letter-spacing:0.05em;">Linked funding / warnings</div>' + (earmarkRows || '<div class="text-xs" style="color:var(--c-sub);">No allocations yet</div>') + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;"><span class="text-xs" style="color:var(--c-sub);">' + (rem > 0 ? "Rp" + fmt(rem) + " remaining" : "Goal reached!") + '</span><button class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium" style="background:rgba(122,170,206,0.10);color:var(--c-focus);" onclick="event.stopPropagation();showAddEarmark(' + idx + ')"><i data-lucide="plus" class="w-3 h-3"></i> Allocate</button></div></div>';
  }).join("");
  return '<h1 class="text-2xl font-bold" style="color:var(--c-primary);">Goals</h1><p class="page-subtitle">Financial goals, linked funding progress, and contribution planning</p>' +
    '<div class="card p-4 mb-4" style="display:flex;align-items:center;justify-content:space-between;"><div><div class="text-[10px] uppercase" style="color:var(--c-sub);">Total Funded</div><div class="mono text-lg font-bold text-[#355872]">Rp' + fmt(totalEarmarked) + '</div><div class="text-[9px] mt-0.5" style="color:var(--c-sub);">gross across ' + M.goals.length + ' goals</div></div><button class="btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-1.5" onclick="showAddGoal()"><i data-lucide="plus" class="w-4 h-4"></i> New Goal</button></div>' +
    (goalCards || '<div class="card-row"><span class="text-xs" style="color:var(--c-sub);">No goals yet</span></div>');
}

/* ── API & AI ── */

function renderPennyWise() {
  var s = M._pennywise || { enabled: true, counts: [], clients: [], recent_errors: [] };
  var counts = {}; (s.counts || []).forEach(function (r) { counts[r.sync_status] = r.count; });
  var clientRows = (s.clients || []).map(function (c) { return '<tr><td class="p-2 mono text-xs">' + esc(c.client_id) + '</td><td class="p-2 text-xs">' + esc(c.last_seen_at || '—') + '</td><td class="p-2 text-right mono">' + fmt(c.records) + '</td></tr>'; }).join('');
  var errorRows = (s.recent_errors || []).map(function (e) { return '<div class="card-row"><span class="mono text-xs">' + esc(e.client_transaction_id) + '</span><span class="text-xs flex-1" style="color:var(--c-danger);">' + esc(e.error_code || '') + ' ' + esc(e.error_message || '') + '</span><span class="text-[10px]" style="color:var(--c-sub);">' + esc(e.updated_at || '') + '</span></div>'; }).join('');
  return '<h1 class="text-2xl font-bold" style="color: var(--c-primary);">PennyWise Integration</h1><p class="page-subtitle">Reviewable SMS sync from PennyWise Android. API tokens are managed on API & AI and are never shown here.</p>' +
    '<div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5"><div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Enabled</div><div class="font-bold">' + (s.enabled ? 'Yes' : 'No') + '</div></div><div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Received</div><div class="font-bold mono">' + fmt(Object.keys(counts).reduce(function(a,k){return a+Number(counts[k]||0);},0)) + '</div></div><div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Created</div><div class="font-bold mono">' + fmt(counts.created || counts.already_synced || 0) + '</div></div><div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Duplicates</div><div class="font-bold mono">' + fmt(counts.possible_duplicate || 0) + '</div></div><div class="card p-4"><div class="text-[10px] uppercase" style="color:var(--c-sub)">Failed</div><div class="font-bold mono">' + fmt(counts.validation_failed || counts.mapping_missing || counts.server_error || 0) + '</div></div></div>' +
    '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4"><div class="card p-5"><div class="section-title">Connected client IDs</div><table class="w-full text-sm"><tbody>' + (clientRows || '<tr><td class="p-2 text-xs" style="color:var(--c-sub);">No clients yet</td></tr>') + '</tbody></table></div><div class="card p-5"><div class="section-title">Recent sync errors</div>' + (errorRows || '<div class="text-xs" style="color:var(--c-sub);">No recent errors</div>') + '</div></div>';
}
async function loadPennyWiseSummary() { try { M._pennywise = await api('/api/integrations/pennywise/summary'); M._pennywiseLoaded = true; var pc = document.getElementById('pageContent'); if (currentPage === 'pennywise' && pc) { pc.innerHTML = renderPennyWise(); if (window.lucide) lucide.createIcons(); } } catch(e) { toast(e.message, true); } }

function renderAPI() {
  var endpoints = [
    ["GET", "/api/dashboard", "Current month totals, health, budgets, cicilan"],
    ["POST", "/api/transactions", "Log a new transaction"],
    ["GET", "/api/transactions", "List transactions (filterable)"],
    ["GET", "/api/cicilan", "List all active installments"],
    ["GET", "/api/budgets", "Current month budgets with progress"],
    ["GET", "/api/net-worth", "Net worth time-series"],
    ["POST", "/api/integrations/pennywise/preview", "Preview PennyWise SMS transactions without creating movements"],
    ["POST", "/api/integrations/pennywise/movements", "Idempotently create approved Ledger movements from PennyWise"],
    ["GET", "/api/integrations/pennywise/status", "Reconcile PennyWise sync status by local IDs, fingerprints, dates, or status"],
  ];
  var apiCards = endpoints.map(function (e) {
    return '<div class="flex flex-col gap-1 py-2.5" style="border-bottom:1px solid rgba(53,88,114,0.04);"><div class="flex items-center gap-2 flex-wrap"><span class="px-1.5 py-0.5 rounded text-white font-mono" style="font-size: 10px; background: var(--c-primary);">' + e[0] + '</span><span class="mono text-xs break-all">' + e[1] + '</span></div><div class="text-xs" style="color: var(--c-sub);">' + e[2] + "</div></div>";
  }).join("");
  var tokenRows = (M._tokens || []).map(function (t) { return '<tr><td class="p-2">' + esc(t.label) + '</td><td class="p-2 mono text-xs">' + esc(t.prefix) + '</td><td class="p-2 text-xs" style="color:var(--c-sub);">' + (t.created_at || "").slice(0, 10) + '</td><td class="p-2"><button class="text-xs hover:underline" style="color:var(--c-danger);" onclick="revokeToken(' + t.id + ')">Revoke</button></td></tr>'; }).join("");
  return '<h1 class="text-2xl font-bold" style="color: var(--c-primary);">API & AI</h1><p class="page-subtitle">Manage API tokens and view integration docs for AI agents</p>' +
    '<div class="card p-5 mb-4"><div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3"><div class="section-title" style="margin-bottom:0;">Active Tokens</div><button class="btn-primary px-3 py-1.5 rounded-lg text-xs flex items-center justify-center gap-1 w-full sm:w-auto" onclick="generateToken()"><i data-lucide="plus" class="w-3.5 h-3.5"></i> Generate</button></div>' +
    '<div id="newTokenWrap"></div><div class="overflow-x-auto"><table class="w-full text-sm" style="min-width:380px"><thead><tr class="border-b" style="font-size:10px;color:var(--c-sub);text-transform:uppercase;letter-spacing:0.05em;border-color:rgba(53,88,114,0.08);"><th class="p-2 text-left">Label</th><th class="p-2 text-left">Prefix</th><th class="p-2 text-left">Created</th><th class="p-2"></th></tr></thead><tbody>' + (tokenRows || '<tr><td colspan="4" class="p-2 text-xs" style="color:var(--c-sub);">No tokens</td></tr>') + "</tbody></table></div></div>" +
    '<div class="card p-5"><div class="flex items-center justify-between mb-2"><div class="section-title" style="margin-bottom:0;">Quick Start</div><button class="text-xs flex items-center gap-1 px-2 py-1 rounded" style="color:var(--c-sub);background:rgba(53,88,114,0.04);" onclick="copyCode(\'apiQuickStart\')"><i data-lucide="copy" class="w-3 h-3"></i> Copy</button></div><pre id="apiQuickStart" class="code-block p-4 rounded-lg text-xs mb-4" style="background:#1e293b;color:#e2e8f0;">export KOTECASH_TOKEN="kote_..."\nexport KOTECASH_BASE="' + API_BASE + '"\n\ncurl -H "Authorization: Bearer $KOTECASH_TOKEN" \\\n     "$KOTECASH_BASE/api/dashboard"</pre><div class="section-title">Endpoints</div>' + apiCards + "</div>";
}
function copyCode(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var txt = el.textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast("Copied"); }, function () { toast("Copy failed", true); });
  else toast("Copy not supported", true);
}

/* =================================================================
   MODAL FORMS (wired to API)
   ================================================================= */
function fld(id, label, extra, val) {
  return '<div><label class="block text-xs mb-1" style="color:var(--c-sub);">' + label + "</label>" + extra.replace('id="__"', 'id="' + id + '"').replace('value="__"', 'value="' + (val != null ? val : "") + '"') + "</div>";
}
function inp(t) { return '<input type="' + t + '" class="w-full px-3 py-2 rounded-lg border text-sm" style="border-color:var(--c-focus);background:#fff;color:var(--c-ink);" id="__" value="__">'; }
function sel(opts) { return '<select class="w-full px-3 py-2 rounded-lg border text-sm" style="border-color:var(--c-focus);background:#fff;color:var(--c-ink);" id="__">' + opts + "</select>"; }
function saveBtn(label, onclick) { return '<button class="btn-primary w-full py-2 rounded-lg text-sm" onclick="' + onclick + '">' + label + "</button>"; }
function today() { return new Date().toISOString().slice(0, 10); }
function curMonth() { return new Date().toISOString().slice(0, 7); }

/* Transactions */
function showAddTransaction(editId) {
  var t = editId ? M.txns.find(function (x) { return x.id === editId; }) : null;
  var catOpts = M.expenseCats.concat(M.incomeCats).map(function (c) { return '<option ' + (t && t.cat === c ? "selected" : "") + ">" + esc(c) + "</option>"; }).join("");
  var methodOpts = ["Cash", "OVO", "GoPay", "Transfer", "BCA Debit", "CC BCA", "CC Tokped"].map(function (m) { return '<option ' + (t && t.method === m ? "selected" : "") + ">" + m + "</option>"; }).join("");
  openModal(t ? "Edit Transaction" : "Add Transaction",
    '<div style="display:flex;flex-direction:column;gap:12px;">' +
      fld("mfAmount", "Amount (IDR)", inp("number"), t ? t.amount : "") +
      '<div class="grid grid-cols-2 gap-3">' + fld("mfType", "Type", sel('<option value="expense" ' + (t && t.type === "expense" ? "selected" : "") + ">Expense</option><option value=\"income\" " + (t && t.type === "income" ? "selected" : "") + ">Income</option>")) + fld("mfDate", "Date", inp("date").replace('value=""', ""), t ? t.date : today()) + "</div>" +
      fld("mfCat", "Category", sel(catOpts)) +
      fld("mfMethod", "Payment Method", sel(methodOpts)) +
      fld("mfNotes", "Notes", inp("text"), t ? t.desc : "") +
      saveBtn(t ? "Save" : "Add Transaction", "saveTransaction(" + (editId || "0") + ")") +
    "</div>"
  );
}
async function saveTransaction(id) {
  var amount = parseInt(document.getElementById("mfAmount").value) || 0;
  if (!amount) return toast("Enter an amount", true);
  var body = { amount: amount, type: document.getElementById("mfType").value, date: document.getElementById("mfDate").value, category_id: catId(document.getElementById("mfCat").value), payment_method: document.getElementById("mfMethod").value, description: document.getElementById("mfNotes").value };
  try {
    if (id) await api("/api/transactions/" + id, { method: "PUT", body: body });
    else await api("/api/transactions", { method: "POST", body: body });
    closeModal(); await reload("ledger"); toast("Saved");
  } catch (e) { toast(e.message, true); }
}
async function editTransaction(id) { showAddTransaction(id); }
async function deleteTransaction(id) {
  if (!confirm("Delete this transaction?")) return;
  try { await api("/api/transactions/" + id, { method: "DELETE" }); await reload("ledger"); toast("Deleted"); } catch (e) { toast(e.message, true); }
}

/* Categories */
function showAddCategory() {
  openModal("Add Category", '<div style="display:flex;flex-direction:column;gap:12px;">' + fld("acName", "Name", inp("text")) + fld("acType", "Type", sel('<option value="expense">Expense</option><option value="income">Income</option>')) + saveBtn("Create", "saveCategory()") + "</div>");
}
async function saveCategory() {
  var name = document.getElementById("acName").value; if (!name) return;
  try { await api("/api/categories", { method: "POST", body: { name: name, type: document.getElementById("acType").value } }); closeModal(); await reload("categories"); toast("Created"); } catch (e) { toast(e.message, true); }
}
async function deleteCategory(id) {
  if (!confirm("Delete this category? Linked transactions lose their category.")) return;
  try { await api("/api/categories/" + id, { method: "DELETE" }); await reload("categories"); toast("Deleted"); } catch (e) { toast(e.message, true); }
}

/* Budgets */
function showSetBudget() {
  var catOpts = M.expenseCats.map(function (c) { return "<option>" + esc(c) + "</option>"; }).join("");
  openModal("Set Budget", '<div style="display:flex;flex-direction:column;gap:12px;">' + fld("sbCat", "Category", sel(catOpts)) + fld("sbAmt", "Monthly Budget (IDR)", inp("number")) + fld("sbMonth", "Month", inp("month").replace('value=""', ""), curMonth()) + saveBtn("Save", "saveBudget()") + "</div>");
}
async function saveBudget() {
  var amt = parseInt(document.getElementById("sbAmt").value) || 0; if (!amt) return;
  try { await api("/api/budgets", { method: "POST", body: { category_id: catId(document.getElementById("sbCat").value), amount: amt, budget_amount: amt, month: document.getElementById("sbMonth").value, budget_type: "monthly_category" } }); closeModal(); await reload("budgets"); toast("Saved"); } catch (e) { toast(e.message, true); }
}
async function deleteBudget(id) {
  if (!confirm("Delete this budget?")) return;
  try { await api("/api/budgets/" + id, { method: "DELETE" }); await reload("budgets"); toast("Deleted"); } catch (e) { toast(e.message, true); }
}

/* Cicilan */
function showAddCicilan() {
  openModal("Add Cicilan", '<div style="display:flex;flex-direction:column;gap:12px;">' + fld("ciName", "Name", inp("text")) + '<div class="grid grid-cols-2 gap-3">' + fld("ciTotal", "Total (IDR)", inp("number")) + fld("ciMonthly", "Monthly (IDR)", inp("number")) + "</div>" + '<div class="grid grid-cols-2 gap-3">' + fld("ciTenor", "Tenor (months)", inp("number")) + fld("ciInterest", "Interest (%)", inp("number")) + "</div>" + '<div class="grid grid-cols-2 gap-3">' + fld("ciStart", "Start Date", inp("date").replace('value=""', ""), today()) + fld("ciDue", "Due Date", inp("date").replace('value=""', ""), today()) + "</div>" + saveBtn("Save Cicilan", "saveCicilan()") + "</div>");
}
async function saveCicilan() {
  var body = { name: document.getElementById("ciName").value, total_utang: parseInt(document.getElementById("ciTotal").value) || 0, monthly_payment: parseInt(document.getElementById("ciMonthly").value) || 0, tenor_bulan: parseInt(document.getElementById("ciTenor").value) || 0, bunga_persen: parseFloat(document.getElementById("ciInterest").value) || 0, start_date: document.getElementById("ciStart").value, due_date: document.getElementById("ciDue").value };
  if (!body.name || !body.monthly_payment) return toast("Name and monthly required", true);
  try { await api("/api/cicilan", { method: "POST", body: body }); closeModal(); await reload("cicilan"); toast("Saved"); } catch (e) { toast(e.message, true); }
}
function showEditCicilan(idx) {
  var c = M.cicilan[idx]; if (!c) return;
  openModal("Edit " + c.name, '<div style="display:flex;flex-direction:column;gap:12px;">' + fld("ecTotal", "Total (IDR)", inp("number"), c.total) + fld("ecMonthly", "Monthly (IDR)", inp("number"), c.monthly) + fld("ecInterest", "Interest (%)", inp("number"), c.bunga) + saveBtn("Save", "saveEditCicilan(" + c.id + ")") + '<button class="w-full py-2 rounded-lg text-sm font-medium" style="background:rgba(196,75,75,0.08);color:var(--c-danger);" onclick="deleteCicilan(' + c.id + ')">Delete Cicilan</button>' + "</div>");
}
async function saveEditCicilan(id) {
  var body = { name: M.cicilan.find(function (c) { return c.id === id; }).name, total_utang: parseInt(document.getElementById("ecTotal").value) || 0, monthly_payment: parseInt(document.getElementById("ecMonthly").value) || 0, bunga_persen: parseFloat(document.getElementById("ecInterest").value) || 0, status: "active" };
  try { await api("/api/cicilan/" + id, { method: "PUT", body: body }); closeModal(); await reload("cicilan"); toast("Saved"); } catch (e) { toast(e.message, true); }
}
async function deleteCicilan(id) {
  if (!confirm("Delete this installment? Only fully paid installments can be deleted.")) return;
  try { await api("/api/cicilan/" + id, { method: "DELETE" }); closeModal(); await reload("cicilan"); toast("Deleted"); } catch (e) { toast(e.message, true); }
}

/* Credit Cards */
function showAddCreditCard() {
  openModal("Add Credit Card", '<div style="display:flex;flex-direction:column;gap:12px;">' + fld("ccName", "Name", inp("text")) + '<div class="grid grid-cols-2 gap-3">' + fld("ccLimit", "Limit (IDR)", inp("number")) + fld("ccBalance", "Balance (IDR)", inp("number")) + "</div>" + '<div class="grid grid-cols-2 gap-3">' + fld("ccStmt", "Statement Day", inp("number")) + fld("ccDue", "Due Day", inp("number")) + "</div>" + fld("ccInterest", "Interest %/mo", inp("number")) + saveBtn("Save", "saveCreditCard()") + "</div>");
}
async function saveCreditCard() {
  var body = { name: document.getElementById("ccName").value, limit_amount: parseInt(document.getElementById("ccLimit").value) || 0, balance: parseInt(document.getElementById("ccBalance").value) || 0, statement_day: parseInt(document.getElementById("ccStmt").value) || 1, due_day: parseInt(document.getElementById("ccDue").value) || 1, interest_rate: parseFloat(document.getElementById("ccInterest").value) || 0 };
  if (!body.name) return;
  try { await api("/api/credit-cards", { method: "POST", body: body }); closeModal(); await reload("creditcard"); toast("Saved"); } catch (e) { toast(e.message, true); }
}
function showEditCreditCard(idx) {
  var c = M.creditCards[idx]; if (!c) return;
  openModal("Edit " + c.name, '<div style="display:flex;flex-direction:column;gap:12px;">' + fld("eccBalance", "Balance", inp("number"), c.balance) + fld("eccLimit", "Limit", inp("number"), c.limit) + '<div class="grid grid-cols-2 gap-3">' + fld("eccStmt", "Statement Day", inp("number"), c.statementDay) + fld("eccDue", "Due Day", inp("number"), c.dueDay) + "</div>" + fld("eccInterest", "Interest %/mo", inp("number"), c.interestRate) + saveBtn("Save", "saveEditCreditCard(" + c.id + ")") + '<button class="w-full py-2 rounded-lg text-sm font-medium" style="background:rgba(196,75,75,0.08);color:var(--c-danger);" onclick="deleteCreditCard(' + c.id + ')">Delete Card</button>' + "</div>");
}
async function saveEditCreditCard(id) {
  var body = { name: M.creditCards.find(function (c) { return c.id === id; }).name, balance: parseInt(document.getElementById("eccBalance").value) || 0, limit_amount: parseInt(document.getElementById("eccLimit").value) || 0, statement_day: parseInt(document.getElementById("eccStmt").value) || 1, due_day: parseInt(document.getElementById("eccDue").value) || 1, interest_rate: parseFloat(document.getElementById("eccInterest").value) || 0, min_payment_pct: 10, annual_fee: 0 };
  try { await api("/api/credit-cards/" + id, { method: "PUT", body: body }); closeModal(); await reload("creditcard"); toast("Saved"); } catch (e) { toast(e.message, true); }
}
async function deleteCreditCard(id) {
  if (!confirm("Delete this credit card? Only card with 0 balance can be deleted.")) return;
  try { await api("/api/credit-cards/" + id, { method: "DELETE" }); closeModal(); await reload("creditcard"); toast("Deleted"); } catch (e) { toast(e.message, true); }
}

/* Deposits & Portfolios */
function showAddDeposit() {
  openModal("Add Deposit", '<div style="display:flex;flex-direction:column;gap:12px;">' + fld("adBank", "Bank", inp("text")) + '<div class="grid grid-cols-2 gap-3">' + fld("adAmount", "Amount (IDR)", inp("number")) + fld("adRate", "Rate % p.a.", inp("number")) + "</div>" + '<div class="grid grid-cols-2 gap-3">' + fld("adTenor", "Tenor (months)", inp("number")) + fld("adMaturity", "Maturity Date", inp("date").replace('value=""', ""), today()) + "</div>" + fld("adStart", "Start Date", inp("date").replace('value=""', ""), today()) + saveBtn("Save", "saveDeposit()") + "</div>");
}
async function saveDeposit() {
  var body = { bank: document.getElementById("adBank").value, amount: parseInt(document.getElementById("adAmount").value) || 0, rate: parseFloat(document.getElementById("adRate").value) || 0, tenor_months: parseInt(document.getElementById("adTenor").value) || 0, start_date: document.getElementById("adStart").value, maturity_date: document.getElementById("adMaturity").value };
  if (!body.bank) return;
  try { await api("/api/deposits", { method: "POST", body: body }); closeModal(); await reload("assets"); toast("Saved"); } catch (e) { toast(e.message, true); }
}
function showAddPortfolio() { openModal("Add Portfolio", '<div style="display:flex;flex-direction:column;gap:12px;">' + fld("apName", "Account Name", inp("text")) + fld("apValue", "Current Value (IDR)", inp("number")) + saveBtn("Save", "savePortfolio()") + "</div>"); }
async function savePortfolio() {
  var body = { name: document.getElementById("apName").value, value: parseInt(document.getElementById("apValue").value) || 0 }; if (!body.name) return;
  try { await api("/api/portfolios", { method: "POST", body: body }); closeModal(); await reload("assets"); toast("Saved"); } catch (e) { toast(e.message, true); }
}
function showEditPortfolio(idx) { var p = M.portfolios[idx]; if (!p) return; openModal("Edit " + p.name, '<div style="display:flex;flex-direction:column;gap:12px;">' + fld("epName", "Name", inp("text"), p.name) + fld("epValue", "Value (IDR)", inp("number"), p.value) + saveBtn("Save", "saveEditPortfolio(" + p.id + ")") + '<button class="w-full py-2 rounded-lg text-sm font-medium" style="background:rgba(196,75,75,0.08);color:var(--c-danger);" onclick="deletePortfolio(' + p.id + ')">Delete Portfolio</button>' + "</div>"); }
async function saveEditPortfolio(id) {
  var body = { name: document.getElementById("epName").value, value: parseInt(document.getElementById("epValue").value) || 0 };
  try { await api("/api/portfolios/" + id, { method: "PUT", body: body }); closeModal(); await reload("assets"); toast("Saved"); } catch (e) { toast(e.message, true); }
}
async function deletePortfolio(id) {
  if (!confirm("Delete this portfolio? Linked earmarks will be deleted.")) return;
  try { await api("/api/portfolios/" + id, { method: "DELETE" }); closeModal(); await reload("assets"); toast("Deleted"); } catch (e) { toast(e.message, true); }
}
function showEditDeposit(idx) {
  var d = M.deposits[idx]; if (!d) return;
  openModal("Edit Deposit at " + d.bank, '<div style="display:flex;flex-direction:column;gap:12px;">' +
    fld("edAmount", "Amount (IDR)", inp("number"), d.amount) +
    fld("edRate", "Rate % p.a.", inp("number"), d.rate) +
    fld("edTenor", "Tenor (months)", inp("number"), d.tenor) +
    saveBtn("Save", "saveEditDeposit(" + d.id + ")") +
    '<button class="w-full py-2 rounded-lg text-sm font-medium" style="background:rgba(196,75,75,0.08);color:var(--c-danger);" onclick="deleteDeposit(' + d.id + ')">Delete Deposit</button>' +
  '</div>');
}
async function saveEditDeposit(id) {
  var amt = parseInt(document.getElementById("edAmount").value) || 0;
  var rate = parseFloat(document.getElementById("edRate").value) || 0;
  var tenor = parseInt(document.getElementById("edTenor").value) || 0;
  if (!amt) return toast("Amount required", true);
  try {
    await api("/api/deposits/" + id, { method: "PUT", body: { amount: amt, rate: rate, tenor_months: tenor } });
    closeModal(); await reload("assets"); toast("Saved");
  } catch (e) { toast(e.message, true); }
}
async function deleteDeposit(id) {
  if (!confirm("Delete this deposit? Linked earmarks will be deleted.")) return;
  try { await api("/api/deposits/" + id, { method: "DELETE" }); closeModal(); await reload("assets"); toast("Deleted"); } catch (e) { toast(e.message, true); }
}

/* Wallets */
function showWalletActions(idx) {
  var w = M.wallets[idx]; if (!w) return;
  openModal(w.name + " actions",
    '<div style="display:flex;flex-direction:column;gap:8px;">' +
      '<button class="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium" style="background:rgba(74,140,111,0.08);color:var(--c-success);" onclick="closeModal();showWalletIncome(' + idx + ')"><i data-lucide="plus" class="w-4 h-4"></i> Add Income</button>' +
      '<button class="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium" style="background:rgba(196,75,75,0.08);color:var(--c-danger);" onclick="closeModal();showWalletExpense(' + idx + ')"><i data-lucide="minus" class="w-4 h-4"></i> Record Expense</button>' +
      '<button class="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium" style="background:rgba(122,170,206,0.08);color:var(--c-focus);" onclick="closeModal();showTransfer()"><i data-lucide="arrow-left-right" class="w-4 h-4"></i> Transfer</button>' +
      '<button class="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium" style="background:rgba(53,88,114,0.04);color:var(--c-ink);" onclick="closeModal();showEditWallet(' + idx + ')"><i data-lucide="pencil" class="w-4 h-4"></i> Edit Wallet</button>' +
    "</div>"
  );
}
function showTransfer() {
  var opts = M.wallets.map(function (w) { return "<option>" + esc(w.name) + "</option>"; }).join("");
  openModal("Transfer", '<div style="display:flex;flex-direction:column;gap:12px;"><div class="grid grid-cols-2 gap-3">' + fld("tfFrom", "From", sel(opts)) + fld("tfTo", "To", sel(opts)) + "</div>" + fld("tfAmount", "Amount (IDR)", inp("number")) + fld("tfNotes", "Notes", inp("text")) + saveBtn("Transfer", "doTransfer()") + "</div>");
}
async function doTransfer() {
  var from = document.getElementById("tfFrom").value, to = document.getElementById("tfTo").value, amt = parseInt(document.getElementById("tfAmount").value) || 0;
  if (!amt || from === to) return toast("Enter amount and pick different wallets", true);
  try { await api("/api/wallets/transfer", { method: "POST", body: { from_wallet_id: WMAP[from], to_wallet_id: WMAP[to], amount: amt, notes: document.getElementById("tfNotes").value } }); closeModal(); await reload("wallets"); toast("Transferred"); } catch (e) { toast(e.message, true); }
}
function showWalletIncome(idx) { var w = M.wallets[idx]; if (!w) return; var opts = M.incomeCats.map(function (c) { return "<option>" + esc(c) + "</option>"; }).join(""); openModal("Add Income to " + w.name, '<div style="display:flex;flex-direction:column;gap:12px;">' + fld("wiAmt", "Amount", inp("number")) + '<div class="grid grid-cols-2 gap-3">' + fld("wiCat", "Category", sel(opts)) + fld("wiDate", "Date", inp("date").replace('value=""', ""), today()) + "</div>" + fld("wiDesc", "Notes", inp("text")) + saveBtn("Add Income", "doWalletIncome(" + w.id + ")") + "</div>"); }
async function doWalletIncome(id) {
  var amt = parseInt(document.getElementById("wiAmt").value) || 0; if (!amt) return;
  try { await api("/api/wallets/" + id + "/income", { method: "POST", body: { amount: amt, category_id: catId(document.getElementById("wiCat").value), date: document.getElementById("wiDate").value, description: document.getElementById("wiDesc").value } }); closeModal(); await reload("wallets"); toast("Saved"); } catch (e) { toast(e.message, true); }
}
function showWalletExpense(idx) { var w = M.wallets[idx]; if (!w) return; var opts = M.expenseCats.map(function (c) { return "<option>" + esc(c) + "</option>"; }).join(""); openModal("Spend from " + w.name, '<div style="display:flex;flex-direction:column;gap:12px;">' + fld("weAmt", "Amount", inp("number")) + '<div class="grid grid-cols-2 gap-3">' + fld("weCat", "Category", sel(opts)) + fld("weDate", "Date", inp("date").replace('value=""', ""), today()) + "</div>" + fld("weDesc", "Notes", inp("text")) + saveBtn("Record Expense", "doWalletExpense(" + w.id + ")") + "</div>"); }
async function doWalletExpense(id) {
  var amt = parseInt(document.getElementById("weAmt").value) || 0; if (!amt) return;
  try { var r = await api("/api/wallets/" + id + "/expense", { method: "POST", body: { amount: amt, category_id: catId(document.getElementById("weCat").value), date: document.getElementById("weDate").value, description: document.getElementById("weDesc").value } }); closeModal(); if (r.warning) { await reload("wallets"); alert("Warning: Spending Rp" + fmt(r.warning.amount) + " exceeds free balance (Rp" + fmt(r.warning.free) + "). Rp" + fmt(r.warning.into) + " will come from earmarked goals: " + (r.warning.impactedGoals.join(", ") || "none")); } else { await reload("wallets"); toast("Saved"); } } catch (e) { toast(e.message, true); }
}
function showEditWallet(idx) { var w = M.wallets[idx]; if (!w) return; openModal("Edit " + w.name, '<div style="display:flex;flex-direction:column;gap:12px;">' + fld("ewName", "Name", inp("text"), w.name) + fld("ewNum", "Account Number", inp("text"), w.number || "") + saveBtn("Save", "doEditWallet(" + w.id + ")") + '<button class="w-full py-2 rounded-lg text-sm font-medium" style="background:rgba(196,75,75,0.08);color:var(--c-danger);" onclick="deleteWallet(' + w.id + ')">Delete Wallet</button>' + "</div>"); }
async function doEditWallet(id) { var body = { name: document.getElementById("ewName").value, account_number: document.getElementById("ewNum").value }; try { await api("/api/wallets/" + id, { method: "PUT", body: body }); closeModal(); await reload("wallets"); toast("Saved"); } catch (e) { toast(e.message, true); } }
async function deleteWallet(id) { if (!confirm("Delete this wallet? Linked transactions and earmarks will be deleted.")) return; try { await api("/api/wallets/" + id, { method: "DELETE" }); closeModal(); await reload("wallets"); toast("Deleted"); } catch (e) { toast(e.message, true); } }
function showAddWallet() { var typeOpts = '<option value="bank">Bank</option><option value="e-wallet">E-Wallet</option><option value="cash">Cash</option>'; openModal("Add Wallet", '<div style="display:flex;flex-direction:column;gap:12px;">' + fld("awName", "Name", inp("text")) + fld("awType", "Type", sel(typeOpts)) + fld("awNum", "Account Number", inp("text")) + fld("awBal", "Initial Balance (IDR)", inp("number")) + saveBtn("Create Wallet", "saveWallet()") + '</div>'); }
async function saveWallet() { var name = document.getElementById("awName").value, type = document.getElementById("awType").value, num = document.getElementById("awNum").value, bal = parseInt(document.getElementById("awBal").value) || 0; if (!name) return toast("Name required", true); try { await api("/api/wallets", { method: "POST", body: { name: name, type: type, account_number: num, initial_balance: bal } }); closeModal(); await reload("wallets"); toast("Created"); } catch (e) { toast(e.message, true); } }

/* Goals & Earmarks */
function showAddGoal() {
  var icons = ["graduation-cap", "map", "shield", "home", "heart", "briefcase", "car", "plane", "target"];
  var types = ["emergency_fund","retirement","child_education","home_purchase","vehicle_purchase","debt_payoff","vacation","wedding","major_purchase","custom"]; openModal("New Goal", '<div style="display:flex;flex-direction:column;gap:12px;">' + fld("ngType", "Goal Type", sel(types.map(function (i) { return '<option value="' + i + '">' + i.replace(/_/g," ") + "</option>"; }).join(""))) + fld("ngName", "Goal Name", inp("text")) + fld("ngTarget", "Target (IDR)", inp("number")) + fld("ngDate", "Target Date", inp("date")) + fld("ngPriority", "Priority", sel('<option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option>')) + fld("ngMode", "Funding Mode", sel('<option value="manual">Manual</option><option value="linked_assets">Linked assets</option><option value="hybrid">Hybrid</option>')) + fld("ngManual", "Current Manual Amount", inp("number")) + saveBtn("Create Goal", "doAddGoal()") + "</div>");
}
async function doAddGoal() { var name = document.getElementById("ngName").value, target = parseInt(document.getElementById("ngTarget").value) || 0; if (!name || !target) return; try { await api("/api/goals", { method: "POST", body: { name: name, goal_type: document.getElementById("ngType").value, target_amount: target, target_date: document.getElementById("ngDate").value || null, priority: document.getElementById("ngPriority").value, funding_mode: document.getElementById("ngMode").value, current_manual_amount: parseInt(document.getElementById("ngManual").value) || 0 } }); closeModal(); await reload("goals"); toast("Created"); } catch (e) { toast(e.message, true); } }
function showEditGoal(idx) {
  var g = M.goals[idx]; if (!g) return;
  var icons = ["graduation-cap", "map", "shield", "home", "heart", "briefcase", "car", "plane", "target"];
  var iconOpts = icons.map(function (i) { return '<option value="' + i + '" ' + (g.icon === i ? "selected" : "") + '>' + i + '</option>'; }).join("");
  openModal("Edit Goal", '<div style="display:flex;flex-direction:column;gap:12px;">' +
    fld("egName", "Goal Name", inp("text"), g.name) +
    fld("egTarget", "Target (IDR)", inp("number"), g.target) +
    fld("egIcon", "Icon", sel(iconOpts)) +
    saveBtn("Save", "saveEditGoal(" + g.id + ")") +
    '<button class="w-full py-2 rounded-lg text-sm font-medium" style="background:rgba(196,75,75,0.08);color:var(--c-danger);" onclick="deleteGoal(' + g.id + ')">Delete Goal</button>' +
  '</div>');
}
async function saveEditGoal(id) {
  var name = document.getElementById("egName").value;
  var target = parseInt(document.getElementById("egTarget").value) || 0;
  var icon = document.getElementById("egIcon").value;
  if (!name || !target) return toast("Name and target required", true);
  try {
    await api("/api/goals/" + id, { method: "PUT", body: { name: name, target_amount: target, icon: icon } });
    closeModal(); await reload("goals"); toast("Saved");
  } catch (e) { toast(e.message, true); }
}
async function deleteGoal(id) {
  if (!confirm("Delete this goal? Earmarked funds will return to sources.")) return;
  try {
    await api("/api/goals/" + id, { method: "DELETE" });
    closeModal(); await reload("goals"); toast("Deleted");
  } catch (e) { toast(e.message, true); }
}
function showAddEarmark(goalIdx) {
  var g = M.goals[goalIdx]; if (!g) return;
  var sources = [].concat(M.wallets.map(function (w) { return w.name; }), M.deposits.map(function (d) { return d.bank; }), M.portfolios.map(function (p) { return p.name; }));
  openModal("Allocate to " + g.name, '<div style="display:flex;flex-direction:column;gap:12px;">' + fld("aeSource", "Source", sel(sources.map(function (s) { return "<option>" + esc(s) + "</option>"; }).join(""))) + fld("aeAmt", "Amount (IDR)", inp("number")) + saveBtn("Allocate", "doAddEarmark(" + g.id + ")") + "</div>");
}
async function doAddEarmark(goalId) {
  var src = document.getElementById("aeSource").value, amt = parseInt(document.getElementById("aeAmt").value) || 0; if (!amt) return;
  var s = sourceTypeAndId(src); if (!s) return toast("Unknown source", true);
  try { await api("/api/goals/" + goalId + "/allocate", { method: "POST", body: { source_type: s.source_type, source_id: s.source_id, amount: amt } }); closeModal(); await reload("goals"); toast("Allocated"); } catch (e) { toast(e.message, true); }
}
async function deleteEarmark(id) { try { await api("/api/earmarks/" + id, { method: "DELETE" }); await reload("goals"); toast("Removed"); } catch (e) { toast(e.message, true); } }

/* Account */
async function changePassword() { var p = document.getElementById("acctPwd").value; if (!p) return; try { await api("/api/account/password", { method: "PUT", body: { password: p } }); toast("Password updated"); } catch (e) { toast(e.message, true); } }
async function loadAccountInfo() { try { var me = await api("/api/auth/me"); var u = me.user; document.getElementById("acctInfo").innerHTML = '<div><span style="color: var(--c-sub);">Email:</span> ' + esc(u.email) + '</div><div><span style="color: var(--c-sub);">Created:</span> ' + (u.created_at || "").slice(0, 10) + "</div>"; } catch (e) {} }

/* Tokens */
async function generateToken() {
  var label = prompt("Token label?", "hermes-agent"); if (!label) return;
  try { var r = await api("/api/tokens", { method: "POST", body: { label: label } }); document.getElementById("newTokenWrap").innerHTML = '<div class="mb-3 p-3 rounded-lg" style="background:rgba(74,140,111,0.06);"><div class="text-[10px] uppercase mb-1" style="color:var(--c-sub);">Token (shown once)</div><code class="text-xs break-all">' + esc(r.token) + "</code></div>"; await loadTokens(); } catch (e) { toast(e.message, true); }
}
async function loadTokens() { try { M._tokens = await api("/api/tokens"); navigate("api"); } catch (e) {} }
async function revokeToken(id) { if (!confirm("Revoke this token?")) return; try { await api("/api/tokens/" + id, { method: "DELETE" }); await loadTokens(); toast("Revoked"); } catch (e) { toast(e.message, true); } }

/* Logout */
async function doLogout() { try { await api("/api/auth/logout", { method: "POST" }); } catch (e) {} window.location.href = "/login"; }

/* =================================================================
   BOOTSTRAP
   ================================================================= */
async function boot() {
  document.getElementById("logout-btn")?.addEventListener("click", doLogout);
  try { await loadAll(); } catch (e) { return; }
  navigate(pageFromUrl(), false);
}
document.addEventListener("DOMContentLoaded", boot);

function renderReconcile(){
  setTimeout(loadReconcilePage,0);
  return '<div class="space-y-4 reconcile-page">'+
    '<div><h1 class="text-2xl font-bold">Reconcile</h1><p class="text-sm text-[var(--c-sub)]">Account balance snapshots, statement-period matching, discrepancies, and reconciliation history.</p></div>'+
    '<div class="flex gap-2 overflow-x-auto no-scrollbar"><button class="btn" onclick="reconcileTab(\'overview\')">Overview</button><button class="btn" onclick="reconcileTab(\'start\')">Start Reconciliation</button><button class="btn" onclick="reconcileTab(\'progress\')">In Progress</button><button class="btn" onclick="reconcileTab(\'history\')">History</button><button class="btn" onclick="reconcileTab(\'snapshots\')">Balance Snapshots</button></div>'+
    '<div id="reconcileContent" class="space-y-3"><p class="text-sm text-[var(--c-sub)]">Loading…</p></div></div>';
}
var _recon={tab:'overview',data:null};
async function loadReconcilePage(){ if(currentPage!=='reconcile')return; try{ var rs=await api('/api/account-reconciliations'); var ss=await api('/api/account-balances/snapshots'); _recon.data={reconciliations:rs.reconciliations||[],snapshots:ss.snapshots||[]}; reconcileTab(_recon.tab||'overview'); }catch(e){ toast(e.message,true); } }
function reconcileTab(t){ _recon.tab=t; var el=document.getElementById('reconcileContent'); if(!el)return; var d=_recon.data||{reconciliations:[],snapshots:[]};
 if(t==='overview'){ var active=d.reconciliations.filter(function(r){return !r.locked&&r.status!=='cancelled'}); el.innerHTML='<div class="grid grid-cols-2 md:grid-cols-5 gap-2">'+['Reconciled accounts','Unreconciled accounts','Total discrepancy','Stale balances','Unmatched transactions'].map(function(x,i){return '<div class="card p-3"><div class="text-xs text-[var(--c-sub)]">'+x+'</div><div class="text-xl font-bold">'+(i===0?d.reconciliations.filter(function(r){return r.status==='reconciled'||r.status==='locked'}).length:i===2?fmtMoney(d.reconciliations.reduce(function(s,r){return s+(r.difference||0)},0)):active.length)+'</div></div>';}).join('')+'</div>'+walletStatusCards(); }
 else if(t==='start'){ el.innerHTML='<div class="card p-4 space-y-3 max-w-xl"><h2 class="font-bold">Start Reconciliation</h2>'+fld('recWallet','Wallet',sel((M.wallets||[]).map(function(w){return '<option value="'+w.id+'">'+esc(w.name)+'</option>';}).join('')))+ '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">'+fld('recStart','Period start',inp('date'))+fld('recEnd','Period end',inp('date'))+'</div><div class="grid grid-cols-1 sm:grid-cols-2 gap-3">'+fld('recOpen','Opening balance',inp('number'))+fld('recClose','Statement closing',inp('number'))+'</div>'+fld('recNotes','Notes',inp('text'))+'<button class="btn btn-primary w-full" onclick="createRecon()">Preview Reconciliation</button><p class="text-xs text-[var(--c-sub)]">Flow: select wallet, period, balances, optional import batch, preview, auto-match, resolve, reconcile, then lock.</p></div>'; }
 else if(t==='progress'){ el.innerHTML=renderReconList(d.reconciliations.filter(function(r){return !r.locked&&r.status!=='cancelled'})); }
 else if(t==='history'){ el.innerHTML=renderReconList(d.reconciliations); }
 else { el.innerHTML='<div class="card overflow-hidden"><div class="p-3 font-bold">Balance Snapshots</div>'+(d.snapshots.map(function(s){return '<div class="p-3 border-t border-[var(--c-border)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"><div><b>'+esc(s.wallet_name||s.wallet_id)+'</b><div class="text-xs text-[var(--c-sub)]">'+s.snapshot_date+' • '+s.source+' • '+(s.statement_period_start||'')+' '+(s.statement_period_end||'')+'</div></div><div class="font-mono">'+fmtMoney(s.balance)+'</div></div>';}).join('')||'<p class="p-3 text-sm text-[var(--c-sub)]">No snapshots yet.</p>')+'</div>'; }
}
function walletStatusCards(){ return '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">'+(M.wallets||[]).map(function(w){return '<div class="card p-3"><div class="flex justify-between gap-3"><div><b>'+esc(w.name)+'</b><div class="text-xs text-[var(--c-sub)]">calculated balance</div></div><div class="font-mono">'+fmtMoney(w.balance||0)+'</div></div><a class="btn mt-3 inline-flex" href="/?page=reconcile">Reconcile</a></div>';}).join('')+'</div>'; }
function renderReconList(rows){ return '<div class="space-y-2">'+(rows.map(function(r){return '<div class="card p-3"><div class="flex flex-col sm:flex-row sm:justify-between gap-2"><div><b>'+esc(r.wallet_name||r.wallet_id)+'</b><div class="text-xs text-[var(--c-sub)]">'+r.period_start+' → '+r.period_end+' • '+r.status+(r.locked?' • locked':'')+'</div></div><div class="font-mono">Diff '+fmtMoney(r.difference||0)+'</div></div><div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mt-3"><div>Opening<br><b>'+fmtMoney(r.opening_balance||0)+'</b></div><div>Statement<br><b>'+fmtMoney(r.statement_closing_balance||0)+'</b></div><div>Calculated<br><b>'+fmtMoney(r.expected_closing_balance||0)+'</b></div><div>Matched<br><b>'+(r.matched_count||0)+'</b></div></div><div class="mt-3 flex gap-2 flex-wrap"><button class="btn" onclick="previewRecon('+r.id+')">Preview</button><button class="btn" onclick="autoMatchRecon('+r.id+')">Auto-match</button><button class="btn" onclick="lockRecon('+r.id+')">Lock</button></div></div>';}).join('')||'<p class="text-sm text-[var(--c-sub)]">No reconciliations.</p>')+'</div>'; }
async function createRecon(){ try{ var body={wallet_id:Number(val('recWallet')),period_start:val('recStart'),period_end:val('recEnd'),opening_balance:Number(val('recOpen')),statement_closing_balance:Number(val('recClose')),notes:val('recNotes')}; await api('/api/account-reconciliations',{method:'POST',body:body}); toast('Reconciliation started'); await loadReconcilePage(); reconcileTab('progress'); }catch(e){toast(e.message,true);} }
async function previewRecon(id){ try{ var p=await api('/api/account-reconciliations/'+id+'/preview',{method:'POST'}); openModal('Reconciliation preview','<pre class="text-xs overflow-auto">'+esc(JSON.stringify(p,null,2))+'</pre>'); }catch(e){toast(e.message,true);} }
async function autoMatchRecon(id){ try{ var r=await api('/api/account-reconciliations/'+id+'/auto-match',{method:'POST'}); toast('Matched '+r.matched+' rows'); await loadReconcilePage(); }catch(e){toast(e.message,true);} }
async function lockRecon(id){ if(!confirm('Lock this reconciliation? Unlock is required before recalculation.'))return; try{ await api('/api/account-reconciliations/'+id+'/lock',{method:'POST'}); toast('Locked'); await loadReconcilePage(); }catch(e){toast(e.message,true);} }
