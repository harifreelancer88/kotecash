import type { AppContext } from '../types';
import { GoogleSheetsPriceFeedProvider, normalizeFeedAssetKey, priceFeedMode, type NormalizedFeedPrice } from './google-sheets-price-feed';

type Trigger = 'manual' | 'scheduled' | 'retry';
type SaveStatus = 'updated' | 'unchanged' | 'skipped';
export type GoogleSheetsRefreshResult = {
  batchId: number;
  provider: 'google_sheets';
  status: 'completed' | 'partially_completed' | 'failed';
  feedGeneratedAt?: string;
  rowsReceived: number;
  rowsAccepted: number;
  rowsRejected: number;
  assetsMapped: number;
  requested: number;
  updated: number;
  unchanged: number;
  skipped: number;
  unmapped: number;
  failed: number;
  results: any[];
};

const today = () => new Date().toISOString().slice(0, 10);
function scope(opts: any) { return opts?.scope === 'google_sheets' || opts?.scope === 'all' || !opts?.scope ? 'google_sheets' : String(opts.scope); }
function sanitize(v: unknown) {
  return String(v instanceof Error ? v.message : v || 'Refresh failed').replace(/[A-Za-z0-9_\-]{24,}/g, '[redacted]').slice(0, 240);
}
async function recentManualRun(c: AppContext, uid: number) {
  return c.env.DB.prepare(`SELECT completed_at FROM wealth_price_refresh_runs WHERE user_id=? AND provider='google_sheets' AND trigger='manual' AND completed_at>datetime('now','-10 minutes') ORDER BY completed_at DESC LIMIT 1`).bind(uid).first<any>();
}
async function runningRun(c: AppContext, uid: number) {
  return c.env.DB.prepare(`SELECT id FROM wealth_price_refresh_runs WHERE user_id=? AND provider='google_sheets' AND status='processing' AND started_at>datetime('now','-15 minutes') ORDER BY id DESC LIMIT 1`).bind(uid).first<any>();
}
async function assetByExactKey(c: AppContext, uid: number) {
  const rows = (await c.env.DB.prepare(`SELECT * FROM investment_assets WHERE user_id=? AND is_active<>0 AND price_feed_asset_key IS NOT NULL`).bind(uid).all<any>()).results || [];
  const out = new Map<string, any>();
  for (const a of rows) {
    const k = normalizeFeedAssetKey(a.price_feed_asset_key);
    if (k && !out.has(k)) out.set(k, a);
  }
  return out;
}
async function fallbackStock(c: AppContext, uid: number, row: NormalizedFeedPrice) {
  if (!row.assetKey.startsWith('stock:') || !row.symbol || !row.exchange) return null;
  const rows = (await c.env.DB.prepare(`SELECT * FROM investment_assets WHERE user_id=? AND is_active<>0 AND asset_type='stock' AND UPPER(symbol)=? AND UPPER(exchange)=?`).bind(uid, row.symbol, row.exchange).all<any>()).results || [];
  return rows.length === 1 ? rows[0] : null;
}
async function saveFeedPrice(c: AppContext, uid: number, asset: any, row: NormalizedFeedPrice, force = false): Promise<SaveStatus> {
  const same = await c.env.DB.prepare('SELECT id,source,price,provider FROM investment_prices WHERE user_id=? AND asset_id=? AND price_date=?').bind(uid, asset.id, row.priceDate).first<any>();
  if (same?.source === 'manual' && !force) return 'skipped';
  const newer = await c.env.DB.prepare('SELECT id FROM investment_prices WHERE user_id=? AND asset_id=? AND price_date>? ORDER BY price_date DESC LIMIT 1').bind(uid, asset.id, row.priceDate).first<any>();
  if (newer && !force) return 'skipped';
  if (same && same.source !== 'manual' && Number(same.price) === Number(row.price) && same.provider === 'google_sheets') return 'unchanged';
  await c.env.DB.prepare(`INSERT INTO investment_prices (user_id,asset_id,price_date,price,currency,source,notes,provider,provider_symbol,provider_timestamp,fetched_at,source_type)
    VALUES (?,?,?,?,?,'market',?,?,?,?,datetime('now'),'google_sheets_feed')
    ON CONFLICT(user_id,asset_id,price_date) DO UPDATE SET
      price=CASE WHEN investment_prices.source='manual' AND ?=0 THEN investment_prices.price ELSE excluded.price END,
      currency=CASE WHEN investment_prices.source='manual' AND ?=0 THEN investment_prices.currency ELSE excluded.currency END,
      source=CASE WHEN investment_prices.source='manual' AND ?=0 THEN investment_prices.source ELSE excluded.source END,
      notes=CASE WHEN investment_prices.source='manual' AND ?=0 THEN investment_prices.notes ELSE excluded.notes END,
      provider=CASE WHEN investment_prices.source='manual' AND ?=0 THEN investment_prices.provider ELSE excluded.provider END,
      provider_symbol=CASE WHEN investment_prices.source='manual' AND ?=0 THEN investment_prices.provider_symbol ELSE excluded.provider_symbol END,
      provider_timestamp=CASE WHEN investment_prices.source='manual' AND ?=0 THEN investment_prices.provider_timestamp ELSE excluded.provider_timestamp END,
      fetched_at=CASE WHEN investment_prices.source='manual' AND ?=0 THEN investment_prices.fetched_at ELSE datetime('now') END,
      source_type=CASE WHEN investment_prices.source='manual' AND ?=0 THEN investment_prices.source_type ELSE excluded.source_type END,
      updated_at=datetime('now')`).bind(uid, asset.id, row.priceDate, row.price, row.currency, `Google Sheets feed: ${row.underlyingSource || 'sheet'}`, 'google_sheets', row.assetKey, row.capturedAt, force ? 1 : 0, force ? 1 : 0, force ? 1 : 0, force ? 1 : 0, force ? 1 : 0, force ? 1 : 0, force ? 1 : 0, force ? 1 : 0, force ? 1 : 0).run();
  await c.env.DB.prepare(`UPDATE investment_assets SET last_price_refresh_at=datetime('now'),last_price_refresh_status=?,last_price_refresh_error=NULL,last_provider_timestamp=?,last_provider_trade_date=?,updated_at=datetime('now') WHERE user_id=? AND id=?`).bind(same ? 'unchanged' : 'updated', row.capturedAt, row.priceDate, uid, asset.id).run();
  return same ? 'unchanged' : 'updated';
}
async function createRun(c: AppContext, uid: number, trigger: Trigger, targetDate: string) {
  const r = await c.env.DB.prepare(`INSERT INTO wealth_price_refresh_runs (user_id,provider,status,trigger,scope,target_date,requested_count) VALUES (?,'google_sheets','processing',?,'google_sheets',?,0)`).bind(uid, trigger, targetDate).run();
  return Number(r.meta.last_row_id);
}
async function finishRun(c: AppContext, runId: number, status: string, summary: any) {
  await c.env.DB.prepare(`UPDATE wealth_price_refresh_runs SET status=?,requested_count=?,updated_count=?,skipped_count=?,failed_count=?,provider_counts_json=?,result_json=?,warning_json=?,completed_at=datetime('now') WHERE id=?`).bind(status, summary.requested, summary.updated, summary.unchanged + summary.skipped + summary.unmapped, summary.failed, JSON.stringify({ google_sheets: summary.updated + summary.unchanged }), JSON.stringify(summary.results).slice(0, 50000), JSON.stringify(summary.warnings || []), runId).run();
}

