export interface BookLevel {
  price: string | number;
  amount: string | number;
}

export interface FillEstimate {
  bestPrice: number;
  averagePrice: number;
  filledBase: number;
  sufficientLiquidity: boolean;
}

/**
 * Walks one side of a Horizon order book for `baseAmount` and returns the
 * volume-weighted price. Horizon reports ask amounts in the base asset and
 * bid amounts in the counter asset, so bid depth is converted to base via the
 * level price. Prices are counter per base.
 */
export function estimateFill(levels: BookLevel[], baseAmount: number, side: 'bids' | 'asks'): FillEstimate | null {
  if (!(baseAmount > 0)) return null;
  const parsed = levels
    .map((l) => ({ price: Number(l.price), amount: Number(l.amount) }))
    .filter((l) => l.price > 0 && l.amount > 0);
  if (!parsed.length) return null;

  let remaining = baseAmount;
  let counterTotal = 0;
  for (const level of parsed) {
    const capacityBase = side === 'bids' ? level.amount / level.price : level.amount;
    const take = Math.min(remaining, capacityBase);
    counterTotal += take * level.price;
    remaining -= take;
    if (remaining <= 1e-12) break;
  }
  const filledBase = baseAmount - Math.max(remaining, 0);
  return {
    bestPrice: parsed[0].price,
    averagePrice: filledBase > 0 ? counterTotal / filledBase : parsed[0].price,
    filledBase,
    sufficientLiquidity: remaining <= 1e-12,
  };
}

/** Adverse distance between the average fill and top of book, in basis points. */
export function slippageBps(bestPrice: number, averagePrice: number): number {
  if (!(bestPrice > 0)) return 0;
  return Math.round((Math.abs(averagePrice - bestPrice) / bestPrice) * 10_000 * 100) / 100;
}
