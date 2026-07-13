import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const context = createContext({ setTimeout, fetch: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => [] }), document: { getElementById: () => null, querySelectorAll: () => [] }, module: { exports: {} }, globalThis: {} });
new Script(readFileSync('public/js/wealth/ai-import.js', 'utf8')).runInContext(context);
const AI = context.module.exports as any;

describe('wealth AI import UI helpers', () => {
  it('shows CSV consent only for CSV files', () => {
    expect(AI.csvConsentVisible({ name: 'trades.csv', type: '' })).toBe(true);
    expect(AI.csvConsentVisible({ name: 'trades.txt', type: 'text/csv' })).toBe(true);
    expect(AI.csvConsentVisible({ name: 'statement.pdf', type: 'application/pdf' })).toBe(false);
    expect(AI.csvConsentVisible({ name: 'scan.png', type: 'image/png' })).toBe(false);
  });
  it('resets CSV consent when changing from CSV to non-CSV', () => {
    expect(AI.shouldResetCsvConsent({ name: 'a.csv', type: 'text/csv' }, { name: 'a.pdf', type: 'application/pdf' })).toBe(true);
    expect(AI.shouldResetCsvConsent({ name: 'a.pdf', type: 'application/pdf' }, { name: 'b.csv', type: 'text/csv' })).toBe(false);
    expect(AI.shouldResetCsvConsent({ name: 'a.csv', type: 'text/csv' }, { name: 'b.csv', type: 'text/csv' })).toBe(false);
  });
});
