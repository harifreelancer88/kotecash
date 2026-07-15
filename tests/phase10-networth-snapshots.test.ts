import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import networth from '../src/server/routes/networth';
function app(db:any){ const a=new Hono<{Variables:{userId:number}}>(); a.use('*',async(c,n)=>{c.set('userId',1); await n();}); a.route('/api/net-worth',networth); return {app:a, env:{DB:db}}; }
function db(rows:any[]=[]){ return {prepare:vi.fn((q:string)=>({bind:vi.fn((...args:any[])=>({
  first:vi.fn(async()=>{
    if(q.includes('SELECT locked FROM net_worth_snapshots') && args[1]==='2026-02') return {locked:1};
    if(q.includes('SELECT * FROM net_worth_snapshots') && args[1]==='2026-01') return rows[0]||null;
    return null;
  }),
  all:vi.fn(async()=>({results:q.includes('SELECT * FROM net_worth_snapshots')?rows:[]})),
  run:vi.fn(async()=>({success:true}))
}))}))}; }
describe('phase 10 monthly net worth snapshots',()=>{
  it('rejects future month generation',async()=>{ const h=app(db()); const r=await h.app.request('/api/net-worth/snapshots/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({month:'2999-01'})},h.env as any); expect(r.status).toBe(400); expect(await r.json()).toMatchObject({error:'Future months are not allowed'}); });
  it('returns locked status instead of replacing a locked month',async()=>{ const h=app(db()); const r=await h.app.request('/api/net-worth/snapshots/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({month:'2026-02',force_recalculate:true})},h.env as any); expect(await r.json()).toMatchObject({locked:true,skipped:true}); });
  it('calculates analytics with null unavailable comparisons',async()=>{ const h=app(db([{id:1,month:'2026-01',assets:100,liabilities:25,net_worth:75,valuation_complete:1,locked:0,breakdown_json:'{}'}])); const r=await h.app.request('/api/net-worth/snapshots',{},h.env as any); const j:any=await r.json(); expect(j.analytics.month_on_month_change).toBeNull(); expect(j.analytics.current_net_worth).toBe(75); });
});
