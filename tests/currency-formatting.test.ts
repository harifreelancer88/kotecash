import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import { formatCurrency, fmt, rp } from '../src/lib/api';

const appContext = createContext({
  Intl,
  Number,
  String,
  Math,
  document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
  window: { addEventListener() {}, location: { href: '', search: '' }, history: { pushState() {} }, scrollTo() {} },
  console,
  fetch() { throw new Error('not called'); },
});
new Script(readFileSync('public/app.js', 'utf8')).runInContext(appContext);

const wealthContext = createContext({ Intl, Number, String, module: { exports: {} }, globalThis: {} });
new Script(readFileSync('public/js/wealth/helpers.js', 'utf8')).runInContext(wealthContext);
const H = wealthContext.module.exports as any;

describe('shared Indian currency formatting', () => {
  it('formats thousands, lakhs, crores, zero, negative, decimals, and nulls', () => {
    expect(formatCurrency(10000)).toBe('₹10,000');
    expect(formatCurrency(125000)).toBe('₹1,25,000');
    expect(formatCurrency(1204212)).toBe('₹12,04,212');
    expect(formatCurrency(13040212)).toBe('₹1,30,40,212');
    expect(formatCurrency(0)).toBe('₹0');
    expect(formatCurrency(-733)).toBe('-₹733');
    expect(formatCurrency(1234.5, 2)).toBe('₹1,234.50');
    expect(formatCurrency(null)).toBe('—');
    expect(rp(1304212)).toBe('₹13,04,212');
    expect(fmt(1204212)).toBe('12,04,212');
  });

  it('uses the same INR formatter in wealth and app helpers without Rp or dot grouping', () => {
    expect(H.money(1204212)).toBe('₹12,04,212');
    expect(H.money(-733)).toBe('-₹733');
    expect(H.money(1234.5, 2)).toBe('₹1,234.50');
    expect(appContext.fmtMoney(1204212)).toBe('₹12,04,212');
    expect(appContext.fmtMoney(-733)).toBe('-₹733');
    expect(appContext.fmtMoney(null)).toBe('—');
    const combined = [H.money(1204212), appContext.fmtMoney(1204212), readFileSync('public/app.js', 'utf8'), readFileSync('src/lib/api.ts', 'utf8')].join('\n');
    expect(combined).not.toContain('Rp');
    expect(combined).not.toMatch(/₹\d{1,3}(?:\.\d{3})+/);
  });
});
