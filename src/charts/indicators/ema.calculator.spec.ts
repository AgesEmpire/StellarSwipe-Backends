import { EmaCalculator } from './ema.calculator';

describe('EmaCalculator', () => {
  let calc: EmaCalculator;

  beforeEach(() => {
    calc = new EmaCalculator();
  });

  describe('calculate', () => {
    it('should return empty array for empty input', () => {
      expect(calc.calculate([], 5)).toEqual([]);
    });

    it('should return empty array when period is 0', () => {
      expect(calc.calculate([1, 2, 3], 0)).toEqual([]);
    });

    it('should return empty array when period is negative', () => {
      expect(calc.calculate([1, 2, 3], -1)).toEqual([]);
    });

    it('should return all nulls when input shorter than period', () => {
      const result = calc.calculate([1, 2], 5);
      expect(result).toEqual([null, null]);
    });

    it('should return all nulls when input length equals period minus 1', () => {
      const result = calc.calculate([1, 2, 3], 4);
      expect(result).toEqual([null, null, null]);
    });

    it('should seed EMA with SMA at index period-1', () => {
      const prices = [2, 4, 6, 8, 10];
      const result = calc.calculate(prices, 3);
      // seed = (2+4+6)/3 = 4
      expect(result[0]).toBeNull();
      expect(result[1]).toBeNull();
      expect(result[2]).toBeCloseTo(4, 5);
    });

    it('should return array of same length as input', () => {
      const result = calc.calculate([1, 2, 3, 4, 5], 3);
      expect(result).toHaveLength(5);
    });

    it('should produce increasing EMA for monotonically increasing prices', () => {
      const prices = Array.from({ length: 20 }, (_, i) => i + 1);
      const result = calc.calculate(prices, 5);
      const nonNull = result.filter((v) => v !== null) as number[];
      for (let i = 1; i < nonNull.length; i++) {
        expect(nonNull[i]).toBeGreaterThan(nonNull[i - 1]);
      }
    });

    it('should apply smoothing factor k = 2/(period+1)', () => {
      // EMA-3: k = 2/4 = 0.5
      // prices: [10, 20, 30]
      // seed at idx 2 = (10+20+30)/3 = 20 (only 3 values, so last non-null = 20)
      const prices = [10, 20, 30, 40];
      const result = calc.calculate(prices, 3);
      // seed: (10+20+30)/3 = 20
      expect(result[2]).toBeCloseTo(20, 5);
      // EMA[3] = 40 * 0.5 + 20 * 0.5 = 30
      expect(result[3]).toBeCloseTo(30, 5);
    });

    it('should converge toward current price over time', () => {
      // Flat price at 100 — EMA should converge to 100
      const prices = new Array(50).fill(100);
      const result = calc.calculate(prices, 10);
      const last = result[49] as number;
      expect(last).toBeCloseTo(100, 2);
    });

    it('should compute EMA-12 with enough data for MACD use case', () => {
      const prices = Array.from({ length: 30 }, (_, i) => 0.095 + i * 0.001);
      const result = calc.calculate(prices, 12);
      expect(result[11]).not.toBeNull();
      expect(result[29]).not.toBeNull();
    });
  });
});
