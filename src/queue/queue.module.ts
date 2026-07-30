import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { PriorityQueueService, PRIORITY_QUEUE, CRITICAL_QUEUE, LOW_PRIORITY_QUEUE } from './priority-queue.service';
import { QueueBackpressureService } from './queue-backpressure.service';
import { queuePressureConfig } from './queue-pressure.config';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: PRIORITY_QUEUE },
      { name: CRITICAL_QUEUE },
      { name: LOW_PRIORITY_QUEUE },
    ),
    ConfigModule.forFeature(queuePressureConfig),
    ScheduleModule.forRoot(),
  ],
  providers: [PriorityQueueService, QueueBackpressureService],
  exports: [PriorityQueueService, QueueBackpressureService],
})
export class QueueModule {}