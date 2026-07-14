import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const context = createContext({ Intl, Number, String, module: { exports: {} }, globalThis: {} });
new Script(readFileSync('public/js/wealth/helpers.js', 'utf8')).runInContext(context);
const H = context.module.exports as any;

describe('wealth UI helpers', () => {
  it('formats INR whole-unit integers with en-IN grouping', () => {
    expect(H.money(12345678)).toBe('₹1,23,45,678');
    expect(H.money(10000)).toBe('₹10,000');
  });
  it('formats decimal quantities safely', () => {
    expect(H.qty('12.345678901')).toBe('12.3456789');
  });
  it('has the split helper label', () => {
    expect(H.splitHelp()).toBe('Enter 2 for a 2-for-1 split.');
  });
  it('does not emit NaN or Infinity in helper display strings', () => {
    expect([H.money(Number.NaN), H.qty(Number.POSITIVE_INFINITY), H.price('nope')].join(' ')).not.toMatch(/NaN|Infinity/);
  });
  it('ships Phase 9.1 typed form and safety affordances', () => {
    const accounts = readFileSync('public/js/wealth/accounts.js', 'utf8');
    const assets = readFileSync('public/js/wealth/assets.js', 'utf8');
    const valuations = readFileSync('public/js/wealth/valuations.js', 'utf8');
    const css = readFileSync('src/styles/globals.css', 'utf8');
    expect(accounts).toContain('uan_masked');
    expect(accounts).toContain('Delete permanently');
    expect(accounts).toContain('Create valuation');
    expect(assets).toContain('amfi_code');
    expect(assets).toContain('compounding_frequency');
    expect(assets).toContain('purity');
    expect(valuations).toContain('No manual valuation snapshots yet.');
    expect(valuations).toContain('Create from legacy value');
    expect(css).toContain('.wealth-table');
    expect(css).toContain('overflow-x: auto');
    expect(css).toContain('min-height: 36px');
  });
});
