import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { parseCsv, CSV_LIMITS } from '../wealth/csv';
import { validateMapping, normalizeImportRow, resolveAccount, resolveAsset, fingerprint, sha256Hex, existingSeq, validateNoOversell } from '../wealth/imports';
import { aggregateTradesByOrder, calculateCutoverOpeningPositions, reconcileOpeningHoldings } from '../wealth/cutover';

const route = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const bad = (error: string) => ({ error });
const PREVIEW_ERROR = 'Unable to create FY Cutover preview. Please retry.';

export const CUTOVER_PREVIEW_BATCH_INSERT = `INSERT INTO wealth_import_batches (user_id,file_name,file_hash,source_type,status,mapping_json,options_json,total_rows) VALUES (?,?,?,?,?,?,?,?)`;
export const CUTOVER_PREVIEW_ROW_INSERT = `INSERT INTO wealth_import_rows (user_id,batch_id,row_number,raw_json,normalized_json,fingerprint,status,error_code,error_message,warning_json) VALUES (?,?,?,?,?,?,?,?,?,?)`;

async function rowsFrom(file: File | null, mapping: any, opts: any) {
  if (!file) return { headers: [], rows: [], hash: '' };
  if (file.size > CSV_LIMITS.maxFileSize) throw new Error('CSV file exceeds 2 MB limit');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = parseCsv(bytes);
  const validMap = validateMapping(mapping, parsed.headers);
  const rows: any[] = [];
  for (const r of parsed.rows) rows.push(normalizeImportRow(r.raw, validMap, opts).normalized);
  return { headers: parsed.headers, rows, hash: await sha256Hex(bytes) };
}

async function cleanupPreviewBatch(c: any, uid: number, batchId: number | null) {
  if (!batchId) return;
  await c.env.DB.prepare('DELETE FROM wealth_import_rows WHERE user_id=? AND batch_id=?').bind(uid, batchId).run().catch(() => undefined);
  await c.env.DB.prepare('DELETE FROM wealth_import_batches WHERE user_id=? AND id=? AND status IN (\'previewed\',\'validated\')').bind(uid, batchId).run().catch(() => undefined);
}

async function insertPreview(c: any, uid: number, fileName: string, fileHash: string, sourceType: string, rows: any[], opts: any) {
  let batchId: number | null = null;
  try {
    const br = await c.env.DB.prepare(CUTOVER_PREVIEW_BATCH_INSERT)
      .bind(uid, fileName, fileHash, sourceType, 'previewed', '{}', JSON.stringify(opts), rows.length)
      .run();
    batchId = br.meta.last_row_id as number;
    let valid = 0, invalid = 0, dup = 0;
    const preview: any[] = [];
    const seen = new Set<string>();
    const seqs = new Map<string, any[]>();
    for (let i = 0; i < rows.length; i++) {
      let status = 'valid', err = null, acc: any = null, asset: any = null, fp: any = null;
      const n = rows[i];
      try {
        acc = await resolveAccount(c, uid, n, { default_account_id: opts.default_account_id });
        asset = await resolveAsset(c, uid, n);
        fp = await fingerprint(uid, n, acc, asset);
        if (seen.has(fp)) { status = 'duplicate'; err = 'Duplicate row'; } else seen.add(fp);
        if (status === 'valid' && n.transaction_type && acc.id && asset.id) {
          const tx = { ...n, account_id: acc.id, asset_id: asset.id };
          const key = `${acc.id}:${asset.id}`;
          const ex = seqs.get(key) || await existingSeq(c, uid, acc.id, asset.id);
          ex.push(tx);
          validateNoOversell(ex);
          seqs.set(key, ex);
        }
      } catch (e: any) { status = 'invalid'; err = e.message; }
      if (status === 'valid') valid++; else if (status === 'duplicate') dup++; else invalid++;
      await c.env.DB.prepare(CUTOVER_PREVIEW_ROW_INSERT)
        .bind(uid, batchId, i + 1, JSON.stringify(n), JSON.stringify({ ...n, account: acc, asset }), fp, status, status === 'invalid' ? 'validation_error' : status === 'duplicate' ? 'duplicate' : null, err, '[]')
        .run();
      if (preview.length < 100) preview.push({ row_number: i + 1, status, normalized: n, account: acc, asset, errors: err ? [err] : [] });
    }
    await c.env.DB.prepare(`UPDATE wealth_import_batches SET valid_rows=?,invalid_rows=?,duplicate_rows=?,status=?,updated_at=datetime('now') WHERE id=?`)
      .bind(valid, invalid, dup, invalid ? 'previewed' : 'validated', batchId)
      .run();
    return { batch_id: batchId, total_rows: rows.length, valid_rows: valid, invalid_rows: invalid, duplicate_rows: dup, rows: preview, can_commit: valid > 0 && invalid === 0 };
  } catch (e) {
    await cleanupPreviewBatch(c, uid, batchId);
    throw e;
  }
}

