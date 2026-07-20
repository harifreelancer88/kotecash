import type { APIRoute } from "astro";
import { app } from "../../server/app";
import { dispatchIndianMarketPriceCron } from "../../server/wealth/market-refresh-scheduler";

export const ALL: APIRoute = async (ctx) => {
  const runtime = (ctx.locals as any).runtime;
  const env = runtime?.env ?? {};
  const fetchCtx = runtime?.ctx;
  return app.fetch(ctx.request, env, fetchCtx);
};

export const scheduled = async (event: ScheduledEvent, env: any, ctx: ExecutionContext) => {
  return dispatchIndianMarketPriceCron(env, event.cron, ctx);
};
