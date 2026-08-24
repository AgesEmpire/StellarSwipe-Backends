import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { PriorityQueueService, PRIORITY_QUEUE, CRITICAL_QUEUE, LOW_PRIORITY_QUEUE } from './priority-queue.service';
import { QueueBackpressureService } from './queue-backpressure.service';
import { QueueShutdownService } from './queue-shutdown.service';
import { queuePressureConfig } from './queue-pressure.config';
import { CorrelationModule } from '../common/correlation/correlation.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: PRIORITY_QUEUE },
      { name: CRITICAL_QUEUE },
      { name: LOW_PRIORITY_QUEUE },
    ),
    ConfigModule.forFeature(queuePressureConfig),
    ScheduleModule.forRoot(),
    CorrelationModule,
  ],
  providers: [
    PriorityQueueService,
    QueueBackpressureService,
    QueueShutdownService,
  ],
  exports: [
    PriorityQueueService,
    QueueBackpressureService,
    QueueShutdownService,
  ],
})
export class QueueModule {}
