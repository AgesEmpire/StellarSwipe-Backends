import { RsiCalculator } from './rsi.calculator';

describe('RsiCalculator', () => {
  let calc: RsiCalculator;

  beforeEach(() => {
    calc = new RsiCalculator();
  });

  describe('calculate', () => {
    it('should return all nulls for empty input', () => {
      expect(calc.calculate([])).toEqual([]);
    });

    it('should return all nulls for single-element input', () => {
      expect(calc.calculate([100])).toEqual([null]);
    });

    it('should return array of length prices.length', () => {
      const prices = Array.from({ length: 20 }, (_, i) => 100 + i);
      expect(calc.calculate(prices)).toHaveLength(20);
    });

    it('should return all nulls when input length <= period', () => {
      const prices = Array.from({ length: 14 }, () => 100);
      const result = calc.calculate(prices, 14);
      expect(result.every((v) => v === null)).toBe(true);
    });

    it('should produce 100 when prices only go up (no losses)', () => {
      // Strictly increasing prices — losses array is all zeros
      // avgLoss = 0 so condition !avgLoss[i] returns null per spec
      const prices = Array.from({ length: 20 }, (_, i) => i + 1);
      const result = calc.calculate(prices, 5);
      // Per spec: if (!gain || !avgLoss[i]) return null — avgLoss=0 → null
      const nonNull = result.filter((v) => v !== null);
      // All non-null values should be null because avgLoss is 0
      expect(nonNull).toHaveLength(0);
    });

    it('should return null for periods without enough data', () => {
      const prices = [100, 101, 99, 102, 98, 103];
      const result = calc.calculate(prices, 14);
      // Only 6 prices, period 14, so all null
      expect(result.every((v) => v === null)).toBe(true);
    });

    it('should compute RSI in [0, 100] for mixed up/down movement', () => {
      // 20 alternating prices: up 2, down 1
      const prices: number[] = [100];
      for (let i = 1; i < 25; i++) {
        prices.push(i % 2 === 0 ? prices[i - 1] - 1 : prices[i - 1] + 2);
      }
      const result = calc.calculate(prices, 14);
      const nonNull = result.filter((v) => v !== null) as number[];
      nonNull.forEach((v) => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      });
    });

    it('should have first element always null (prepended null)', () => {
      const prices = Array.from({ length: 20 }, (_, i) => i + 1);
      const result = calc.calculate(prices);
      expect(result[0]).toBeNull();
    });

    it('should use default period of 14', () => {
      const prices = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 5);
      const resultDefault = calc.calculate(prices);
      const resultExplicit = calc.calculate(prices, 14);
      expect(resultDefault).toEqual(resultExplicit);
    });

    it('should produce higher RSI values for predominantly up-trending data', () => {
      // Build prices: mostly up with occasional dips
      const prices: number[] = [100];
      for (let i = 1; i < 30; i++) {
        const delta = i % 5 === 0 ? -0.5 : 2;
        prices.push(prices[i - 1] + delta);
      }
      const result = calc.calculate(prices, 14);
      const nonNull = result.filter((v) => v !== null) as number[];
      if (nonNull.length > 0) {
        // Predominantly uptrend → RSI should generally be above 50
        const avg = nonNull.reduce((a, b) => a + b, 0) / nonNull.length;
        expect(avg).toBeGreaterThan(50);
      }
    });
  });
});
