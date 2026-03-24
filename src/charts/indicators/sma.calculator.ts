export class SmaCalculator {
  /**
   * Calculates Simple Moving Average over a sliding window.
   * Returns null for indices where insufficient data exists (idx < period - 1).
   */
  calculate(prices: number[], period: number): (number | null)[] {
    if (period <= 0 || prices.length === 0) return [];

    return prices.map((_, idx) => {
      if (idx < period - 1) return null;
      const slice = prices.slice(idx - period + 1, idx + 1);
      return slice.reduce((a, b) => a + b, 0) / period;
    });
  }
}
