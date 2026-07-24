import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";
import { ASSET_TYPES, PRICE_SOURCES, PRICING_MODES, VALUATION_MODES } from "../wealth/types";
import { diagnoseAssetIdentifierAmbiguity } from "../wealth/imports";
import { isEnumValue, normalizeCurrency, normalizeIdentifier, optionalText, parseQueryBoolean, requiredText } from "../wealth/validation";
import { normalizeFeedAssetKey } from "../wealth/google-sheets-price-feed";

const wealthAssets = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const editable = ["asset_type", "name", "symbol", "isin", "exchange", "scheme_code", "currency", "price_source", "pricing_mode", "valuation_mode", "account_id", "is_active", "notes", "metadata", "price_provider", "provider_symbol", "provider_exchange", "provider_scheme_code", "automatic_price_refresh", "last_price_refresh_at", "last_price_refresh_status", "last_price_refresh_error", "last_provider_timestamp", "last_provider_trade_date", "price_feed_asset_key"];
function bad(error: string) { return { error }; }
function routeId(c: AppContext) {
  const direct = Number(c.req.param("id"));
  if (Number.isInteger(direct)) return direct;
  return Number(new URL(c.req.url).pathname.match(/\/(\d+)\/(?:permanent|delete-check)$/)?.[1]);
}

function normalize(body: any, partial = false) {
  const out: any = {};
  if (!partial || "name" in body) { const name = requiredText(body.name); if (!name) return { error: "Name required" }; out.name = name; }
  if (!partial || "asset_type" in body) { const v = body.asset_type ?? "other"; if (!isEnumValue(ASSET_TYPES, v)) return { error: "Invalid asset_type" }; out.asset_type = v; }
  if (!partial || "price_source" in body) { const v = body.price_source ?? "manual"; if (!isEnumValue(PRICE_SOURCES, v)) return { error: "Invalid price_source" }; out.price_source = v; }
  if (!partial || "pricing_mode" in body) { const v = body.pricing_mode ?? "manual"; if (!isEnumValue(PRICING_MODES, v)) return { error: "Invalid pricing_mode" }; out.pricing_mode = v; }
  if (!partial || "valuation_mode" in body) { const v = body.valuation_mode ?? null; if (v && !isEnumValue(VALUATION_MODES, v)) return { error: "Invalid valuation_mode" }; out.valuation_mode = v; }
  if (!partial || "currency" in body) { const c = normalizeCurrency(body.currency); if (!c) return { error: "Invalid currency" }; out.currency = c; }
  for (const f of ["symbol", "isin", "exchange", "scheme_code", "provider_symbol", "provider_exchange", "provider_scheme_code"] as const) if (!partial || f in body) out[f] = normalizeIdentifier(body[f]);
  if (!partial || "price_feed_asset_key" in body) out.price_feed_asset_key = normalizeFeedAssetKey(body.price_feed_asset_key);
  if (!partial || "notes" in body) out.notes = optionalText(body.notes);
  if (!partial || "metadata" in body) out.metadata = body.metadata == null || body.metadata === "" ? null : (typeof body.metadata === "string" ? body.metadata : JSON.stringify(body.metadata));
  if (!partial || "account_id" in body) out.account_id = body.account_id == null || body.account_id === "" ? null : Number(body.account_id);
  if (!partial || "is_active" in body) out.is_active = body.is_active === false || body.is_active === 0 ? 0 : 1;
  if (!partial || "automatic_price_refresh" in body) out.automatic_price_refresh = body.automatic_price_refresh === true || body.automatic_price_refresh === 1 ? 1 : 0;
  if (!partial || "price_provider" in body) { const v = body.price_provider ?? "manual"; if (!["manual","nse_bhavcopy","yahoo_finance","mfapi"].includes(v)) return { error: "Invalid price_provider" }; out.price_provider = v; }
  return { value: out };
}

