import { Processor, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { JobErrorHandler } from '../jobs/job-error.handler';
import {
  PRIORITY_QUEUE,
  CRITICAL_QUEUE,
  LOW_PRIORITY_QUEUE,
  PriorityJobData,
} from './priority-queue.service';

/**
 * #944 — Dead-letter wiring for the shared priority queues.
 *
 * Bull only invokes `attemptsMade` retries with the configured backoff
 * (see `PriorityQueueService.addJob` / `queue-retry.config.ts`); once a job
 * either exhausts its attempts or throws a fatal (non-retryable) error, the
 * `failed` event fires for the last time. These listeners forward that event
 * to `JobErrorHandler.handle()`, which captures the job into the dead-letter
 * queue and emits the `JOB_ALERT_EVENT` for downstream notification.
 *
 * One `@Processor` class per queue is required — NestJS Bull binds event
 * listeners (`@OnQueueFailed`, `@OnQueueCompleted`, etc.) to the queue named
 * in the class-level decorator, mirroring the pattern used in
 * `src/soroban/jobs/contract-job.processor.ts`.
 */
@Processor(PRIORITY_QUEUE)
export class PriorityQueueFailureProcessor {
  private readonly logger = new Logger(PriorityQueueFailureProcessor.name);

  constructor(private readonly jobErrorHandler: JobErrorHandler) {}

  @OnQueueFailed()
  async onFailed(job: Job<PriorityJobData>, error: Error): Promise<void> {
    const maxAttempts = job.opts?.attempts ?? 1;
    await this.jobErrorHandler.handle(job, error, maxAttempts);
  }
}

@Processor(CRITICAL_QUEUE)
export class CriticalQueueFailureProcessor {
  private readonly logger = new Logger(CriticalQueueFailureProcessor.name);

  constructor(private readonly jobErrorHandler: JobErrorHandler) {}

  @OnQueueFailed()
  async onFailed(job: Job<PriorityJobData>, error: Error): Promise<void> {
    const maxAttempts = job.opts?.attempts ?? 1;
    await this.jobErrorHandler.handle(job, error, maxAttempts);
  }
}

@Processor(LOW_PRIORITY_QUEUE)
export class LowPriorityQueueFailureProcessor {
  private readonly logger = new Logger(LowPriorityQueueFailureProcessor.name);

  constructor(private readonly jobErrorHandler: JobErrorHandler) {}

  @OnQueueFailed()
  async onFailed(job: Job<PriorityJobData>, error: Error): Promise<void> {
    const maxAttempts = job.opts?.attempts ?? 1;
    await this.jobErrorHandler.handle(job, error, maxAttempts);
  }
}
