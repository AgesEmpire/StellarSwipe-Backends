import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConditionalOrder } from './conditional-order.entity';
import { ConditionalOrderService } from './conditional-order.service';
import { ConditionalOrderController } from './order.controller';
import { EvaluateConditionalOrdersJob } from './jobs/evaluate-conditional-orders.job';
import { AtomicTransactionHelper } from '../../common/database/atomic-transaction.helper';
import { OutboxModule } from '../../events/outbox/outbox.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConditionalOrder]),
    ScheduleModule.forRoot(),
    OutboxModule,
  ],
  controllers: [ConditionalOrderController],
  providers: [
    ConditionalOrderService,
    EvaluateConditionalOrdersJob,
    AtomicTransactionHelper,
  ],
  exports: [ConditionalOrderService],
})
export class ConditionalOrdersModule {}