async function duplicate(c: AppContext, uid: number, v: any, excludeId?: number) {
  const extra = excludeId ? " AND id<>?" : "";
  const tail = excludeId ? [excludeId] : [];
  if (v.isin) {
    const row = await c.env.DB.prepare(`SELECT id FROM investment_assets WHERE user_id=? AND isin=?${extra} LIMIT 1`).bind(uid, v.isin, ...tail).first();
    if (row) return "ISIN already exists";
  }
  if (v.scheme_code) {
    const row = await c.env.DB.prepare(`SELECT id FROM investment_assets WHERE user_id=? AND scheme_code=?${extra} LIMIT 1`).bind(uid, v.scheme_code, ...tail).first();
    if (row) return "Scheme code already exists";
  }
  if (v.symbol && v.exchange && v.asset_type) {
    const row = await c.env.DB.prepare(`SELECT id FROM investment_assets WHERE user_id=? AND symbol=? AND exchange=? AND asset_type=?${extra} LIMIT 1`).bind(uid, v.symbol, v.exchange, v.asset_type, ...tail).first();
    if (row) return "Symbol/exchange/type already exists";
  }
  if (v.price_feed_asset_key && v.is_active !== 0) {
    const row = await c.env.DB.prepare(`SELECT id FROM investment_assets WHERE user_id=? AND is_active<>0 AND lower(price_feed_asset_key)=lower(?)${extra} LIMIT 1`).bind(uid, v.price_feed_asset_key, ...tail).first();
    if (row) return "Google Sheets asset key already exists";
  }
  if (!v.isin && !v.scheme_code && !v.symbol && !v.exchange && v.name && v.asset_type) {
    const row = await c.env.DB.prepare(`SELECT id FROM investment_assets WHERE user_id=? AND is_active=1 AND lower(name)=lower(?) AND asset_type=?${extra} LIMIT 1`).bind(uid, v.name, v.asset_type, ...tail).first();
    if (row) return "Active asset name/type already exists";
  }
  return null;
}

