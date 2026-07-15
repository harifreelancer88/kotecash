import type { D1Database } from '@cloudflare/workers-types';

export const INCOME_TYPES = ['salary','freelance','business','rental','interest','dividend','pension','government_benefit','bonus','reimbursement','refund','other'] as const;
export const VARIABILITY = ['fixed','variable','irregular'] as const;
export const FREQUENCIES = ['weekly','fortnightly','monthly','quarterly','half_yearly','yearly','irregular','one_time'] as const;
export const OCCURRENCE_STATUSES = ['expected','due_soon','due_today','received','partially_received','overdue','skipped','cancelled','unmatched'] as const;
const OWNED = new Set(['wallet','deposit','portfolio','credit_card','cicilan']);
const ORDINARY_TYPES = new Set(['salary','freelance','business','rental','interest','dividend','pension','government_benefit','bonus','other']);
const DAY_MS = 86400000;
const n = (v:any, fb=0) => { const x=Number(v); return Number.isFinite(x) ? x : fb; };
const nullableInt = (v:any) => v === undefined || v === null || v === '' ? null : Math.round(n(v, NaN));
const iso = (d:Date) => d.toISOString().slice(0,10);
export function endOfMonth(month:string){ const [y,m]=month.split('-').map(Number); return iso(new Date(Date.UTC(y,m,0))); }
export function addDays(date:string, days:number){ const d=new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return iso(d); }
function clampDay(y:number,m0:number,day:number){ return Math.min(day, new Date(Date.UTC(y,m0+1,0)).getUTCDate()); }
export function classifyIncomeType(type:string){
  if(['salary','freelance','pension','government_benefit','bonus'].includes(type)) return 'earned_income';
  if(['rental'].includes(type)) return 'business_income';
  if(['interest','dividend'].includes(type)) return 'investment_income';
  if(type==='reimbursement') return 'reimbursement';
  if(type==='refund') return 'refund';
  return 'other';
}
export function validateSourceInput(body:any, partial=false){
  const errors:string[]=[]; const type=body.income_type; const freq=body.frequency ?? body.payroll_frequency;
  if(!partial || type!==undefined) if(!INCOME_TYPES.includes(type)) errors.push('Unsupported income_type');
  if(!partial || body.name!==undefined) if(!String(body.name||'').trim()) errors.push('name is required');
  if(body.amount_variability!==undefined && !VARIABILITY.includes(body.amount_variability)) errors.push('Unsupported amount_variability');
  if(freq!==undefined && !FREQUENCIES.includes(freq)) errors.push('Unsupported frequency');
  for(const k of ['expected_amount','expected_gross_credit','expected_net_credit','fixed_component','variable_component','expected_min_amount','conservative_estimate','base_estimate','optimistic_estimate']){ const v=body[k]; if(v!==undefined && v!==null && (!Number.isFinite(Number(v)) || Number(v)<0)) errors.push(`${k} must be non-negative finite`); }
  for(const k of ['expected_day','salary_day']){ const v=body[k]; if(v!==undefined && v!==null && (!Number.isInteger(Number(v)) || Number(v)<1 || Number(v)>31)) errors.push(`${k} must be between 1 and 31`); }
  if(body.expected_bonus_month!==undefined && body.expected_bonus_month!==null && (Number(body.expected_bonus_month)<1 || Number(body.expected_bonus_month)>12)) errors.push('expected_bonus_month must be 1-12');
  if(body.probability!==undefined && body.probability!==null && (!Number.isFinite(Number(body.probability)) || Number(body.probability)<0 || Number(body.probability)>1)) errors.push('probability must be 0-1');
  if(body.start_date && body.end_date && body.end_date < body.start_date) errors.push('end_date cannot precede start_date');
  if(body.effective_from && body.effective_to && body.effective_to < body.effective_from) errors.push('effective_to cannot precede effective_from');
  return errors;
}
export async function verifyLinks(db:D1Database,userId:number,body:any){
  if(body.linked_wallet_id){ const w=await db.prepare('SELECT id FROM wallets WHERE user_id=? AND id=?').bind(userId, body.linked_wallet_id).first(); if(!w) return 'linked_wallet_id not found'; }
  if(body.linked_category_id){ const c=await db.prepare('SELECT id,type FROM categories WHERE user_id=? AND id=?').bind(userId, body.linked_category_id).first<any>(); if(!c) return 'linked_category_id not found'; }
  return null;
}
export function sourcePayload(body:any){
  const fields=['name','income_type','institution_or_payer','account_number_masked','currency','expected_amount','amount_variability','frequency','expected_day','start_date','end_date','active','include_in_forecast','linked_wallet_id','linked_category_id','notes','metadata_json','employer','salary_account','expected_gross_credit','expected_net_credit','salary_day','payroll_frequency','fixed_component','variable_component','expected_bonus_month','reimbursement_behavior','expected_min_amount','conservative_estimate','base_estimate','optimistic_estimate','probability','planned_invoice_date','expected_payment_date','payer_client','invoice_reference','effective_from','effective_to'];
  const out:any={}; for(const f of fields) if(body[f]!==undefined) out[f]=body[f];
  for(const f of Object.keys(out)) if(f.includes('amount')||['expected_gross_credit','expected_net_credit','fixed_component','variable_component','conservative_estimate','base_estimate','optimistic_estimate','active','include_in_forecast','expected_day','salary_day','expected_bonus_month'].includes(f)) out[f]=nullableInt(out[f]);
  out.currency ||= 'IDR'; out.amount_variability ||= 'fixed'; out.frequency ||= out.payroll_frequency || 'monthly'; out.active = out.active === undefined ? 1 : (out.active ? 1 : 0); out.include_in_forecast = out.include_in_forecast === undefined ? 1 : (out.include_in_forecast ? 1 : 0);
  if(out.metadata_json && typeof out.metadata_json !== 'string') out.metadata_json=JSON.stringify(out.metadata_json);
  return out;
}
export function nextDates(src:any, from:string, to:string, limit=370){
  const out:string[]=[]; if(['irregular'].includes(src.frequency)) return out;
  const start = src.start_date && src.start_date > from ? src.start_date : from; const end = src.end_date && src.end_date < to ? src.end_date : to;
  const stepMonths = src.frequency==='monthly'?1:src.frequency==='quarterly'?3:src.frequency==='half_yearly'?6:src.frequency==='yearly'?12:0;
  if(src.frequency==='one_time'){ const d=src.expected_payment_date || src.start_date || start; if(d>=from && d<=to) out.push(d); return out; }
  if(stepMonths){ const day=n(src.expected_day||src.salary_day||1,1); let d=new Date(`${start}T00:00:00Z`); for(let i=0;i<limit && iso(d)<=end;i++){ const y=d.getUTCFullYear(), m=d.getUTCMonth(); const cand=iso(new Date(Date.UTC(y,m,clampDay(y,m,day)))); if(cand>=start && cand<=end) out.push(cand); d=new Date(Date.UTC(y,m+stepMonths,1)); } return out; }
  const step = src.frequency==='weekly'?7:14; let cur=start; for(let i=0;i<limit && cur<=end;i++){ out.push(cur); cur=addDays(cur,step); } return out;
}
export function expectedAmount(src:any, date?:string, scenario:'conservative'|'base'|'optimistic'='base'){
  if(src.income_type==='salary') return n(src.expected_net_credit ?? src.expected_amount ?? src.base_estimate);
  if(scenario==='conservative') return n(src.conservative_estimate ?? src.expected_min_amount ?? src.expected_amount ?? src.base_estimate);
  if(scenario==='optimistic') return n(src.optimistic_estimate ?? src.base_estimate ?? src.expected_amount);
  return n(src.base_estimate ?? src.expected_amount ?? src.conservative_estimate ?? src.optimistic_estimate);
}
export function occurrenceKey(sourceId:number,date:string){ return `${sourceId}:${date}`; }
export async function generateOccurrences(db:D1Database,userId:number,sourceId:number,from:string,to:string,limit=370){
  const src=await db.prepare('SELECT * FROM income_sources WHERE user_id=? AND id=?').bind(userId,sourceId).first<any>(); if(!src) throw new Error('Income source not found');
  const boundedTo = addDays(from, Math.min(Math.ceil((new Date(`${to}T00:00:00Z`).getTime()-new Date(`${from}T00:00:00Z`).getTime())/DAY_MS), limit));
  const dates=nextDates(src,from,boundedTo,limit); let created=0;
  for(const d of dates){ const amount=expectedAmount(src,d,'base'); const key=occurrenceKey(sourceId,d); const r=await db.prepare(`INSERT OR IGNORE INTO expected_income_occurrences (user_id,income_source_id,occurrence_key,expected_date,expected_amount,status,source) VALUES (?,?,?,?,?,?, 'generated')`).bind(userId,sourceId,key,d,amount,statusForDate(d)).run(); created += r.meta?.changes || 0; }
  return {source_id:sourceId, from, to:boundedTo, requested_to:to, generated:dates.length, created, bounded:true};
}
export function statusForDate(date:string,today=iso(new Date())){ if(date===today) return 'due_today'; if(date<today) return 'overdue'; const diff=(new Date(`${date}T00:00:00Z`).getTime()-new Date(`${today}T00:00:00Z`).getTime())/DAY_MS; return diff<=7?'due_soon':'expected'; }
export async function actualIncomeMovements(db:D1Database,userId:number,from:string,to:string){
  return (await db.prepare(`SELECT m.*, c.name category_name, c.type category_type, cc.classification FROM movements m LEFT JOIN categories c ON c.id=m.category_id AND c.user_id=m.user_id LEFT JOIN category_classifications cc ON cc.category_id=m.category_id AND cc.user_id=m.user_id WHERE m.user_id=? AND m.date BETWEEN ? AND ? AND COALESCE(m.status,'active')='active' AND m.src_kind IS NULL AND m.dst_kind IS NOT NULL ORDER BY m.date,m.id`).bind(userId,from,to).all<any>()).results || [];
}
export function movementClassification(m:any){ const text=`${m.category_name||''} ${m.description||''}`.toLowerCase(); if(OWNED.has(m.src_kind)&&OWNED.has(m.dst_kind)) return 'transfer'; if(/loan|pinjaman|proceeds/.test(text)) return 'loan_proceeds'; if(/refund|reversal|cashback/.test(text)) return 'refund'; if(/reimburse/.test(text)) return 'reimbursement'; if(m.dst_kind==='portfolio'||/redeem|redemption|withdraw investment/.test(text)) return 'transfer'; return m.classification==='income' || m.category_type==='income' ? 'earned_income' : 'other'; }
export function includeActualIncome(m:any){ return m.src_kind==null && OWNED.has(m.dst_kind) && !['refund','reimbursement','loan_proceeds','transfer'].includes(movementClassification(m)); }
export function confidence(src:any, occ:any, m:any){ let score=0; if(n(m.amount)===n(occ.expected_amount)) score+=45; else if(Math.abs(n(m.amount)-n(occ.expected_amount))<=Math.max(1000,n(occ.expected_amount)*0.05)) score+=30; const dd=Math.abs((new Date(`${m.date}T00:00:00Z`).getTime()-new Date(`${occ.expected_date}T00:00:00Z`).getTime())/DAY_MS); if(dd===0) score+=25; else if(dd<=3) score+=18; else if(dd<=7) score+=10; if(src.linked_wallet_id && m.dst_kind==='wallet' && n(m.dst_id)===n(src.linked_wallet_id)) score+=15; if(src.linked_category_id && n(m.category_id)===n(src.linked_category_id)) score+=10; const hay=String(`${m.description||''} ${m.reference_number||''}`).toLowerCase(); const payer=String(`${src.institution_or_payer||''} ${src.employer||''} ${src.payer_client||''}`).trim().toLowerCase(); if(payer && hay.includes(payer.split(/\s+/)[0])) score+=10; return score>=90?'exact':score>=70?'high':score>=45?'medium':score>0?'low':'unmatched'; }
export async function candidates(db:D1Database,userId:number,occId:number){ const occ=await db.prepare('SELECT o.*, s.* FROM expected_income_occurrences o JOIN income_sources s ON s.id=o.income_source_id AND s.user_id=o.user_id WHERE o.user_id=? AND o.id=?').bind(userId,occId).first<any>(); if(!occ) throw new Error('Occurrence not found'); const from=addDays(occ.expected_date,-10), to=addDays(occ.expected_date,10); const used=(await db.prepare('SELECT movement_id FROM income_occurrence_allocations WHERE user_id=?').bind(userId).all<any>()).results.map((r:any)=>r.movement_id); return (await actualIncomeMovements(db,userId,from,to)).filter(m=>!used.includes(m.id)||m.id===occ.matched_movement_id).map(m=>({movement:m, confidence:confidence(occ,occ,m), amount_difference:n(m.amount)-n(occ.expected_amount), date_difference_days:Math.round((new Date(`${m.date}T00:00:00Z`).getTime()-new Date(`${occ.expected_date}T00:00:00Z`).getTime())/DAY_MS)})); }
export async function summary(db:D1Database,userId:number,from:string,to:string,scenario:'conservative'|'base'|'optimistic'='base'){
  const [sources, occRows, actuals] = await Promise.all([
    db.prepare('SELECT * FROM income_sources WHERE user_id=? AND archived_at IS NULL AND include_in_forecast=1').bind(userId).all<any>(),
    db.prepare('SELECT o.*, s.name source_name, s.income_type FROM expected_income_occurrences o JOIN income_sources s ON s.id=o.income_source_id WHERE o.user_id=? AND o.expected_date BETWEEN ? AND ?').bind(userId,from,to).all<any>(),
    actualIncomeMovements(db,userId,from,to),
  ]);
  const srcs=sources.results||[], occ=occRows.results||[]; const actualIncluded=actuals.filter(includeActualIncome); const actualIncome=actualIncluded.reduce((s,m)=>s+n(m.amount),0);
  const generated=srcs.flatMap(s=>nextDates(s,from,to).map(d=>({income_source_id:s.id,expected_date:d,expected_amount:expectedAmount(s,d,scenario),income_type:s.income_type,source_name:s.name,status:statusForDate(d)})));
  const byKey=new Map(generated.map(o=>[occurrenceKey(o.income_source_id,o.expected_date),o])); for(const o of occ) byKey.set(o.occurrence_key||occurrenceKey(o.income_source_id,o.expected_date),o);
  const expected=[...byKey.values()]; const expectedIncome=expected.reduce((s,o)=>s+n(o.expected_amount),0); const overdue=expected.filter(o=>o.status==='overdue').reduce((s,o)=>s+n(o.expected_amount)-n(o.actual_amount),0); const salary=expected.filter(o=>o.income_type==='salary').reduce((s,o)=>s+n(o.expected_amount),0); const variable=expected.filter(o=>['freelance','business','rental','bonus','other'].includes(o.income_type)).reduce((s,o)=>s+n(o.expected_amount),0); const oneTime=expected.filter((o:any)=>['bonus','reimbursement','refund'].includes(o.income_type)).reduce((s,o)=>s+n(o.expected_amount),0);
  const next=expected.filter((o:any)=>o.expected_date>=iso(new Date()) && !['received','cancelled','skipped'].includes(o.status)).sort((a:any,b:any)=>a.expected_date.localeCompare(b.expected_date))[0]||null;
  const variance=actualIncome-expectedIncome; const projected=Math.max(actualIncome, expectedIncome); const shares=srcs.map(s=>({source_id:s.id,name:s.name,expected:expected.filter((o:any)=>o.income_source_id===s.id).reduce((a:any,o:any)=>a+n(o.expected_amount),0)})).sort((a,b)=>b.expected-a.expected);
  return {date_from:from,date_to:to,scenario,expected_income:expectedIncome,actual_income:actualIncome,confirmed_future_income:expected.filter((o:any)=>['received','partially_received'].includes(o.status)).reduce((s:any,o:any)=>s+n(o.expected_amount),0),overdue_expected_income:overdue,expected_salary:salary,variable_income_estimate:variable,one_time_income:oneTime,recurring_income:expectedIncome-oneTime,income_variance:variance,income_realization_percentage:expectedIncome>0?actualIncome/expectedIncome:null,projected_month_end_income:projected,conservative_forecast: scenario==='conservative'?expectedIncome:null,base_forecast: scenario==='base'?expectedIncome:null,optimistic_forecast: scenario==='optimistic'?expectedIncome:null,next_expected_credit:next,income_source_count:srcs.length,income_concentration:{largest_source_share:expectedIncome>0?(shares[0]?.expected||0)/expectedIncome:null,number_of_active_sources:srcs.filter(s=>s.active).length},forecast_completeness:srcs.length? expected.length/srcs.length : null,warnings: expected.length?'': 'No expected income occurrences configured', classifications: actuals.map(m=>({movement_id:m.id, classification:movementClassification(m), included:includeActualIncome(m)}))};
}
export async function trends(db:D1Database,userId:number,fromMonth:string,toMonth:string){ const rows=[]; let d=new Date(Date.UTC(Number(fromMonth.slice(0,4)),Number(fromMonth.slice(5,7))-1,1)); const end=new Date(Date.UTC(Number(toMonth.slice(0,4)),Number(toMonth.slice(5,7))-1,1)); while(d<=end){ const month=d.toISOString().slice(0,7); const s=await summary(db,userId,`${month}-01`,endOfMonth(month)); rows.push({month, monthly_income:s.actual_income, expected_income:s.expected_income, salary_trend:s.expected_salary, variable_income_trend:s.variable_income_estimate}); d.setUTCMonth(d.getUTCMonth()+1); } const vals=rows.map(r=>r.monthly_income); return {results:rows, average_monthly_income:vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null, median_monthly_income:vals.length?[...vals].sort((a,b)=>a-b)[Math.floor(vals.length/2)]:null, highest_month:rows.slice().sort((a,b)=>b.monthly_income-a.monthly_income)[0]||null, lowest_month:rows.slice().sort((a,b)=>a.monthly_income-b.monthly_income)[0]||null, income_volatility:vals.length>1?Math.sqrt(vals.reduce((a,v)=>a+Math.pow(v-(vals.reduce((x,y)=>x+y,0)/vals.length),2),0)/vals.length):null}; }
