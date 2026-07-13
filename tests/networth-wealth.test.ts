import { describe, expect, it, vi } from 'vitest';
import networth from '../src/server/routes/networth';
import { Hono } from 'hono';
function app(db:any){ const a=new Hono<{Variables:{userId:number}}>(); a.use('*',async(c,n)=>{c.set('userId',1); await n();}); a.route('/api/net-worth',networth); return {app:a, env:{DB:db}}; }
function db(){return {prepare:vi.fn((q:string)=>({bind:vi.fn(()=>({all:vi.fn(async()=>({results:q.includes('FROM portfolios')?[{id:1,name:'Fund',account_type:'other',is_active:1,include_in_net_worth:1,valuation_mode:'manual_snapshot',value:0}]:q.includes('FROM balance_history')?[{entity_kind:'portfolio',entity_id:1,amount:250,recorded_at:'2026-07-01 00:00:00'}]:[] })),first:vi.fn(async()=>null),run:vi.fn(async()=>({success:true}))}))}))};}
describe('net worth wealth integration',()=>{it('includes manual portfolio once in monthly snapshots',async()=>{const h=app(db()); const r=await h.app.request('/api/net-worth',{},h.env as any); const j:any=await r.json(); expect(j.current.wealthInvestmentValue).toBe(250); expect(j.current.assets).toBe(250);});});
