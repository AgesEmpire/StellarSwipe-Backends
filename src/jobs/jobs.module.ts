import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { DEAD_LETTER_QUEUE, DeadLetterService } from './dead-letter.service';
import { JobSchedulerService } from './job-scheduler.service';
import { JobsController } from './jobs.controller';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: DEAD_LETTER_QUEUE }),
    ScheduleModule.forRoot(),
    ConfigModule,
    AuthModule,
    ApiKeysModule,
  ],
  controllers: [JobsController],
  providers: [DeadLetterService, JobSchedulerService],
  exports: [DeadLetterService, JobSchedulerService],
})
export class JobsModule {}
