import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";
import { ACCOUNT_TYPES, VALUATION_MODES } from "../wealth/types";
import { getWealthAccountValuations } from "../wealth/valuation";
import { isDateOnly, isEnumValue, normalizeCurrency, optionalText, parseQueryBoolean, requiredText } from "../wealth/validation";

const wealthAccounts = new Hono<{ Bindings: Bindings; Variables: Variables }>();

async function duplicateName(c: AppContext, uid: number, name: string, excludeId?: number) {
  const sql = `SELECT id FROM portfolios WHERE user_id=? AND is_active=1 AND lower(name)=lower(?)${excludeId ? " AND id<>?" : ""} LIMIT 1`;
  const row = await c.env.DB.prepare(sql).bind(...(excludeId ? [uid, name, excludeId] : [uid, name])).first<{ id: number }>();
  return !!row;
}

function bad(message: string) { return { error: message }; }
const today = () => new Date().toISOString().slice(0, 10);
function routeId(c: AppContext) {
  const direct = Number(c.req.param("id"));
  if (Number.isInteger(direct)) return direct;
  return Number(new URL(c.req.url).pathname.match(/\/(\d+)\/(?:permanent|delete-check)$/)?.[1]);
}

function normalizeBody(body: any, partial = false) {
  const out: any = {};
  if (!partial || "name" in body) {
    const name = requiredText(body.name);
    if (!name) return { error: "Name required" };
    out.name = name;
  }
  if (!partial || "account_type" in body) {
    const v = body.account_type ?? "other";
    if (!isEnumValue(ACCOUNT_TYPES, v)) return { error: "Invalid account_type" };
    out.account_type = v;
  }
  if (!partial || "valuation_mode" in body) {
    const v = body.valuation_mode ?? "manual_snapshot";
    if (!isEnumValue(VALUATION_MODES, v)) return { error: "Invalid valuation_mode" };
    out.valuation_mode = v;
  }
  if (!partial || "currency" in body) {
    const currency = normalizeCurrency(body.currency);
    if (!currency) return { error: "Invalid currency" };
    out.currency = currency;
  }
  for (const f of ["institution", "account_number_masked", "notes"] as const) if (!partial || f in body) out[f] = optionalText(body[f]);
  if (!partial || "metadata" in body) out.metadata = body.metadata == null || body.metadata === "" ? null : (typeof body.metadata === "string" ? body.metadata : JSON.stringify(body.metadata));
  for (const f of ["opened_at", "closed_at"] as const) if (!partial || f in body) {
    const v = optionalText(body[f]);
    if (v && !isDateOnly(v)) return { error: `Invalid ${f}` };
    out[f] = v;
  }
  for (const f of ["is_active", "include_in_net_worth"] as const) if (!partial || f in body) out[f] = body[f] === false || body[f] === 0 ? 0 : 1;
  return { value: out };
}

wealthAccounts.get("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const active = parseQueryBoolean(c.req.query("active") ?? null);
  if (active === null) return c.json(bad("Invalid active filter"), 400);
  const accountType = c.req.query("account_type");
  if (accountType && !isEnumValue(ACCOUNT_TYPES, accountType)) return c.json(bad("Invalid account_type"), 400);
  const wh = ["user_id=?"];
  const binds: any[] = [uid];
  if (active !== undefined) { wh.push("is_active=?"); binds.push(active ? 1 : 0); }
  if (accountType) { wh.push("account_type=?"); binds.push(accountType); }
  const res = await c.env.DB.prepare(`SELECT * FROM portfolios WHERE ${wh.join(" AND ")} ORDER BY id`).bind(...binds).all<any>();
  const valuationRows = await getWealthAccountValuations(c.env.DB, uid, c.req.query("as_of") || today());
  const byId = new Map(valuationRows.accounts.map((v) => [v.account_id, v]));
  return c.json(res.results.map((p: any) => {
    const v = byId.get(p.id);
    return {
      ...p,
      currentValue: v?.value ?? 0,
      valuation_source: v?.valuation_source ?? "unavailable",
      valuation_date: v?.valuation_date ?? null,
      source_record_id: v?.source_record_id ?? null,
      valuation_status: v?.valuation_status ?? "unavailable",
      valuation_message: v?.valuation_message ?? "Valuation unavailable",
      valuation_warnings: v?.warnings ?? [],
      holding_count: v?.holding_count ?? 0,
    };
  }));
});

