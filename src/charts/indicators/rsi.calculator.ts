import { SmaCalculator } from './sma.calculator';

export class RsiCalculator {
  private readonly smaCalc = new SmaCalculator();

  /**
   * Calculates RSI (Relative Strength Index).
   * Returns null for indices where insufficient data exists.
   * The output array is length prices.length, with null prepended
   * because the changes array is one element shorter.
   */
  calculate(prices: number[], period = 14): (number | null)[] {
    if (prices.length < 2) return new Array(prices.length).fill(null);

    const changes = prices.slice(1).map((p, i) => p - prices[i]);
    const gains = changes.map((c) => (c > 0 ? c : 0));
    const losses = changes.map((c) => (c < 0 ? -c : 0));

    const avgGains = this.smaCalc.calculate(gains, period);
    const avgLosses = this.smaCalc.calculate(losses, period);

    const rsiValues = avgGains.map((gain, i): number | null => {
      if (!gain || !avgLosses[i]) return null;
      const rs = gain / (avgLosses[i] as number);
      return 100 - 100 / (1 + rs);
    });

    // Prepend one null because `changes` has length prices.length - 1
    return [null, ...rsiValues];
  }
}
