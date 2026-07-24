import { describe, expect, it, vi } from 'vitest';
import { GoogleSheetsPriceFeedProvider, normalizeFeedAssetKey, testGoogleSheetsFeed } from '../src/server/wealth/google-sheets-price-feed';
import { refreshGoogleSheetsPrices } from '../src/server/wealth/google-sheets-refresh';

const envBase = { PRICE_FEED_MODE: 'google_sheets', GOOGLE_SHEETS_PRICE_FEED_URL: 'https://script.google.com/macros/s/DEPLOYMENT/exec', GOOGLE_SHEETS_PRICE_FEED_TOKEN: 'secret-token-value-that-is-long' };
const row = (x: any = {}) => ({ assetKey: 'stock:HINDALCO', assetType: 'stock', symbol: 'HINDALCO', exchange: 'NSE', price: 943.3, currency: 'INR', priceDate: new Date().toISOString().slice(0, 10), capturedAt: new Date().toISOString(), source: 'googlefinance', status: 'ok', ...x });
const response = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('GoogleSheetsPriceFeedProvider', () => {
  it('normalizes deterministic asset keys', () => {
    expect(normalizeFeedAssetKey(' stock:hindalco ')).toBe('stock:HINDALCO');
    expect(normalizeFeedAssetKey('MF:122639')).toBe('mf:122639');
    expect(normalizeFeedAssetKey('crypto:btc-inr')).toBe('crypto:BTC-INR');
  });
  it('fetches a valid feed without exposing query string diagnostics', async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain('?token=');
      return response({ schemaVersion: 1, generatedAt: '2026-07-24T04:53:46.328Z', prices: [row()] });
    });
    const out = await new GoogleSheetsPriceFeedProvider(envBase, fetcher as any).fetchFeed();
    expect(out.diagnostics).toMatchObject({ hostname: 'script.google.com', httpStatus: 200, rowsReceived: 1, rowsAccepted: 1, rowsRejected: 0 });
    expect(JSON.stringify(out)).not.toContain('secret-token-value');
    expect(JSON.stringify(out)).not.toContain('/macros/s/DEPLOYMENT');
  });
  it('rejects malformed rows independently', async () => {
    const fetcher = vi.fn(async () => response({ schemaVersion: 1, prices: [row(), row({ price: 0 }), row({ status: 'stale' }), row({ assetKey: '' })] }));
    const out = await new GoogleSheetsPriceFeedProvider(envBase, fetcher as any).fetchFeed();
    expect(out.prices).toHaveLength(1);
    expect(out.rejectedRows).toHaveLength(3);
  });
  it('dedupes identical duplicates and rejects conflicting duplicates', async () => {
    const fetcher = vi.fn(async () => response({ schemaVersion: 1, prices: [row(), row(), row({ price: 944 })] }));
    const out = await new GoogleSheetsPriceFeedProvider(envBase, fetcher as any).fetchFeed();
    expect(out.prices).toHaveLength(0);
    expect(out.rejectedRows.some(r => r.reason.includes('conflicting'))).toBe(true);
  });
  it('reports missing credentials and bad HTTP safely', async () => {
    await expect(new GoogleSheetsPriceFeedProvider({ PRICE_FEED_MODE: 'google_sheets' }, vi.fn() as any).fetchFeed()).rejects.toThrow('credentials');
    await expect(new GoogleSheetsPriceFeedProvider(envBase, vi.fn(async () => response({ error: 'no' }, 403)) as any).fetchFeed()).rejects.toThrow('authorization');
  });
  it('rejects redirected googleusercontent URLs instead of stripping their query', async () => {
    await expect(new GoogleSheetsPriceFeedProvider({ ...envBase, GOOGLE_SHEETS_PRICE_FEED_URL: 'https://script.googleusercontent.com/macros/echo?user_content_key=x&lib=y' }, vi.fn() as any).fetchFeed()).rejects.toThrow('/exec URL');
  });
  it('retries once for transient failures', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ error: 'wait' }, 429))
      .mockResolvedValueOnce(response({ schemaVersion: 1, prices: [row()] }));
    await expect(new GoogleSheetsPriceFeedProvider(envBase, fetcher as any).fetchFeed()).resolves.toMatchObject({ connected: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('connection test does not save prices', async () => {
    const c: any = { env: { ...envBase }, get: () => 1 };
    const fetcher = vi.fn(async () => response({ schemaVersion: 1, prices: [row()] }));
    const original = globalThis.fetch;
    (globalThis as any).fetch = fetcher;
    try {
      const out = await testGoogleSheetsFeed(c);
      expect(out).toMatchObject({ connected: true, rowsReceived: 1, validRows: 1, invalidRows: 0 });
    } finally {
      (globalThis as any).fetch = original;
    }
  });
});

describe('refreshGoogleSheetsPrices', () => {
  function db() {
    const calls: any[] = [];
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...args: any[]) => ({
        first: vi.fn(async () => {
          calls.push({ sql, args, op: 'first' });
          if (/processing/.test(sql) || /completed_at>datetime/.test(sql) || /price_date>\?/.test(sql)) return null;
          if (/price_date=\?/.test(sql)) return null;
          return null;
        }),
        all: vi.fn(async () => {
          calls.push({ sql, args, op: 'all' });
          if (/price_feed_asset_key IS NOT NULL/.test(sql)) return { results: [{ id: 7, user_id: 1, name: 'Hindalco', asset_type: 'stock', price_feed_asset_key: 'stock:HINDALCO', is_active: 1 }] };
          if (/UPPER\(symbol\)/.test(sql)) return { results: [] };
          return { results: [] };
        }),
        run: vi.fn(async () => {
          calls.push({ sql, args, op: 'run' });
          return { meta: { last_row_id: /INSERT INTO wealth_price_refresh_runs/.test(sql) ? 99 : 1, changes: 1 } };
        }),
      })),
    }));
    return { DB: { prepare } as any, calls };
  }
  it('fetches once, maps by exact key, saves google_sheets metadata, and returns counts', async () => {
    const d = db();
    const fetcher = vi.fn(async () => response({ schemaVersion: 1, generatedAt: '2026-07-24T04:53:46.328Z', prices: [row()] }));
    const original = globalThis.fetch;
    (globalThis as any).fetch = fetcher;
    try {
      const c: any = { env: { ...envBase, DB: d.DB }, get: () => 1 };
      const out = await refreshGoogleSheetsPrices(c, { scope: 'google_sheets', trigger: 'manual' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(out).toMatchObject({ batchId: 99, rowsReceived: 1, assetsMapped: 1, updated: 1, failed: 0 });
      expect(d.calls.some(c => /source_type/.test(c.sql) && c.args.includes('google_sheets') && c.args.includes('stock:HINDALCO'))).toBe(true);
    } finally {
      (globalThis as any).fetch = original;
    }
  });
});
