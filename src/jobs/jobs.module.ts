import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DEAD_LETTER_QUEUE, DeadLetterService } from './dead-letter.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: DEAD_LETTER_QUEUE }),
  ],
  providers: [DeadLetterService],
  exports: [DeadLetterService],
})
export class JobsModule {}
