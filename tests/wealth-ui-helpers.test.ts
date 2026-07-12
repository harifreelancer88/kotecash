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
});
