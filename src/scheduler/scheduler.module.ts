import { Module } from '@nestjs/common';
import { RecurringJobScheduler } from './recurring-job-scheduler.service';

/**
 * Provides the RecurringJobScheduler abstraction for cleanup, aggregation,
 * and sync jobs. Not wired into AppModule yet — import into a feature module
 * and call `scheduler.register(...)` to schedule a recurring task.
 */
@Module({
  providers: [RecurringJobScheduler],
  exports: [RecurringJobScheduler],
})
export class SchedulerModule {}
