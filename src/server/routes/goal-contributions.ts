import { Hono } from 'hono'; import type { Bindings,Variables } from '../types';
const app=new Hono<{Bindings:Bindings;Variables:Variables}>();
app.put('/:id',async c=>{const uid=c.get('userId'), b=await c.req.json(); await c.env.DB.prepare('UPDATE goal_contributions SET contribution_date=?,amount=?,source=?,movement_id=?,investment_transaction_id=?,notes=?,updated_at=datetime(\'now\') WHERE user_id=? AND id=?').bind(b.contribution_date,Math.round(Number(b.amount)),b.source||'manual',b.movement_id??null,b.investment_transaction_id??null,b.notes??null,uid,c.req.param('id')).run(); return c.json({success:true});});
app.delete('/:id',async c=>{await c.env.DB.prepare('DELETE FROM goal_contributions WHERE user_id=? AND id=?').bind(c.get('userId'),c.req.param('id')).run(); return c.json({success:true});});
export default app;
