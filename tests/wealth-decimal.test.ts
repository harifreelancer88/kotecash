import { describe, expect, it } from 'vitest';
import { parseDecimal, formatDecimal, add, subtract, multiplyQuantityByPriceMinor, divideCostByQuantity } from '../src/server/wealth/decimal';
describe('wealth decimal utilities', () => {
  it('normalizes, calculates, and rejects malformed decimals', () => {
    expect(formatDecimal(parseDecimal('10.500000'))).toBe('10.5');
    expect(add('1.25','2.75')).toBe('4');
    expect(subtract('5','1.5')).toBe('3.5');
    expect(multiplyQuantityByPriceMinor('2.5','100')).toBe(250);
    expect(divideCostByQuantity(1000,'4')).toBe('250');
    expect(() => parseDecimal('1e3')).toThrow();
    expect(() => parseDecimal('-1')).toThrow();
  });
});
