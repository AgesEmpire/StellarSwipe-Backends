import { Injectable } from '@nestjs/common';
import { PriceConditionType } from '../entities/scheduled-trade.entity';

@Injectable()
export class PriceConditionEvaluator {
  evaluate(
    currentPrice: number,
    targetPrice: number,
    condition: PriceConditionType,
  ): boolean {
    if (condition === PriceConditionType.ABOVE) {
      return currentPrice >= targetPrice;
    }
    if (condition === PriceConditionType.BELOW) {
      return currentPrice <= targetPrice;
    }
    return false;
  }
}