wealthAccounts.post("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json();
  const normalized = normalizeBody(body);
  if ("error" in normalized) return c.json(bad(normalized.error), 400);
  const v = normalized.value;
  if (await duplicateName(c, uid, v.name)) return c.json(bad("Active account name already exists"), 400);
  const opening = body.opening_value == null || body.opening_value === "" ? 0 : Number(body.opening_value);
  if (!Number.isFinite(opening) || opening < 0) return c.json(bad("Invalid opening_value"), 400);
  const res = await c.env.DB.prepare(`INSERT INTO portfolios (user_id, name, value, account_type, institution, account_number_masked, currency, opened_at, include_in_net_worth, valuation_mode, notes, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(uid, v.name, opening, v.account_type, v.institution, v.account_number_masked, v.currency, v.opened_at, v.include_in_net_worth, v.valuation_mode, v.notes, v.metadata).run();
  if (opening > 0) await c.env.DB.prepare("INSERT INTO balance_history (user_id, entity_kind, entity_id, amount) VALUES (?, 'portfolio', ?, ?)").bind(uid, res.meta.last_row_id, opening).run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

async function accountDependencies(c: AppContext, uid: number, id: number) {
  const row = await c.env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM investment_assets WHERE user_id=? AND account_id=?) assets,
    (SELECT COUNT(*) FROM investment_transactions WHERE user_id=? AND account_id=?) transactions,
    (SELECT COUNT(*) FROM investment_prices WHERE user_id=? AND asset_id IN (SELECT id FROM investment_assets WHERE user_id=? AND account_id=?)) prices,
    (SELECT COUNT(*) FROM wealth_valuation_snapshots WHERE user_id=? AND account_id=?) snapshots,
    (SELECT COUNT(*) FROM wealth_import_rows WHERE user_id=? AND created_account_id=?) import_rows,
    (SELECT COUNT(*) FROM investment_transactions WHERE user_id=? AND account_id=? AND import_batch_id IS NOT NULL) import_transactions,
    (SELECT COUNT(*) FROM movements WHERE user_id=? AND ((src_kind='portfolio' AND src_id=?) OR (dst_kind='portfolio' AND dst_id=?))) movements,
    (SELECT COUNT(*) FROM balance_history WHERE user_id=? AND entity_kind='portfolio' AND entity_id=?) legacy_balance_history,
    (SELECT COUNT(*) FROM earmarks WHERE user_id=? AND source_type='portfolio' AND source_id=?) earmarks,
    (SELECT COUNT(*) FROM net_worth_snapshots WHERE user_id=? AND locked<>0) locked_net_worth_snapshots`).bind(
      uid, id, uid, id, uid, uid, id, uid, id, uid, id, uid, id, uid, id, id, uid, id, uid, id, uid,
    ).first<any>();
  return Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [k, Number(v || 0)]));
}
function canDelete(deps: Record<string, number>) { return Object.values(deps).every((v) => v === 0); }

wealthAccounts.get("/:id/delete-check", async (c: AppContext) => {
  const uid = c.get("userId"); const id = routeId(c);
  const existing = await c.env.DB.prepare("SELECT id, name FROM portfolios WHERE id=? AND user_id=?").bind(id, uid).first<any>();
  if (!existing) return c.json(bad("Not found"), 404);
  const dependencies = await accountDependencies(c, uid, id);
  return c.json({ can_delete: canDelete(dependencies), dependencies });
});

async function permanentDeleteAccount(c: AppContext) {
  const uid = c.get("userId"); const id = routeId(c);
  const existing = await c.env.DB.prepare("SELECT id, name, institution, account_type FROM portfolios WHERE id=? AND user_id=?").bind(id, uid).first<any>();
  if (!existing) return c.json(bad("Not found"), 404);
  const dependencies = await accountDependencies(c, uid, id);
  if (!canDelete(dependencies)) return c.json({ can_delete: false, dependencies, error: "Account has financial history and cannot be permanently deleted" }, 409);
  const res = await c.env.DB.prepare("DELETE FROM portfolios WHERE id=? AND user_id=?").bind(id, uid).run();
  if ((res.meta as any).changes === 0) return c.json(bad("Not found"), 404);
  return c.json({ success: true, can_delete: true, dependencies });
}

wealthAccounts.delete("/:id/permanent", permanentDeleteAccount);

wealthAccounts.put("/:id", async (c: AppContext) => {
  const uid = c.get("userId"); const id = Number(c.req.param("id"));
  const existing = await c.env.DB.prepare("SELECT id FROM portfolios WHERE id=? AND user_id=?").bind(id, uid).first();
  if (!existing) return c.json(bad("Not found"), 404);
  const body = await c.req.json(); const normalized = normalizeBody(body, true);
  if ("error" in normalized) return c.json(bad(normalized.error), 400);
  const v = normalized.value;
  if (v.name && (v.is_active ?? body.is_active) !== 0 && await duplicateName(c, uid, v.name, id)) return c.json(bad("Active account name already exists"), 400);
  const fields = Object.keys(v); if (!fields.length) return c.json({ success: true });
  await c.env.DB.prepare(`UPDATE portfolios SET ${fields.map((f) => `${f}=?`).join(", ")}, updated_at=datetime('now') WHERE id=? AND user_id=?`).bind(...fields.map((f) => v[f]), id, uid).run();
  return c.json({ success: true });
});

wealthAccounts.delete("/:id", async (c: AppContext) => {
  if (new URL(c.req.url).pathname.endsWith("/permanent")) return permanentDeleteAccount(c);
  const uid = c.get("userId"); const id = Number(c.req.param("id"));
  const res = await c.env.DB.prepare("UPDATE portfolios SET is_active=0, updated_at=datetime('now') WHERE id=? AND user_id=?").bind(id, uid).run();
  if ((res.meta as any).changes === 0) return c.json(bad("Not found"), 404);
  return c.json({ success: true });
});

export default wealthAccounts;
