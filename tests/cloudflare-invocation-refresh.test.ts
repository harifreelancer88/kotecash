import { describe, expect, it, vi, afterEach } from 'vitest';
import { NseBhavcopyProvider } from '../src/server/market-data/india/nse-bhavcopy';
import { YahooFinanceProvider } from '../src/server/market-data/india/yahoo-finance';
import { MfApiProvider } from '../src/server/market-data/india/mfapi';
import { dispatchIndianMarketPriceCron } from '../src/server/wealth/market-refresh-scheduler';
import { refreshIndianMarketPrices } from '../src/server/wealth/indian-market-refresh';
import { forwardToAstroWorker } from '../src/worker';

afterEach(() => vi.restoreAllMocks());

function receiverCheckedDb(assetOverrides: Record<string, any> = {}) {
  const db: any = {
    prepare(sql: string) {
      if (this !== db) throw new TypeError('Illegal invocation: DB.prepare receiver lost');
      const stmt: any = {
        bind(...binds: any[]) {
          if (this !== stmt) throw new TypeError('Illegal invocation: statement.bind receiver lost');
          const bound: any = {
            async first() {
              if (this !== bound) throw new TypeError('Illegal invocation: statement.first receiver lost');
              return null;
            },
            async all() {
              if (this !== bound) throw new TypeError('Illegal invocation: statement.all receiver lost');
              if (sql === 'SELECT id FROM users') return { results: [{ id: 1 }] };
              if (sql.includes('FROM investment_assets')) {
                return { results: [{ id: 1, user_id: 1, asset_type: 'stock', name: 'HINDALCO', symbol: 'HINDALCO', exchange: 'NSE', is_active: 1, automatic_price_refresh: 1, price_provider: 'nse_bhavcopy', provider_symbol: 'HINDALCO', ...assetOverrides }] };
              }
              return { results: [] };
            },
            async run() {
              if (this !== bound) throw new TypeError('Illegal invocation: statement.run receiver lost');
              return { success: true, meta: { last_row_id: 42, changes: 1 }, binds };
            },
          };
          return bound;
        },
        async all() {
          if (this !== stmt) throw new TypeError('Illegal invocation: unbound statement.all receiver lost');
          if (sql === 'SELECT id FROM users') return { results: [{ id: 1 }] };
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return db;
}

describe('Cloudflare runtime receiver preservation', () => {
  it('Worker fetch forwarding preserves the generated worker receiver', async () => {
    const worker: any = {
      async fetch() {
        if (this !== worker) throw new TypeError('Illegal invocation: worker.fetch receiver lost');
        return new Response('ok');
      },
    };
    const res = await forwardToAstroWorker(worker, new Request('https://example.test'), {} as any, {} as any);
    expect(await res.text()).toBe('ok');
  });

  it('scheduled handler and ctx.waitUntil preserve their receivers', async () => {
    const env = { DB: receiverCheckedDb() } as any;
    const ctx: any = {
      jobs: [] as Promise<unknown>[],
      waitUntil(promise: Promise<unknown>) {
        if (this !== ctx) throw new TypeError('Illegal invocation: waitUntil receiver lost');
        this.jobs.push(promise);
      },
    };
    const result = await dispatchIndianMarketPriceCron(env, '45 10 * * 1-5', ctx);
    expect(result).toMatchObject({ queued: true });
    await expect(Promise.all(ctx.jobs)).resolves.toBeDefined();
  });

  it('D1 prepare/run methods are not detached during HINDALCO refresh', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValueOnce(new Response('not zip', { status: 200, headers: { 'content-type': 'text/plain' } }) as any).mockResolvedValueOnce(new Response(JSON.stringify({ chart: { result: [{ meta: { currency: 'INR', regularMarketTime: Date.UTC(2026, 6, 20) / 1000, regularMarketPrice: 681.5 }, timestamp: [], indicators: { quote: [{ close: [] }] } }] } }), { status: 200 }) as any);
    const summary = await refreshIndianMarketPrices({ env: { DB: receiverCheckedDb() }, get: () => 1 } as any, { assetIds: [1], targetDate: '2026-07-20', force: true });
    expect(summary.requested).toBe(1);
    expect(summary.results[0]).toMatchObject({ assetId: 1, provider_used: 'yahoo_finance', status: 'updated', price: '681.5', tradeDate: '2026-07-20' });
  });

  it('provider default fetch wrappers invoke global fetch with its runtime receiver', async () => {
    const originalFetch = globalThis.fetch;
    const checkedFetch = vi.fn(function (this: any, input: RequestInfo | URL) {
      if (this !== globalThis) throw new TypeError('Illegal invocation: fetch receiver lost');
      const url = String(input);
      if (url.includes('nsearchives')) return Promise.resolve(new Response('not zip', { status: 200, headers: { 'content-type': 'text/plain' } }));
      if (url.includes('finance.yahoo')) return Promise.resolve(new Response(JSON.stringify({ chart: { result: [{ meta: { currency: 'INR', regularMarketTime: Date.UTC(2026, 6, 20) / 1000, regularMarketPrice: 681.5 } }] } }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ status: 'error' }), { status: 200 }));
    }) as any;
    globalThis.fetch = checkedFetch;
    try {
      await new NseBhavcopyProvider().fetchPrices({ targetDate: '2026-07-20', assets: [{ id: 1, symbol: 'HINDALCO' }] });
      const yahoo = await new YahooFinanceProvider(undefined as any, 1).fetchPrices({ targetDate: '2026-07-20', assets: [{ id: 1, symbol: 'HINDALCO.NS', exchange: 'NSE' }] });
      await new MfApiProvider().fetchPrices({ targetDate: '2026-07-20', assets: [{ id: 2, provider_scheme_code: '123' }] });
      expect(yahoo.status).toBe('ok');
      expect(checkedFetch).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('provider failure returns a structured batch result without Illegal invocation', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(new Response('not zip', { status: 200, headers: { 'content-type': 'text/html' } }) as any);
    const summary = await refreshIndianMarketPrices({ env: { DB: receiverCheckedDb() }, get: () => 1 } as any, { assetIds: [1], targetDate: '2026-07-20', force: true });
    expect(summary).toMatchObject({ requested: 1, failed: 1, status: 'failed' });
    expect(summary.results[0].error).toMatch(/NSE payload was empty or too small|NSE response was not a ZIP file|Yahoo/);
    expect(JSON.stringify(summary)).not.toMatch(/Illegal invocation/);
  });
});
