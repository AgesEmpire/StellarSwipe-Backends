export class EmaCalculator {
  /**
   * Calculates Exponential Moving Average using a smoothing factor k = 2 / (period + 1).
   * Seeds the EMA with the SMA of the first `period` values.
   * Returns null for indices before the seed point.
   */
  calculate(prices: number[], period: number): (number | null)[] {
    if (period <= 0 || prices.length === 0) return [];

    const result: (number | null)[] = new Array(prices.length).fill(null);
    const seedIndex = period - 1;

    if (seedIndex >= prices.length) return result;

    // Seed with SMA of first `period` values
    const seedValue =
      prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result[seedIndex] = seedValue;

    const k = 2 / (period + 1);
    for (let i = seedIndex + 1; i < prices.length; i++) {
      result[i] = prices[i] * k + (result[i - 1] as number) * (1 - k);
    }

    return result;
  }
}
