import type { AppContext } from "./types";

export type RuleWritePlan = { statement: D1PreparedStatement; action: "created" | "updated"; existingId: number | null };

export function extractMerchantName(notes: any): string | null {
  const raw = notes == null ? "" : String(notes);
  const first = raw.includes("|") ? raw.split("|")[0] : raw;
  return first.trim() || null;
}
export function normalizeMerchantName(name: any): string | null {
  const s = name == null ? "" : String(name).trim().toLowerCase().replace(/\s+/g, " ");
  return s || null;
}
export function movementType(m: { src_kind?: any; dst_kind?: any }): "expense" | "income" | "transfer" {
  if (m.src_kind && m.dst_kind) return "transfer";
  if (m.dst_kind && !m.src_kind) return "income";
  return "expense";
}
export async function validateCategoryForType(c: AppContext, uid: number, categoryId: number | null, type: string) {
  if (categoryId == null) return null;
  if (type === "transfer") return "Categorization rules are only available for income or expense movements";
  const cat = await c.env.DB.prepare("SELECT id,type FROM categories WHERE user_id=? AND id=?").bind(uid, categoryId).first<any>();
  if (!cat) return "Category not found";
  if (cat.type !== type) return "Category is not compatible with movement type";
  return null;
}
export async function applySavedCategoryRule(c: AppContext, uid: number, m: any) {
  const merchant = extractMerchantName(m.description);
  const normalized = normalizeMerchantName(merchant);
  const type = movementType(m);
  if (!normalized || type === "transfer") return { ...m, applied_rule_id: null };
  const rule = await c.env.DB.prepare(`SELECT r.id,r.category_id FROM merchant_categorization_rules r JOIN categories c ON c.id=r.category_id AND c.user_id=r.user_id AND c.type=r.movement_type WHERE r.user_id=? AND r.normalized_merchant_name=? AND r.movement_type=? AND r.active=1 LIMIT 1`).bind(uid, normalized, type).first<any>();
  return rule ? { ...m, category_id: rule.category_id, applied_rule_id: rule.id } : { ...m, applied_rule_id: null };
}
export async function merchantRuleWrite(c: AppContext, uid: number, merchant: string, categoryId: number, type: string): Promise<RuleWritePlan> {
  const normalized = normalizeMerchantName(merchant)!;
  const existing = await c.env.DB.prepare("SELECT id FROM merchant_categorization_rules WHERE user_id=? AND normalized_merchant_name=? AND movement_type=? AND active=1 LIMIT 1").bind(uid, normalized, type).first<any>();
  return {
    action: existing ? "updated" : "created",
    existingId: existing?.id ?? null,
    statement: c.env.DB.prepare(`INSERT INTO merchant_categorization_rules (user_id,display_merchant_name,normalized_merchant_name,movement_type,category_id,active) VALUES (?,?,?,?,?,1) ON CONFLICT(user_id, normalized_merchant_name, movement_type, active) DO UPDATE SET display_merchant_name=excluded.display_merchant_name, category_id=excluded.category_id, updated_at=datetime('now')`).bind(uid, merchant, normalized, type, categoryId),
  };
}
export function bulkUpdateMerchantCategoriesStatement(c: AppContext, uid: number, merchant: string, categoryId: number, type: string) {
  const normalized = normalizeMerchantName(merchant)!;
  return c.env.DB.prepare(`UPDATE movements SET category_id=? WHERE user_id=? AND COALESCE(status,'active')='active' AND duplicate_of_movement_id IS NULL AND ${type === "expense" ? "src_kind IS NOT NULL AND dst_kind IS NULL" : "src_kind IS NULL AND dst_kind IS NOT NULL"} AND lower(replace(replace(replace(replace(replace(replace(replace(replace(trim(CASE WHEN instr(COALESCE(description,''),'|')>0 THEN substr(COALESCE(description,''),1,instr(COALESCE(description,''),'|')-1) ELSE COALESCE(description,'') END),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' '))=?`).bind(categoryId, uid, normalized);
}
export async function bulkUpdateMerchantCategories(c: AppContext, uid: number, merchant: string, categoryId: number, type: string) {
  const res = await bulkUpdateMerchantCategoriesStatement(c, uid, merchant, categoryId, type).run<any>();
  return Number(res.meta?.changes ?? 0);
}
