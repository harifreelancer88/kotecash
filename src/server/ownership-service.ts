import type { AppContext } from './types';

export const RECORD_TYPES = ['wallet','wealth_account','wealth_asset','liability','goal','income_source','budget','insurance_policy_future','other_asset'];
export const OWNERSHIP_TYPES = ['individual','joint','household','custodial','beneficiary','shared_expense'];
export const ALLOCATION_BASIS = ['percentage','equal','full','informational'];
const ASSET_TYPES = new Set(['wallet','wealth_account','wealth_asset','other_asset']);
const LIABILITY_TYPES = new Set(['liability']);

export function finiteNumber(v:any,d=0){ const n=Number(v); return Number.isFinite(n)?n:d; }
export function roundMoney(v:number){ return Math.round(v); }
export function todayIso(){ return new Date().toISOString().slice(0,10); }

export async function ensureDefaultHousehold(db:D1Database,userId:number){
  let h=await db.prepare('SELECT * FROM households WHERE user_id=? AND active=1 ORDER BY id LIMIT 1').bind(userId).first<any>();
  if(!h){ const r:any=await db.prepare("INSERT INTO households(user_id,name,base_currency,household_type,active) VALUES(?,?,?,?,1)").bind(userId,'My Household','IDR','individual').run(); h=await db.prepare('SELECT * FROM households WHERE user_id=? AND id=?').bind(userId,r.meta?.last_row_id).first<any>(); }
  let self=await db.prepare("SELECT * FROM household_members WHERE user_id=? AND household_id=? AND relationship='self' AND archived_at IS NULL LIMIT 1").bind(userId,h.id).first<any>();
  if(!self){ const r:any=await db.prepare("INSERT INTO household_members(user_id,household_id,display_name,relationship,dependent,active,sort_order) VALUES(?,?,?,?,0,1,0)").bind(userId,h.id,'Self','self').run(); self=await db.prepare('SELECT * FROM household_members WHERE user_id=? AND id=?').bind(userId,r.meta?.last_row_id).first<any>(); }
  return { household:h, self };
}

export async function audit(db:D1Database,userId:number,householdId:number|null,entityType:string,entityId:number,action:string,summary:string,metadata:any=null){
  await db.prepare('INSERT INTO household_audit_events(user_id,household_id,entity_type,entity_id,action,summary,metadata_json) VALUES(?,?,?,?,?,?,?)').bind(userId,householdId,entityType,entityId,action,summary,metadata?JSON.stringify(metadata):null).run();
}

export async function resolveOwnership(db:D1Database,userId:number,recordType:string,recordId:number){
  const {household,self}=await ensureDefaultHousehold(db,userId);
  const rows=(await db.prepare(`SELECT o.*, m.display_name, m.relationship, m.archived_at, m.active member_active FROM financial_record_ownership o LEFT JOIN household_members m ON m.id=o.member_id AND m.user_id=o.user_id WHERE o.user_id=? AND o.record_type=? AND o.record_id=? ORDER BY o.id`).bind(userId,recordType,recordId).all<any>()).results||[];
  const allocations=rows.length?rows:[{user_id:userId,household_id:household.id,record_type:recordType,record_id:recordId,member_id:self.id,ownership_type:'individual',ownership_percent:100,allocation_basis:'full',display_name:self.display_name,relationship:'self',fallback:true}];
  const economic=allocations.filter((a:any)=>a.ownership_type!=='beneficiary'&&a.allocation_basis!=='informational');
  const total=economic.reduce((s:number,a:any)=>s+finiteNumber(a.ownership_percent),0);
  const warnings:string[]=[];
  if(!rows.length) warnings.push('Missing ownership; using Self 100% fallback.');
  if(total>100.0001) warnings.push('Allocation exceeds 100%.');
  if(total<99.9999) warnings.push('Allocation below 100%.');
  if(allocations.some((a:any)=>a.ownership_type==='joint') && new Set(allocations.filter((a:any)=>a.ownership_type==='joint').map((a:any)=>a.member_id).filter(Boolean)).size<2) warnings.push('Joint ownership needs at least two members.');
  if(allocations.some((a:any)=>a.archived_at)) warnings.push('Archived member still owns an active record.');
  if(recordType==='goal' && allocations.some((a:any)=>a.ownership_type==='custodial') && !allocations.some((a:any)=>['child','dependant'].includes(a.relationship))) warnings.push('Child goal missing beneficiary.');
  return { household, primary_member: allocations.find((a:any)=>a.member_id)||null, ownership_type: allocations[0]?.ownership_type||'individual', allocations, total_allocated_percent: total, unallocated_percent: Math.max(0,100-total), validation_status: total>100.0001?'invalid':warnings.length?'warning':'valid', warnings };
}

export function allocateValue(value:number,resolved:any){
  const allocations:any[]=[]; let memberTotal=0;
  for(const a of resolved.allocations){
    if(a.ownership_type==='beneficiary'||a.allocation_basis==='informational') continue;
    if(a.ownership_type==='household' && !a.member_id){ allocations.push({...a,allocated_value:roundMoney(value)}); continue; }
    const pct=finiteNumber(a.ownership_percent); const allocated=roundMoney(value*pct/100); memberTotal+=allocated; allocations.push({...a,allocated_value:allocated});
  }
  return { allocations, member_total: memberTotal };
}

export async function listRecordOwnershipHealth(db:D1Database,userId:number){
  const rows=(await db.prepare('SELECT record_type,record_id FROM financial_record_ownership WHERE user_id=? GROUP BY record_type,record_id ORDER BY record_type,record_id').bind(userId).all<any>()).results||[];
  const out=[]; for(const r of rows) out.push(await resolveOwnership(db,userId,r.record_type,r.record_id)); return out;
}
