import { describe, it, expect, vi } from 'vitest';
import { extractMerchantName, normalizeMerchantName, movementType, applySavedCategoryRule, bulkUpdateMerchantCategories } from '../src/server/categorization-rules';

describe('merchant categorization helpers', () => {
  it('extracts merchant before first pipe', () => expect(extractMerchantName('P Murugeshan | UPI:656653039347 | PennyWise')).toBe('P Murugeshan'));
  it('uses trimmed notes without pipe', () => expect(extractMerchantName('  P Murugeshan  ')).toBe('P Murugeshan'));
  it('normalizes case and whitespace', () => expect(normalizeMerchantName(' P   Murugeshan ')).toBe('p murugeshan'));
  it('uses exact normalized matching semantics', () => {
    const n = normalizeMerchantName('P Murugeshan');
    expect(normalizeMerchantName('p murugeshan')).toBe(n);
    expect(normalizeMerchantName(' P   Murugeshan ')).toBe(n);
    expect(normalizeMerchantName('P Murugeshan Store')).not.toBe(n);
    expect(normalizeMerchantName('Murugeshan')).not.toBe(n);
    expect(normalizeMerchantName('P Murugesan')).not.toBe(n);
  });
  it('keeps expense rules separate from income movement type', () => {
    expect(movementType({ src_kind: 'wallet', dst_kind: null })).toBe('expense');
    expect(movementType({ src_kind: null, dst_kind: 'wallet' })).toBe('income');
  });
  it('applies a saved category rule and overrides incoming category', async () => {
    const first = vi.fn(async () => ({ id: 4, category_id: 9 }));
    const c: any = { env: { DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })) } } };
    const m = await applySavedCategoryRule(c, 1, { description: 'P Murugeshan | UPI', category_id: 2, src_kind: 'wallet', dst_kind: null });
    expect(m.category_id).toBe(9);
    expect(m.applied_rule_id).toBe(4);
  });
  it('bulk update changes only active matching category_id scoped by user and type', async () => {
    const run = vi.fn(async () => ({ meta: { changes: 6 } }));
    const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ run })) }));
    const c: any = { env: { DB: { prepare } } };
    await expect(bulkUpdateMerchantCategories(c, 1, 'P Murugeshan', 3, 'expense')).resolves.toBe(6);
    const sql = (prepare.mock.calls as any)[0][0];
    expect(sql).toMatch(/^UPDATE movements SET category_id=\?/);
    expect(sql).toMatch(/user_id=\?/);
    expect(sql).toMatch(/COALESCE\(status,'active'\)='active'/);
    expect(sql).toMatch(/src_kind IS NOT NULL AND dst_kind IS NULL/);
    expect(sql).not.toMatch(/amount=|date=|raw_sms_hash|pennywise_sync_records|created_at=/);
  });
});
