import { EmaCalculator } from './ema.calculator';

export interface MacdPoint {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

export class MacdCalculator {
  private readonly emaCalc = new EmaCalculator();

  /**
   * Calculates MACD (Moving Average Convergence/Divergence).
   * Uses EMA-12 minus EMA-26 for the MACD line.
   * Uses EMA-9 of the MACD line as the signal line.
   * Returns null for each component until enough data is available.
   */
  calculate(prices: number[]): MacdPoint[] {
    if (prices.length === 0) return [];

    const ema12 = this.emaCalc.calculate(prices, 12);
    const ema26 = this.emaCalc.calculate(prices, 26);

    const macdLine: (number | null)[] = ema12.map((v, i) => {
      if (v === null || ema26[i] === null) return null;
      return v - (ema26[i] as number);
    });

    // Compute signal line as EMA-9 over the non-null MACD values
    const nonNullMacd: number[] = [];
    const nonNullIndices: number[] = [];
    macdLine.forEach((v, i) => {
      if (v !== null) {
        nonNullMacd.push(v);
        nonNullIndices.push(i);
      }
    });

    const signalEmaValues = this.emaCalc.calculate(nonNullMacd, 9);
    const signalLine: (number | null)[] = new Array(prices.length).fill(null);
    nonNullIndices.forEach((origIdx, i) => {
      signalLine[origIdx] = signalEmaValues[i];
    });

    return macdLine.map((macd, i) => {
      const signal = signalLine[i];
      return {
        macd,
        signal,
        histogram:
          macd !== null && signal !== null ? macd - signal : null,
      };
    });
  }
}
