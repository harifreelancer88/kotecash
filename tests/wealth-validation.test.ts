import { describe, expect, it } from 'vitest';
import { ACCOUNT_TYPES, ASSET_TYPES, PRICE_SOURCES, PRICING_MODES, VALUATION_MODES } from '../src/server/wealth/types';
import { isDateOnly, isEnumValue, normalizeCurrency, parseQueryBoolean } from '../src/server/wealth/validation';

describe('wealth validation helpers', () => {
  it('validates wealth enums', () => {
    expect(isEnumValue(ACCOUNT_TYPES, 'brokerage')).toBe(true);
    expect(isEnumValue(VALUATION_MODES, 'manual_snapshot')).toBe(true);
    expect(isEnumValue(ASSET_TYPES, 'stock')).toBe(true);
    expect(isEnumValue(PRICE_SOURCES, 'nav')).toBe(true);
    expect(isEnumValue(PRICING_MODES, 'account_level')).toBe(true);
    expect(isEnumValue(ACCOUNT_TYPES, 'bank')).toBe(false);
  });

  it('normalizes and validates currency', () => {
    expect(normalizeCurrency('inr')).toBe('INR');
    expect(normalizeCurrency(undefined)).toBe('INR');
    expect(normalizeCurrency('US')).toBeNull();
    expect(normalizeCurrency('USDT')).toBeNull();
  });

  it('parses true/false query params', () => {
    expect(parseQueryBoolean('true')).toBe(true);
    expect(parseQueryBoolean('false')).toBe(false);
    expect(parseQueryBoolean(null)).toBeUndefined();
    expect(parseQueryBoolean('yes')).toBeNull();
  });

  it('validates YYYY-MM-DD dates', () => {
    expect(isDateOnly('2026-07-12')).toBe(true);
    expect(isDateOnly('2026-02-31')).toBe(false);
    expect(isDateOnly('07/12/2026')).toBe(false);
  });
});
