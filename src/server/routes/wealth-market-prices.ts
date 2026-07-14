import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { marketPriceStatus, refreshMarketPrices } from '../wealth/market-prices';
const route=new Hono<{Bindings:Bindings;Variables:Variables}>();
const bad=(m:string)=>({error:m});
route.get('/status', async c=>c.json(await marketPriceStatus(c as any)));
route.post('/refresh', async c=>{ try{ const b=await c.req.json().catch(()=>({})); const ids=Array.isArray(b.asset_ids)?b.asset_ids.map(Number).filter(Boolean):undefined; const out=await refreshMarketPrices(c as any,{asset_ids:ids,only_open_holdings:b.only_open_holdings!==false,force:b.force===true}); const code=out.failed&&out.updated===0?400:200; return c.json(out,code as any); }catch(e:any){ return c.json(bad(e.message||'Refresh failed'),400); }});
export default route;
