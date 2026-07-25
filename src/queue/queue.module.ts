import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PriorityQueueService, PRIORITY_QUEUE, CRITICAL_QUEUE, LOW_PRIORITY_QUEUE } from './priority-queue.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: PRIORITY_QUEUE },
      { name: CRITICAL_QUEUE },
      { name: LOW_PRIORITY_QUEUE },
    ),
  ],
  providers: [PriorityQueueService],
  exports: [PriorityQueueService],
})
export class QueueModule {}