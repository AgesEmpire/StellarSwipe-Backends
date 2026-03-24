import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ScheduledTrade } from './entities/scheduled-trade.entity';
import { ScheduledTradesService } from './scheduled-trades.service';
import { ScheduledTradesController } from './scheduled-trades.controller';
import { ExecuteScheduledTradesJob } from './jobs/execute-scheduled-trades.job';
import { PriceConditionEvaluator } from './conditions/price-condition.evaluator';
import { TimeConditionEvaluator } from './conditions/time-condition.evaluator';
import { SCHEDULED_TRADES_QUEUE } from './jobs/execute-scheduled-trades.job';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScheduledTrade]),
    BullModule.registerQueue({ name: SCHEDULED_TRADES_QUEUE }),
  ],
  controllers: [ScheduledTradesController],
  providers: [
    ScheduledTradesService,
    ExecuteScheduledTradesJob,
    PriceConditionEvaluator,
    TimeConditionEvaluator,
  ],
  exports: [ScheduledTradesService],
})
export class ScheduledTradesModule {}
