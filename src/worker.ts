import { dispatchIndianMarketPriceCron } from './server/wealth/market-refresh-scheduler';

type Env = { ASSETS: Fetcher; DB: D1Database } & Record<string, unknown>;

async function astroWorker() {
  return import('../dist/_worker.js/index.js') as Promise<{ default: ExportedHandler<Env> }>;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const worker = await astroWorker();
    return worker.default.fetch!(request as any, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await dispatchIndianMarketPriceCron(env, controller.cron, ctx);
  },
} satisfies ExportedHandler<Env>;
