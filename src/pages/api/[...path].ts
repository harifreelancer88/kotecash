import type { APIRoute } from "astro";
import { app } from "../../server/app";

export const ALL: APIRoute = async (ctx) => {
  const runtime = (ctx.locals as any).runtime;
  const env = runtime?.env ?? {};
  const fetchCtx = runtime?.ctx;
  return app.fetch(ctx.request, env, fetchCtx);
};
