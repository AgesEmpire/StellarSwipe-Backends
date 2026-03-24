import { SmaCalculator } from './sma.calculator';

describe('SmaCalculator', () => {
  let calc: SmaCalculator;

  beforeEach(() => {
    calc = new SmaCalculator();
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

    it('should compute SMA-1 (identity)', () => {
      const prices = [2, 4, 6, 8];
      expect(calc.calculate(prices, 1)).toEqual([2, 4, 6, 8]);
    });

    it('should compute SMA-3 correctly', () => {
      const prices = [1, 2, 3, 4, 5];
      const result = calc.calculate(prices, 3);
      expect(result[0]).toBeNull();
      expect(result[1]).toBeNull();
      expect(result[2]).toBeCloseTo(2, 5); // (1+2+3)/3
      expect(result[3]).toBeCloseTo(3, 5); // (2+3+4)/3
      expect(result[4]).toBeCloseTo(4, 5); // (3+4+5)/3
    });

    it('should handle period equal to array length', () => {
      const prices = [10, 20, 30];
      const result = calc.calculate(prices, 3);
      expect(result[0]).toBeNull();
      expect(result[1]).toBeNull();
      expect(result[2]).toBeCloseTo(20, 5);
    });

    it('should compute SMA-2 correctly', () => {
      const prices = [4, 2, 6, 8];
      const result = calc.calculate(prices, 2);
      expect(result[0]).toBeNull();
      expect(result[1]).toBeCloseTo(3, 5);  // (4+2)/2
      expect(result[2]).toBeCloseTo(4, 5);  // (2+6)/2
      expect(result[3]).toBeCloseTo(7, 5);  // (6+8)/2
    });

    it('should handle floating point prices', () => {
      const prices = [0.095, 0.096, 0.097];
      const result = calc.calculate(prices, 3);
      expect(result[2]).toBeCloseTo(0.096, 5);
    });

    it('should return array of same length as input', () => {
      const prices = [1, 2, 3, 4, 5, 6, 7];
      const result = calc.calculate(prices, 3);
      expect(result).toHaveLength(7);
    });

    it('should have nulls only for indices below period-1', () => {
      const prices = [1, 2, 3, 4, 5];
      const result = calc.calculate(prices, 3);
      expect(result[0]).toBeNull();
      expect(result[1]).toBeNull();
      expect(result[2]).not.toBeNull();
      expect(result[3]).not.toBeNull();
      expect(result[4]).not.toBeNull();
    });

    it('should compute SMA for a real 20-period scenario', () => {
      const prices = Array.from({ length: 25 }, (_, i) => i + 1); // 1..25
      const result = calc.calculate(prices, 20);
      // SMA at index 19 = avg(1..20) = 10.5
      expect(result[19]).toBeCloseTo(10.5, 5);
      // SMA at index 24 = avg(6..25) = 15.5
      expect(result[24]).toBeCloseTo(15.5, 5);
    });
  });
});
