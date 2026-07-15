import { Hono } from 'hono'; import type { Bindings,Variables } from '../types';
const app=new Hono<{Bindings:Bindings;Variables:Variables}>();
app.put('/:id',async c=>{const uid=c.get('userId'), b=await c.req.json(); await c.env.DB.prepare('UPDATE financial_goal_links SET allocation_percent=?,fixed_allocation_amount=?,updated_at=datetime(\'now\') WHERE user_id=? AND id=?').bind(b.allocation_percent??null,b.fixed_allocation_amount??null,uid,c.req.param('id')).run(); return c.json({success:true});});
app.delete('/:id',async c=>{await c.env.DB.prepare('DELETE FROM financial_goal_links WHERE user_id=? AND id=?').bind(c.get('userId'),c.req.param('id')).run(); return c.json({success:true});});
export default app;
