export const DECIMAL_SCALE = 1_000_000n;
export type DecimalString = string;

// Rounding: inputs are truncated to 6 fractional places only when extra trailing zeros are supplied.
// Division and multiplication for money use half-up rounding to the nearest integer whole currency unit.
export function parseDecimal(value: unknown, opts: { allowZero?: boolean; allowNegative?: boolean } = {}): bigint {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') throw new Error('Invalid decimal');
  const raw = String(value).trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) throw new Error('Invalid decimal');
  if (/[eE]/.test(raw)) throw new Error('Scientific notation not allowed');
  const neg = raw.startsWith('-');
  if (neg && !opts.allowNegative) throw new Error('Negative decimal not allowed');
  const body = neg ? raw.slice(1) : raw;
  const [whole, frac = ''] = body.split('.');
  if (frac.length > 6 && !/^0+$/.test(frac.slice(6))) throw new Error('Too many decimal places');
  const scaled = BigInt(whole) * DECIMAL_SCALE + BigInt((frac.slice(0, 6)).padEnd(6, '0'));
  if (scaled === 0n && opts.allowZero === false) throw new Error('Decimal must be positive');
  return neg ? -scaled : scaled;
}
export function formatDecimal(scaled: bigint): string {
  const neg = scaled < 0n; const v = neg ? -scaled : scaled;
  const whole = v / DECIMAL_SCALE; let frac = (v % DECIMAL_SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}
export const add = (a: string, b: string) => formatDecimal(parseDecimal(a, { allowZero: true }) + parseDecimal(b, { allowZero: true }));
export const subtract = (a: string, b: string) => formatDecimal(parseDecimal(a, { allowZero: true }) - parseDecimal(b, { allowZero: true },));
export const compare = (a: string, b: string) => parseDecimal(a, { allowZero: true }) < parseDecimal(b, { allowZero: true }) ? -1 : parseDecimal(a, { allowZero: true }) > parseDecimal(b, { allowZero: true }) ? 1 : 0;
export function multiplyQuantityByPriceMinor(quantity: string, price: string): number {
  const q = parseDecimal(quantity, { allowZero: true }); const p = parseDecimal(price, { allowZero: true });
  return Number((q * p + DECIMAL_SCALE / 2n) / (DECIMAL_SCALE * DECIMAL_SCALE));
}
export function divideCostByQuantity(costMinor: number, quantity: string): string {
  const q = parseDecimal(quantity, { allowZero: false });
  return formatDecimal((BigInt(costMinor) * DECIMAL_SCALE * DECIMAL_SCALE + q / 2n) / q);
}
