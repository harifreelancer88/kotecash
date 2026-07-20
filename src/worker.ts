import { dispatchIndianMarketPriceCron } from './server/wealth/market-refresh-scheduler';

type Env = { ASSETS: Fetcher; DB: D1Database } & Record<string, unknown>;

async function astroWorker() {
  return import('../dist/_worker.js/index.js') as Promise<{ default: ExportedHandler<Env> }>;
}

export function forwardToAstroWorker(worker: ExportedHandler<Env>, request: Request, env: Env, ctx: ExecutionContext) {
  return worker.fetch!(request, env, ctx);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const worker = await astroWorker();
    return forwardToAstroWorker(worker.default, request as any, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await dispatchIndianMarketPriceCron(env, controller.cron, ctx);
  },
} satisfies ExportedHandler<Env>;
