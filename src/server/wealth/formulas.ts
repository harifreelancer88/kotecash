import { compare, divideCostByQuantity, formatDecimal, multiplyQuantityByPriceMinor, parseDecimal } from './decimal';
import type { AssetType, PricingMode } from './types';

export type InvestmentTransactionInput = { id?: number; account_id: number; asset_id?: number | null; transaction_type: string; trade_date: string; quantity?: string | null; unit_price?: string | null; gross_amount?: number | null; charges?: number | null; taxes?: number | null; net_amount?: number | null };
export type PriceInput = { asset_id: number; price_date: string; price: string };
export type HoldingLot = { quantity: string; cost_basis: number; source_transaction_id?: number };
export type HoldingResult = { quantity: string; lots: HoldingLot[]; remaining_cost_basis: number; average_cost: string | null; total_invested: number; realised_sale_proceeds: number; fifo_cost_disposed: number; realised_gain: number; latest_price?: string | null; latest_price_date?: string | null; current_value: number | null; unrealised_gain: number | null; total_gain: number | null; absolute_return_pct: number | null; stale_price: boolean; warnings: string[] };

const buyTypes = new Set(['buy','sip','contribution','transfer_in']);
const sellTypes = new Set(['sell','redemption','withdrawal','transfer_out']);
function amountCost(t: InvestmentTransactionInput) { return t.gross_amount ?? t.net_amount ?? (t.quantity && t.unit_price ? multiplyQuantityByPriceMinor(t.quantity, t.unit_price) : 0) + (t.charges ?? 0) + (t.taxes ?? 0); }
function proceeds(t: InvestmentTransactionInput) { return t.net_amount ?? Math.max(0, (t.gross_amount ?? 0) - (t.charges ?? 0) - (t.taxes ?? 0)); }
function q(t: InvestmentTransactionInput) { if (!t.quantity) return '0'; parseDecimal(t.quantity, { allowZero: true }); return t.quantity; }
function addQ(a: string, b: string) { return formatDecimal(parseDecimal(a, { allowZero: true }) + parseDecimal(b, { allowZero: true })); }
function subQ(a: string, b: string) { return formatDecimal(parseDecimal(a, { allowZero: true }) - parseDecimal(b, { allowZero: true })); }
function mulQ(a: string, m: string) { return formatDecimal((parseDecimal(a, { allowZero: true }) * parseDecimal(m, { allowZero: false })) / 1_000_000n); }
function isZero(x: string) { return parseDecimal(x, { allowZero: true }) === 0n; }
function staleDays(assetType?: AssetType, pricingMode?: PricingMode) { if (pricingMode === 'not_priced') return 0; return ['stock','mutual_fund','etf'].includes(assetType || '') ? 7 : 35; }

export function calculateHolding(transactions: InvestmentTransactionInput[], prices: PriceInput[] = [], opts: { asOf?: string; assetType?: AssetType; pricingMode?: PricingMode; today?: string } = {}): HoldingResult {
  const warnings: string[] = []; const lots: HoldingLot[] = [];
  let totalInvested = 0, realisedProceeds = 0, fifoDisposed = 0, realisedGain = 0;
  const sorted = transactions.map((t, i) => ({...t, _i: i})).sort((a,b) => a.trade_date.localeCompare(b.trade_date) || ((a.id ?? a._i) - (b.id ?? b._i)));
  for (const t of sorted) {
    const type = t.transaction_type;
    if (['buy','sip','contribution'].includes(type)) { const cost = amountCost(t); lots.push({ quantity: q(t), cost_basis: cost, source_transaction_id: t.id }); totalInvested += cost; }
    else if (type === 'transfer_in') { const cost = amountCost(t); if (!cost) warnings.push('missing_cost_basis'); lots.push({ quantity: q(t), cost_basis: cost, source_transaction_id: t.id }); totalInvested += cost; }
    else if (type === 'bonus') lots.push({ quantity: q(t), cost_basis: 0, source_transaction_id: t.id });
    else if (type === 'split') { const mult = q(t); for (const lot of lots) lot.quantity = mulQ(lot.quantity, mult); }
    else if (sellTypes.has(type)) {
      let need = q(t); let disposedCost = 0;
      while (!isZero(need) && lots.length) {
        const lot = lots[0]; const cmp = compare(lot.quantity, need);
        const take = cmp <= 0 ? lot.quantity : need;
        const lotQty = parseDecimal(lot.quantity, { allowZero: false }); const takeQty = parseDecimal(take, { allowZero: false });
        const cost = Number((BigInt(lot.cost_basis) * takeQty + lotQty / 2n) / lotQty);
        disposedCost += cost; lot.cost_basis -= cost; lot.quantity = subQ(lot.quantity, take); need = subQ(need, take);
        if (isZero(lot.quantity)) lots.shift();
      }
      if (!isZero(need)) throw new Error('Oversell');
      fifoDisposed += disposedCost;
      if (['sell','redemption'].includes(type)) { const p = proceeds(t); realisedProceeds += p; realisedGain += p - disposedCost; }
    }
  }
  const quantity = lots.reduce((s,l) => addQ(s, l.quantity), '0');
  const remainingCost = lots.reduce((s,l) => s + l.cost_basis, 0);
  const price = [...prices].filter(p => !opts.asOf || p.price_date <= opts.asOf!).sort((a,b) => b.price_date.localeCompare(a.price_date))[0];
  if (!price && !isZero(quantity) && opts.pricingMode !== 'not_priced') warnings.push('missing_price');
  if (opts.pricingMode === 'not_priced') warnings.push('not_priced_asset');
  const currentValue = price ? multiplyQuantityByPriceMinor(quantity, price.price) : null;
  const unrealised = currentValue == null ? null : currentValue - remainingCost;
  const totalGain = unrealised == null ? null : realisedGain + unrealised;
  const latestDate = price?.price_date ?? null; let stale = false;
  if (latestDate && opts.pricingMode !== 'not_priced') { const today = opts.asOf ?? opts.today ?? new Date().toISOString().slice(0,10); stale = (Date.parse(today) - Date.parse(latestDate)) / 86400000 > staleDays(opts.assetType, opts.pricingMode); }
  return { quantity, lots, remaining_cost_basis: remainingCost, average_cost: isZero(quantity) ? null : divideCostByQuantity(remainingCost, quantity), total_invested: totalInvested, realised_sale_proceeds: realisedProceeds, fifo_cost_disposed: fifoDisposed, realised_gain: realisedGain, latest_price: price?.price ?? null, latest_price_date: latestDate, current_value: currentValue, unrealised_gain: unrealised, total_gain: totalGain, absolute_return_pct: totalInvested ? (totalGain ?? 0) / totalInvested * 100 : null, stale_price: stale, warnings };
}
export function validateNoOversell(transactions: InvestmentTransactionInput[]) { calculateHolding(transactions); return true; }