wealthAssets.get("/", async (c: AppContext) => {
  const uid = c.get("userId"); const active = parseQueryBoolean(c.req.query("active") ?? null);
  if (active === null) return c.json(bad("Invalid active filter"), 400);
  const type = c.req.query("asset_type"); if (type && !isEnumValue(ASSET_TYPES, type)) return c.json(bad("Invalid asset_type"), 400);
  const q = optionalText(c.req.query("q")); const wh = ["user_id=?"]; const binds: any[] = [uid];
  if (active !== undefined) { wh.push("is_active=?"); binds.push(active ? 1 : 0); }
  if (type) { wh.push("asset_type=?"); binds.push(type); }
  if (q) { wh.push("(name LIKE ? OR symbol LIKE ? OR isin LIKE ? OR scheme_code LIKE ?)"); binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  const res = await c.env.DB.prepare(`SELECT ${editable.join(", ")}, id, created_at, updated_at FROM investment_assets WHERE ${wh.join(" AND ")} ORDER BY name, id`).bind(...binds).all();
  return c.json(res.results);
});

wealthAssets.get("/diagnostics/duplicates", async (c: AppContext) => {
  const uid = c.get("userId");
  const isin = normalizeIdentifier(c.req.query("isin"));
  const scheme_code = normalizeIdentifier(c.req.query("scheme_code"));
  const symbol = normalizeIdentifier(c.req.query("symbol"));
  const exchange = normalizeIdentifier(c.req.query("exchange"));
  const asset_type = optionalText(c.req.query("asset_type"));
  if (!isin && !scheme_code && !(symbol && exchange && asset_type)) return c.json(bad("Identifier required"), 400);
  const assets = await diagnoseAssetIdentifierAmbiguity(c, uid, { isin, scheme_code, symbol, exchange, asset_type });
  return c.json({ ambiguous: assets.length > 1, assets });
});

wealthAssets.post("/", async (c: AppContext) => {
  const uid = c.get("userId"); const body = await c.req.json(); const n = normalize(body);
  if ("error" in n) return c.json(bad(n.error), 400); const v = n.value;
  const dup = await duplicate(c, uid, v); if (dup) return c.json(bad(dup), 400);
  const fields = editable.filter((f) => f in v);
  const res = await c.env.DB.prepare(`INSERT INTO investment_assets (user_id, ${fields.join(", ")}) VALUES (?, ${fields.map(() => "?").join(", ")})`).bind(uid, ...fields.map((f) => v[f])).run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

wealthAssets.put("/:id", async (c: AppContext) => {
  const uid = c.get("userId"); const id = Number(c.req.param("id"));
  const existing = await c.env.DB.prepare("SELECT * FROM investment_assets WHERE id=? AND user_id=?").bind(id, uid).first<any>();
  if (!existing) return c.json(bad("Not found"), 404);
  const n = normalize(await c.req.json(), true); if ("error" in n) return c.json(bad(n.error), 400);
  const v = { ...existing, ...n.value }; const dup = await duplicate(c, uid, v, id); if (dup) return c.json(bad(dup), 400);
  const fields = Object.keys(n.value); if (!fields.length) return c.json({ success: true });
  await c.env.DB.prepare(`UPDATE investment_assets SET ${fields.map((f) => `${f}=?`).join(", ")}, updated_at=datetime('now') WHERE id=? AND user_id=?`).bind(...fields.map((f) => n.value[f]), id, uid).run();
  return c.json({ success: true });
});

async function assetDependencies(c: AppContext, uid: number, id: number) {
  const row = await c.env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM investment_transactions WHERE user_id=? AND asset_id=?) transactions,
    (SELECT COUNT(*) FROM investment_prices WHERE user_id=? AND asset_id=?) prices,
    (SELECT COUNT(*) FROM wealth_valuation_snapshots WHERE user_id=? AND asset_id=?) snapshots,
    (SELECT COUNT(*) FROM wealth_import_rows WHERE user_id=? AND created_asset_id=?) import_rows,
    (SELECT COUNT(*) FROM investment_transactions WHERE user_id=? AND asset_id=? AND import_batch_id IS NOT NULL) import_transactions,
    (SELECT COUNT(*) FROM investment_prices WHERE user_id=? AND asset_id=? AND import_batch_id IS NOT NULL) import_prices,
    (SELECT COUNT(*) FROM movements WHERE user_id=? AND ((src_kind='investment_asset' AND src_id=?) OR (dst_kind='investment_asset' AND dst_id=?))) movements,
    (SELECT COUNT(*) FROM investment_transactions WHERE user_id=? AND asset_id=? AND transaction_type IN ('buy','sell','sip','transfer_in','transfer_out','bonus','split','contribution','employer_contribution','employee_contribution')) holdings`).bind(
      uid, id, uid, id, uid, id, uid, id, uid, id, uid, id, uid, id, id, uid, id,
    ).first<any>();
  return Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [k, Number(v || 0)]));
}
function canDelete(deps: Record<string, number>) { return Object.values(deps).every((v) => v === 0); }

wealthAssets.get("/:id/delete-check", async (c: AppContext) => {
  const uid = c.get("userId"); const id = routeId(c);
  const existing = await c.env.DB.prepare("SELECT id FROM investment_assets WHERE id=? AND user_id=?").bind(id, uid).first<any>();
  if (!existing) return c.json(bad("Not found"), 404);
  const dependencies = await assetDependencies(c, uid, id);
  return c.json({ can_delete: canDelete(dependencies), dependencies });
});

async function permanentDeleteAsset(c: AppContext) {
  const uid = c.get("userId"); const id = routeId(c);
  const existing = await c.env.DB.prepare("SELECT id FROM investment_assets WHERE id=? AND user_id=?").bind(id, uid).first<any>();
  if (!existing) return c.json(bad("Not found"), 404);
  const dependencies = await assetDependencies(c, uid, id);
  if (!canDelete(dependencies)) return c.json({ can_delete: false, dependencies, error: "Asset has financial history and cannot be permanently deleted" }, 409);
  const res = await c.env.DB.prepare("DELETE FROM investment_assets WHERE id=? AND user_id=?").bind(id, uid).run();
  if ((res.meta as any).changes === 0) return c.json(bad("Not found"), 404);
  return c.json({ success: true, can_delete: true, dependencies });
}

wealthAssets.delete("/:id/permanent", permanentDeleteAsset);

wealthAssets.delete("/:id", async (c: AppContext) => {
  if (new URL(c.req.url).pathname.endsWith("/permanent")) return permanentDeleteAsset(c);
  const uid = c.get("userId"); const id = Number(c.req.param("id"));
  const existing = await c.env.DB.prepare("SELECT id, isin, scheme_code, symbol, exchange, asset_type FROM investment_assets WHERE id=? AND user_id=?").bind(id, uid).first<any>();
  if (!existing) return c.json(bad("Not found"), 404);
  const usage = await c.env.DB.prepare(`SELECT
    CASE WHEN EXISTS (SELECT 1 FROM investment_transactions WHERE user_id=? AND asset_id=?) THEN 1 ELSE 0 END has_transactions,
    CASE WHEN EXISTS (SELECT 1 FROM investment_prices WHERE user_id=? AND asset_id=?) THEN 1 ELSE 0 END has_prices`).bind(uid, id, uid, id).first<any>();
  if (usage?.has_transactions || usage?.has_prices) return c.json(bad("Asset is referenced by surviving transactions or prices and cannot be deactivated"), 400);
  const res = await c.env.DB.prepare("UPDATE investment_assets SET is_active=0, updated_at=datetime('now') WHERE id=? AND user_id=?").bind(id, uid).run();
  if ((res.meta as any).changes === 0) return c.json(bad("Not found"), 404);
  return c.json({ success: true });
});
export default wealthAssets;
