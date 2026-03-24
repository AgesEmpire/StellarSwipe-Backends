import { PriceConditionEvaluator } from './price-condition.evaluator';
import { PriceConditionType } from '../entities/scheduled-trade.entity';

describe('PriceConditionEvaluator', () => {
  let evaluator: PriceConditionEvaluator;

  beforeEach(() => {
    evaluator = new PriceConditionEvaluator();
  });

  describe('evaluate', () => {
    describe('ABOVE condition', () => {
      it('should return true when currentPrice equals targetPrice', () => {
        expect(evaluator.evaluate(0.09, 0.09, PriceConditionType.ABOVE)).toBe(true);
      });

      it('should return true when currentPrice is above targetPrice', () => {
        expect(evaluator.evaluate(0.10, 0.09, PriceConditionType.ABOVE)).toBe(true);
      });

      it('should return false when currentPrice is below targetPrice', () => {
        expect(evaluator.evaluate(0.08, 0.09, PriceConditionType.ABOVE)).toBe(false);
      });
    });

    describe('BELOW condition', () => {
      it('should return true when currentPrice equals targetPrice', () => {
        expect(evaluator.evaluate(0.09, 0.09, PriceConditionType.BELOW)).toBe(true);
      });

      it('should return true when currentPrice is below targetPrice', () => {
        expect(evaluator.evaluate(0.08, 0.09, PriceConditionType.BELOW)).toBe(true);
      });

      it('should return false when currentPrice is above targetPrice', () => {
        expect(evaluator.evaluate(0.10, 0.09, PriceConditionType.BELOW)).toBe(false);
      });
    });

    it('should return false for unknown condition type', () => {
      expect(
        evaluator.evaluate(0.09, 0.09, 'unknown' as PriceConditionType),
      ).toBe(false);
    });
  });
});
