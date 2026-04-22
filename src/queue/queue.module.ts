import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PriorityQueueService } from './priority-queue.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'priority-queue' }),
  ],
  providers: [PriorityQueueService],
  exports: [PriorityQueueService],
})
export class QueueModule {}