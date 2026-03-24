import { MacdCalculator } from './macd.calculator';

describe('MacdCalculator', () => {
  let calc: MacdCalculator;

  beforeEach(() => {
    calc = new MacdCalculator();
  });

  describe('calculate', () => {
    it('should return empty array for empty input', () => {
      expect(calc.calculate([])).toEqual([]);
    });

    it('should return array of length prices.length', () => {
      const prices = Array.from({ length: 50 }, (_, i) => 100 + i);
      expect(calc.calculate(prices)).toHaveLength(50);
    });

    it('should have null macd/signal/histogram for first 25 elements (insufficient data)', () => {
      const prices = Array.from({ length: 50 }, (_, i) => 100 + i);
      const result = calc.calculate(prices);
      // EMA-26 needs at least 26 points; first non-null MACD at index 25
      for (let i = 0; i < 25; i++) {
        expect(result[i].macd).toBeNull();
      }
    });

    it('should produce non-null macd after index 25', () => {
      const prices = Array.from({ length: 50 }, (_, i) => 100 + i);
      const result = calc.calculate(prices);
      expect(result[25].macd).not.toBeNull();
    });

    it('should produce non-null signal after sufficient data (EMA-26 + EMA-9)', () => {
      // Need at least 26 + 9 - 1 = 34 data points for first signal
      const prices = Array.from({ length: 50 }, (_, i) => 100 + i * 0.1);
      const result = calc.calculate(prices);
      const firstNonNullSignalIdx = result.findIndex((p) => p.signal !== null);
      expect(firstNonNullSignalIdx).toBeGreaterThan(0);
      expect(firstNonNullSignalIdx).toBeLessThan(50);
    });

    it('histogram = macd - signal when both are non-null', () => {
      const prices = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 5);
      const result = calc.calculate(prices);
      result.forEach((point) => {
        if (point.macd !== null && point.signal !== null) {
          expect(point.histogram).toBeCloseTo(point.macd - point.signal, 8);
        }
      });
    });

    it('histogram should be null when macd is null', () => {
      const prices = Array.from({ length: 30 }, (_, i) => i + 1);
      const result = calc.calculate(prices);
      result.forEach((point) => {
        if (point.macd === null) {
          expect(point.histogram).toBeNull();
        }
      });
    });

    it('histogram should be null when signal is null', () => {
      const prices = Array.from({ length: 35 }, (_, i) => i + 1);
      const result = calc.calculate(prices);
      result.forEach((point) => {
        if (point.signal === null) {
          expect(point.histogram).toBeNull();
        }
      });
    });

    it('should detect bullish crossover in uptrending data', () => {
      // Strongly uptrending data: EMA-12 > EMA-26 → positive MACD
      const prices = Array.from({ length: 60 }, (_, i) => 100 + i * 2);
      const result = calc.calculate(prices);
      const lastNonNull = result.filter((p) => p.macd !== null).pop();
      expect(lastNonNull?.macd).toBeGreaterThan(0);
    });

    it('should have each MacdPoint with macd, signal, histogram properties', () => {
      const prices = Array.from({ length: 30 }, (_, i) => i + 1);
      const result = calc.calculate(prices);
      result.forEach((point) => {
        expect(point).toHaveProperty('macd');
        expect(point).toHaveProperty('signal');
        expect(point).toHaveProperty('histogram');
      });
    });
  });
});
