import { Module } from '@nestjs/common';
import { ChartsController } from './charts.controller';
import { ChartsService } from './charts.service';
import { OhlcvAggregatorService } from './services/ohlcv-aggregator.service';
import { IndicatorCalculatorService } from './services/indicator-calculator.service';

@Module({
  controllers: [ChartsController],
  providers: [
    ChartsService,
    OhlcvAggregatorService,
    IndicatorCalculatorService,
  ],
  exports: [ChartsService],
})
export class ChartsModule {}
