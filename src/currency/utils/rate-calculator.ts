/**
 * Convert an amount using a known exchange rate.
 */
export function convertAmount(amount: number, rate: number): number {
  return parseFloat((amount * rate).toFixed(10));
}

/**
 * Calculate P&L in a target currency.
 */
export function calculatePnl(
  entryPrice: number,
  currentPrice: number,
  quantity: number,
  rate: number,
): { pnl: number; pnlPercent: number } {
  const pnlBase = (currentPrice - entryPrice) * quantity;
  const pnl = convertAmount(pnlBase, rate);
  const pnlPercent = entryPrice !== 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
  return { pnl, pnlPercent: parseFloat(pnlPercent.toFixed(4)) };
}
