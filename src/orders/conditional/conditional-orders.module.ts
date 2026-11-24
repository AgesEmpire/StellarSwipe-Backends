import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConditionalOrder } from './conditional-order.entity';
import { ConditionalOrderService } from './conditional-order.service';
import { ConditionalOrderController } from './order.controller';
import { EvaluateConditionalOrdersJob } from './jobs/evaluate-conditional-orders.job';
import { AtomicTransactionHelper } from '../../common/database/atomic-transaction.helper';
import { OutboxModule } from '../../events/outbox/outbox.module';
import { ConditionalOrderRevision } from './revisions/conditional-order-revision.entity';
import { OrderAmendmentService } from './revisions/order-amendment.service';
import { OrderAmendmentsController } from './revisions/order-amendments.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConditionalOrder, ConditionalOrderRevision]),
    ScheduleModule.forRoot(),
    OutboxModule,
  ],
  controllers: [ConditionalOrderController, OrderAmendmentsController],
  providers: [
    ConditionalOrderService,
    OrderAmendmentService,
    EvaluateConditionalOrdersJob,
    AtomicTransactionHelper,
  ],
  exports: [ConditionalOrderService, OrderAmendmentService],
})
export class ConditionalOrdersModule {}
