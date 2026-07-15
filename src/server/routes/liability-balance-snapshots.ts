import { Hono } from 'hono';
import type { Bindings, Variables, AppContext } from '../types';
import { int } from '../wealth/liabilities';
const app=new Hono<{Bindings:Bindings;Variables:Variables}>();
async function snap(c:AppContext,id:any){return c.env.DB.prepare('SELECT * FROM liability_balance_snapshots WHERE user_id=? AND id=?').bind(c.get('userId'),id).first<any>();}
app.put('/:id',async c=>{ const ex=await snap(c,c.req.param('id')); if(!ex)return c.json({error:'Not found'},404); const b=await c.req.json(); await c.env.DB.prepare(`UPDATE liability_balance_snapshots SET snapshot_date=?,outstanding_balance=?,accrued_interest=?,source=?,notes=?,updated_at=datetime('now') WHERE user_id=? AND id=?`).bind(b.snapshot_date,int(b.outstanding_balance),b.accrued_interest==null?null:int(b.accrued_interest),b.source||'manual',b.notes??null,c.get('userId'),c.req.param('id')).run(); return c.json({id:Number(c.req.param('id')),...b}); });
app.delete('/:id',async c=>{ if(!await snap(c,c.req.param('id')))return c.json({error:'Not found'},404); await c.env.DB.prepare('DELETE FROM liability_balance_snapshots WHERE user_id=? AND id=?').bind(c.get('userId'),c.req.param('id')).run(); return c.json({success:true}); });
export default app;