route.post('/preview', async c => {
  const uid = c.get('userId');
  try {
    const form = await c.req.formData();
    const prev = form.get('previous_tradebook') as File | null;
    if (!prev) return c.json(bad('previous_tradebook required'), 400);
    const cur = form.get('current_tradebook') as File | null;
    const mapping = JSON.parse(String(form.get('mapping') || '{}'));
    const accountId = Number(form.get('account_id'));
    const cutover = String(form.get('cutover_date') || '2026-04-01');
    const aggregate = String(form.get('aggregate_by_order') || 'false') === 'true';
    const opts = { default_account_id: accountId, default_currency: 'INR', default_asset_type: 'stock', default_account_type: 'brokerage' };
    let p = await rowsFrom(prev, mapping, opts);
    let current = await rowsFrom(cur, mapping, opts);
    if (aggregate) {
      p.rows = aggregateTradesByOrder(p.rows.map((r: any) => ({ ...r, external_ref: r.external_ref || r.order_id }))) as any;
      current.rows = aggregateTradesByOrder(current.rows as any) as any;
    }
    const calc = calculateCutoverOpeningPositions(p.rows.map((r: any) => ({ ...r, account_id: accountId, asset_id: r.isin || r.symbol })), cutover);
    const openings = calc.opening_positions.map((o: any) => ({ ...o, account_name: null, asset_name: o.symbol || o.isin, asset_type: 'stock', currency: 'INR' }));
    const currentFY = current.rows.filter((r: any) => !r.trade_date || r.trade_date >= cutover);
    const all = [...openings, ...currentFY];
    const hash = await sha256Hex(JSON.stringify({ p: p.hash, c: current.hash, cutover, accountId, aggregate }));
    const preview = await insertPreview(c, uid, `FY cutover ${cutover}`, hash, 'fy_cutover_tradebook', all, { ...opts, cutover_date: cutover, aggregate_by_order: aggregate });
    const reconciliation = reconcileOpeningHoldings(openings, []);
    return c.json({ preview_id: preview.batch_id, generated_opening_positions: openings, unresolved_securities: calc.unresolved, previous_period_closed_positions: calc.closed_positions, current_fy_transactions: currentFY, opening_quantity_reconciliation: reconciliation, warnings: calc.warnings, can_commit: calc.can_commit && preview.can_commit, proposed_import_batches: [{ batch_id: preview.batch_id, source_type: 'fy_cutover_tradebook', rows: all.length }], ...preview });
  } catch (e: any) {
    console.error('FY cutover preview failed', { message: e?.message, name: e?.name });
    return c.json(bad(PREVIEW_ERROR), 400);
  }
});

route.post('/:preview_id/commit', async c => {
  const id = c.req.param('preview_id');
  const body = await c.req.json().catch(() => ({}));
  return fetch(new URL(`/api/wealth/imports/${id}/commit`, c.req.url), { method: 'POST', headers: { 'content-type': 'application/json', cookie: c.req.header('cookie') || '', authorization: c.req.header('authorization') || '' }, body: JSON.stringify({ ...body, skip_duplicates: true }) });
});
export default route;