export async function refreshGoogleSheetsPrices(c: AppContext, opts: { scope?: string; trigger?: Trigger; targetDate?: string; force?: boolean } = {}): Promise<GoogleSheetsRefreshResult> {
  if (priceFeedMode(c.env as any) !== 'google_sheets') throw new Error('Google Sheets price feed mode is not enabled.');
  const uid = c.get('userId'), targetDate = opts.targetDate || today(), trigger = opts.trigger || 'manual';
  if (scope(opts) !== 'google_sheets') throw new Error('Unsupported price refresh scope.');
  if (trigger === 'manual' && !opts.force && await recentManualRun(c, uid)) throw new Error('Manual refresh cooldown is active');
  if (await runningRun(c, uid)) throw new Error('A Google Sheets price refresh is already running');
  const runId = await createRun(c, uid, trigger, targetDate);
  try {
    const feed = await new GoogleSheetsPriceFeedProvider(c.env as any).fetchFeed();
    const mapped = await assetByExactKey(c, uid);
    const results: any[] = [];
    let updated = 0, unchanged = 0, skipped = 0, unmapped = 0, failed = 0, assetsMapped = 0;
    for (const row of feed.prices) {
      let asset = mapped.get(row.assetKey);
      let warning: string | undefined;
      if (!asset) {
        asset = await fallbackStock(c, uid, row);
        if (asset) warning = 'Fallback stock symbol/exchange mapping used';
      }
      if (!asset) {
        unmapped++;
        results.push({ assetKey: row.assetKey, assetType: row.assetType, status: 'unmapped', price: row.price, currency: row.currency, priceDate: row.priceDate, capturedAt: row.capturedAt, underlyingSource: row.underlyingSource, reason: 'No active owned asset mapping found' });
        continue;
      }
      assetsMapped++;
      try {
        const s = await saveFeedPrice(c, uid, asset, row, opts.force);
        if (s === 'updated') updated++;
        else if (s === 'unchanged') unchanged++;
        else skipped++;
        results.push({ assetId: asset.id, assetName: asset.name, assetKey: row.assetKey, assetType: row.assetType, status: s, price: row.price, currency: row.currency, priceDate: row.priceDate, capturedAt: row.capturedAt, underlyingSource: row.underlyingSource, ...(warning ? { reason: warning } : {}) });
      } catch (e) {
        failed++;
        await c.env.DB.prepare(`UPDATE investment_assets SET last_price_refresh_at=datetime('now'),last_price_refresh_status='failed',last_price_refresh_error=? WHERE user_id=? AND id=?`).bind(sanitize(e), uid, asset.id).run();
        results.push({ assetId: asset.id, assetName: asset.name, assetKey: row.assetKey, assetType: row.assetType, status: 'failed', reason: sanitize(e) });
      }
    }
    for (const r of feed.rejectedRows) results.push({ assetKey: r.assetKey, status: 'skipped', reason: r.reason });
    const status = failed ? (updated || unchanged || skipped || unmapped ? 'partially_completed' : 'failed') : 'completed';
    const summary: GoogleSheetsRefreshResult & { warnings: string[] } = { batchId: runId, provider: 'google_sheets', status, feedGeneratedAt: feed.generatedAt, rowsReceived: feed.diagnostics.rowsReceived, rowsAccepted: feed.diagnostics.rowsAccepted, rowsRejected: feed.diagnostics.rowsRejected, assetsMapped, requested: feed.prices.length, updated, unchanged, skipped, unmapped, failed, results, warnings: results.filter(r => /Fallback/.test(r.reason || '')).map(r => `${r.assetName || r.assetKey}: ${r.reason}`) };
    await finishRun(c, runId, status, summary);
    return summary;
  } catch (e) {
    const summary = { requested: 0, updated: 0, unchanged: 0, skipped: 0, unmapped: 0, failed: 1, results: [{ status: 'failed', reason: sanitize(e) }], warnings: [] };
    await c.env.DB.prepare(`UPDATE wealth_price_refresh_runs SET status='failed',failed_count=1,batch_error=?,result_json=?,completed_at=datetime('now') WHERE id=?`).bind(sanitize(e), JSON.stringify(summary.results), runId).run();
    throw new Error(sanitize(e));
  }
}
