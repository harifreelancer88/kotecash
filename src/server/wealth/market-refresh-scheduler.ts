import { refreshIndianMarketPrices } from './indian-market-refresh';

type ScheduledJob = { scope:'stocks'|'mutual_funds'; trigger:'scheduled'|'retry'; label:string };
export function indianCronJob(cron:string):ScheduledJob|null{
  if(cron==='45 10 * * 1-5') return {scope:'stocks',trigger:'scheduled',label:'stock_initial'};
  if(cron==='15 11 * * 1-5') return {scope:'stocks',trigger:'retry',label:'stock_retry'};
  if(cron==='0 12 * * 1-5') return {scope:'stocks',trigger:'retry',label:'stock_final_retry'};
  if(cron==='30 17 * * 1-5') return {scope:'mutual_funds',trigger:'scheduled',label:'mutual_fund_nav'};
  return null;
}
const today=()=>new Date().toISOString().slice(0,10);
export async function alreadyCompleted(env:any,userId:number,scope:string,targetDate:string){
  const row = await env.DB.prepare(`SELECT id FROM wealth_price_refresh_runs WHERE user_id=? AND scope=? AND target_date=? AND status='completed' ORDER BY id DESC LIMIT 1`).bind(userId,scope,targetDate).first() as any;
  return !!row;
}
export async function dispatchIndianMarketPriceCron(env:any, cron:string, executionCtx?:ExecutionContext){
  const job=indianCronJob(cron); if(!job) return {handled:false,cron};
  const targetDate=today();
  const run=async()=>{
    const usersRes = await env.DB.prepare('SELECT id FROM users').all() as any;
    const users = usersRes.results || [];
    const results:any[]=[];
    for(const u of users){
      if(job.trigger==='retry' && await alreadyCompleted(env,u.id,job.scope,targetDate)){ results.push({userId:u.id,status:'skipped_completed'}); continue; }
      const c:any={env,get:(k:string)=>k==='userId'?u.id:undefined};
      try{ results.push({userId:u.id,...await refreshIndianMarketPrices(c,{scope:job.scope,trigger:job.trigger,targetDate})}); }
      catch(e:any){ results.push({userId:u.id,status:'failed',error:String(e.message||e).slice(0,240)}); }
    }
    return {handled:true,cron,job:job.label,scope:job.scope,results};
  };
  if(executionCtx){ executionCtx.waitUntil(run()); return {handled:true,cron,job:job.label,scope:job.scope,queued:true}; }
  return run();
}
