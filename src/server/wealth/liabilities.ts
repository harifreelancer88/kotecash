export const LIABILITY_TYPES = ['home_loan','personal_loan','vehicle_loan','education_loan','gold_loan','business_loan','credit_card','bnpl','overdraft','informal_loan','other'];
export const INTEREST_TYPES = ['reducing','flat','simple','revolving','manual'];
export const STATUSES = ['active','closed','settled','written_off','inactive'];
export const MODES = ['manual','payment_based','amortization','hybrid'];
export const FREQ:any = { weekly:52, fortnightly:26, monthly:12, quarterly:4, yearly:1 };
export function finite(n:any, fallback=0){ const x=Number(n); return Number.isFinite(x)?x:fallback; }
export function int(n:any, fallback=0){ return Math.max(0, Math.round(finite(n,fallback))); }
export function today(){ return new Date().toISOString().slice(0,10); }
export function addMonths(d:string,n:number){ const [y,m,day]=d.split('-').map(Number); const x=new Date(Date.UTC(y,m-1+n,day)); return x.toISOString().slice(0,10); }
export function dueStatus(date?:string|null, paid=false, window=7){ if(paid) return 'paid'; if(!date) return 'no_due_date'; const t=today(); if(date<t) return 'overdue'; if(date===t) return 'due_today'; const dt=(Date.parse(date)-Date.parse(t))/86400000; return dt<=window?'due_soon':'no_due_date'; }
export function expectedEmi(principal:number, annualRate:number, frequency='monthly', interestType='reducing', installments?:number){ principal=int(principal); const periods=installments||0; if(!principal||!periods) return 0; const per=FREQ[frequency]||12; const r=finite(annualRate)/100/per; if(interestType==='flat') return Math.round((principal + principal*r*periods)/periods); if(interestType==='simple') return Math.round((principal + principal*(finite(annualRate)/100)*(periods/per))/periods); if(!r) return Math.round(principal/periods); return Math.round(principal*r*Math.pow(1+r,periods)/(Math.pow(1+r,periods)-1)); }
export async function calculateLiability(db:D1Database, uid:number, liability:any, asOf=today()){
  const snaps=(await db.prepare('SELECT * FROM liability_balance_snapshots WHERE user_id=? AND liability_id=? AND snapshot_date<=? ORDER BY snapshot_date DESC,id DESC LIMIT 1').bind(uid,liability.id,asOf).all<any>()).results;
  const pays=(await db.prepare('SELECT * FROM liability_payments WHERE user_id=? AND liability_id=? AND payment_date<=? ORDER BY payment_date,id').bind(uid,liability.id,asOf).all<any>()).results;
  const principalPaid=pays.reduce((s,p)=>s+int(p.principal_component ?? p.payment_amount),0);
  const interestPaid=pays.reduce((s,p)=>s+int(p.interest_component),0);
  const feesPaid=pays.reduce((s,p)=>s+int(p.fee_component)+int(p.tax_component),0);
  const manual=snaps[0]?.outstanding_balance;
  const paymentBased=Math.max(int(liability.original_principal||liability.current_outstanding)-principalPaid,0);
  let outstanding=liability.current_outstanding, source='stored', warnings:string[]=[];
  const mode=liability.auto_calculation_mode||'manual';
  if(mode==='manual') { outstanding = manual ?? liability.current_outstanding; source=manual==null?'stored_no_snapshot':'manual_snapshot'; if(manual==null) warnings.push('No manual balance snapshot; using stored outstanding.'); }
  else if(mode==='payment_based') { outstanding=paymentBased; source='payment_based'; }
  else if(mode==='amortization') { outstanding=paymentBased; source='amortization_estimate'; warnings.push('Amortization is an estimate, not a lender-authoritative balance.'); }
  else { outstanding=manual ?? paymentBased; source=manual==null?'hybrid_payment_based':'hybrid_manual_snapshot'; if(manual==null) warnings.push('Hybrid fallback used payment-based estimate.'); }
  return { outstanding:int(outstanding), source, principal_repaid:principalPaid, interest_paid:interestPaid, fees_paid:feesPaid, latest_snapshot:snaps[0]||null, payments:pays, warnings };
}
export async function liabilityTotals(db:D1Database, uid:number, asOf=today()){
 const rows=(await db.prepare("SELECT * FROM liabilities WHERE user_id=? AND include_in_net_worth=1 AND status='active'").bind(uid).all<any>()).results;
 let total=0; const breakdown:any={home_loans:0,personal_loans:0,vehicle_loans:0,education_loans:0,credit_cards:0,bnpl:0,other:0}; const items=[];
 for(const l of rows){ const v=await calculateLiability(db,uid,l,asOf); total+=v.outstanding; const k=l.liability_type==='home_loan'?'home_loans':l.liability_type==='personal_loan'?'personal_loans':l.liability_type==='vehicle_loan'?'vehicle_loans':l.liability_type==='education_loan'?'education_loans':l.liability_type==='credit_card'?'credit_cards':l.liability_type==='bnpl'?'bnpl':'other'; breakdown[k]+=v.outstanding; items.push({...l, valuation:v}); }
 return { total, breakdown, items };
}
export function schedule(liability:any, payments:any[]=[]){ const principal=int(liability.original_principal||liability.current_outstanding); const months=liability.maturity_date&&liability.start_date ? Math.max(1, Math.round((Date.parse(liability.maturity_date)-Date.parse(liability.start_date))/2629800000)) : int(liability.metadata_json&&JSON.parse(liability.metadata_json).installments,0); const emi=int(liability.emi_amount)||expectedEmi(principal, liability.interest_rate, liability.repayment_frequency, liability.interest_type, months); const per=FREQ[liability.repayment_frequency]||12; const r=finite(liability.interest_rate)/100/per; let bal=principal; const rows=[]; for(let i=1;i<=Math.min(months||360,360)&&bal>0;i++){ const interest=liability.interest_type==='reducing'?Math.round(bal*r):liability.interest_type==='flat'?Math.round(principal*r):liability.interest_type==='simple'?Math.round(principal*r):0; const principalPart=Math.min(bal, Math.max(emi-interest,0)); bal=Math.max(0,bal-principalPart); rows.push({ installment:i, due_date:addMonths(liability.start_date||today(),i-1), payment_amount:emi, principal:principalPart, interest, remaining:bal, estimate:true }); } return rows; }
