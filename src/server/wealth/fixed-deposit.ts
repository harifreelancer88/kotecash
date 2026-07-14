import { optionalText } from './validation';

export type FormulaValuation = { value:number|null; status:'calculated'|'manual_required'|'formula_estimate'; assumptions:string[]; warnings:string[]; as_of:string };
const DAY=86400000;
function days(a:string,b:string){ return Math.max(0, Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/DAY)); }
function years(a:string,b:string){ return days(a,b)/365.2425; }
function periodsPerYear(f:string){ return f==='monthly'?12:f==='quarterly'?4:f==='half_yearly'?2:f==='yearly'?1:0; }
export function parseMetadata(raw:any){ if(!raw) return {}; if(typeof raw==='object') return raw; try{return JSON.parse(String(raw));}catch{return {};} }
export function fixedDepositValue(metadata:any, asOf:string): FormulaValuation {
  const m=parseMetadata(metadata); const principal=Number(m.principal); const rate=Number(m.interest_rate ?? m.annual_interest_rate); const start=optionalText(m.start_date); const maturity=optionalText(m.maturity_date); const freq=optionalText(m.compounding_frequency) || 'simple';
  const assumptions=[`principal=${Number.isFinite(principal)?principal:'missing'}`,`annual_rate=${Number.isFinite(rate)?rate:'missing'}`,`compounding=${freq}`]; const warnings=['formula_estimate_not_bank_authoritative'];
  if(!Number.isFinite(principal)||principal<0||!Number.isFinite(rate)||rate<0||!start) return {value:null,status:'manual_required',assumptions,warnings:['Manual valuation required: missing FD principal, rate, or start date'],as_of:asOf};
  if(asOf<start) return {value:0,status:'calculated',assumptions,warnings:['no_value_before_start_date'],as_of:asOf};
  const end=maturity && asOf>maturity ? maturity : asOf;
  if (maturity && asOf>=maturity && m.maturity_amount != null && Number.isFinite(Number(m.maturity_amount))) return {value:Math.round(Number(m.maturity_amount)),status:'calculated',assumptions:[...assumptions,'maturity_amount_override=true'],warnings,as_of:asOf};
  const r=rate/100; let value=principal;
  if(freq==='simple') value=principal*(1+r*years(start,end));
  else { const n=periodsPerYear(freq); if(!n) return {value:null,status:'manual_required',assumptions,warnings:[`Manual valuation required: unsupported compounding_frequency ${freq}`],as_of:asOf}; value=principal*Math.pow(1+r/n, n*years(start,end)); }
  return {value:Math.round(value),status:'calculated',assumptions,warnings:maturity&&asOf>maturity?[...warnings,'calculation_capped_at_maturity_date']:warnings,as_of:asOf};
}
export function annualEstimateValue(metadata:any, asOf:string): FormulaValuation { const m=parseMetadata(metadata); return fixedDepositValue({...m, compounding_frequency:m.compounding_frequency||'yearly'}, asOf); }
