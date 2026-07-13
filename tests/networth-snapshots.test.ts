import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import networth from '../src/server/routes/networth';
function app(db:any){ const a=new Hono<{Variables:{userId:number}}>(); a.use('*',async(c,n)=>{c.set('userId',1); await n();}); a.route('/api/net-worth',networth); return {app:a, env:{DB:db}}; }
describe('net worth snapshots',()=>{
  it('rejects overwriting locked snapshots without force',async()=>{
    const db={prepare:vi.fn((q:string)=>({bind:vi.fn(()=>({first:vi.fn(async()=>q.includes('SELECT locked')?{locked:1}:null),all:vi.fn(async()=>({results:[]})),run:vi.fn(async()=>({success:true}))}))}))};
    const h=app(db); const r=await h.app.request('/api/net-worth/snapshot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({month:'2026-01',assets:1,liabilities:0,net_worth:1})},h.env as any);
    expect(r.status).toBe(409);
  });
  it('recalculate skips locked snapshots',async()=>{
    const db={prepare:vi.fn((q:string)=>({bind:vi.fn((...args:any[])=>({first:vi.fn(async()=>q.includes('SELECT id,locked')&&args[1]==='2026-01'?{id:1,locked:1}:null),all:vi.fn(async()=>({results:[]})),run:vi.fn(async()=>({success:true}))}))}))};
    const h=app(db); const r=await h.app.request('/api/net-worth/recalculate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:'2026-01',to:'2026-01'})},h.env as any);
    expect(await r.json()).toMatchObject({skipped_locked:['2026-01']});
  });
});
