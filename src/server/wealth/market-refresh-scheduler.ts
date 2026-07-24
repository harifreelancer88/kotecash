import { refreshIndianMarketPrices } from './indian-market-refresh';
import { refreshGoogleSheetsPrices } from './google-sheets-refresh';
import { priceFeedMode } from './google-sheets-price-feed';

type ScheduledJob = { scope:'stocks'|'mutual_funds'|'google_sheets'; trigger:'scheduled'|'retry'; label:string; legacyInactive?:boolean };
export function indianCronJob(cron:string):ScheduledJob|null{
  if(cron==='0 18 * * 1-5') return {scope:'google_sheets',trigger:'scheduled',label:'google_sheets_import'};
  if(cron==='45 10 * * 1-5') return {scope:'stocks',trigger:'scheduled',label:'legacy_stock_initial',legacyInactive:true};
  if(cron==='15 11 * * 1-5') return {scope:'stocks',trigger:'retry',label:'legacy_stock_retry',legacyInactive:true};
  if(cron==='0 12 * * 1-5') return {scope:'stocks',trigger:'retry',label:'legacy_stock_final_retry',legacyInactive:true};
  if(cron==='30 17 * * 1-5') return {scope:'mutual_funds',trigger:'scheduled',label:'legacy_mutual_fund_nav',legacyInactive:true};
  return null;
}
const today=()=>new Date().toISOString().slice(0,10);
export async function alreadyCompleted(env:any,userId:number,scope:string,targetDate:string){
  const row = await env.DB.prepare(`SELECT id FROM wealth_price_refresh_runs WHERE user_id=? AND scope=? AND target_date=? AND status='completed' ORDER BY id DESC LIMIT 1`).bind(userId,scope,targetDate).first() as any;
  return !!row;
}
export async function dispatchIndianMarketPriceCron(env:any, cron:string, executionCtx?:ExecutionContext){
  const job=indianCronJob(cron); if(!job) return {handled:false,cron};
  if(job.legacyInactive) return {handled:false,cron,job:job.label,legacyInactive:true};
  if(job.scope==='google_sheets' && priceFeedMode(env)!=='google_sheets') return {handled:true,cron,job:job.label,status:'skipped_not_configured'};
  const targetDate=today();
  const run=async()=>{
    const usersRes = await env.DB.prepare('SELECT id FROM users').all() as any;
    const users = usersRes.results || [];
    const results:any[]=[];
    for(const u of users){
      if(await alreadyCompleted(env,u.id,job.scope,targetDate)){ results.push({userId:u.id,status:'skipped_completed'}); continue; }
      const c:any={env,get:(k:string)=>k==='userId'?u.id:undefined};
      try{ results.push({userId:u.id,...(job.scope==='google_sheets'?await refreshGoogleSheetsPrices(c,{scope:'google_sheets',trigger:job.trigger,targetDate}):await refreshIndianMarketPrices(c,{scope:job.scope as any,trigger:job.trigger,targetDate}))}); }
      catch(e:any){ results.push({userId:u.id,status:'failed',error:String(e.message||e).slice(0,240)}); }
    }
    return {handled:true,cron,job:job.label,scope:job.scope,results};
  };
  if(executionCtx){ executionCtx.waitUntil(run()); return {handled:true,cron,job:job.label,scope:job.scope,queued:true}; }
  return run();
}
