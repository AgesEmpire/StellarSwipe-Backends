import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConditionalOrder } from './conditional-order.entity';
import { ConditionalOrderService } from './conditional-order.service';
import { ConditionalOrderController } from './order.controller';
import { EvaluateConditionalOrdersJob } from './jobs/evaluate-conditional-orders.job';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConditionalOrder]),
    ScheduleModule.forRoot(),
  ],
  controllers: [ConditionalOrderController],
  providers: [
    ConditionalOrderService,
    EvaluateConditionalOrdersJob,
  ],
  exports: [ConditionalOrderService],
})
export class ConditionalOrdersModule {}
