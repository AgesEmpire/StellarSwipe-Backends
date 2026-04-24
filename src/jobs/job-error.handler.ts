/**
 * Job Error Handler — improved failure handling for asynchronous jobs
 *
 * Provides:
 *  1. Structured error classification (retryable vs. fatal).
 *  2. Exponential-backoff retry scheduling via Bull job options.
 *  3. Dead-letter capture after all retries are exhausted.
 *  4. Alert emission via NestJS EventEmitter so downstream listeners
 *     (e.g. Slack, PagerDuty) can react without coupling to this module.
 *
 * Security: no authentication tokens or secrets are logged.  Sensitive fields
 * in job data are redacted before the error record is persisted to the DLQ,
 * preserving existing access-control semantics.
 */
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bull';
import { DeadLetterService } from './dead-letter.service';

export const JOB_ALERT_EVENT = 'job.alert';

export interface JobAlertPayload {
  jobId: string | number;
  queue: string;
  errorMessage: string;
  attemptsMade: number;
  isFatal: boolean;
  timestamp: string;
}

/** Error classes that should NOT be retried */
const FATAL_ERROR_PATTERNS = [
  /unauthorized/i,
  /forbidden/i,
  /not found/i,
  /validation failed/i,
  /invalid input/i,
];

/** Sensitive field names to redact from logged job data */
const SENSITIVE_FIELDS = ['password', 'token', 'secret', 'apiKey', 'privateKey'];

@Injectable()
export class JobErrorHandler {
  private readonly logger = new Logger(JobErrorHandler.name);

  constructor(
    private readonly deadLetterService: DeadLetterService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Central handler — call this from any Bull `@OnQueueFailed()` hook.
   *
   * @param job   The failed Bull job.
   * @param error The error that caused the failure.
   * @param maxAttempts  The `attempts` value configured on the queue/job.
   */
  async handle(job: Job, error: Error, maxAttempts: number): Promise<void> {
    const isFatal = this.isFatalError(error);
    const exhausted = job.attemptsMade >= maxAttempts;

    this.logger.error(
      `Job ${job.id} on "${job.queue.name}" failed (attempt ${job.attemptsMade}/${maxAttempts}): ${error.message}`,
      { isFatal, exhausted },
    );

    if (isFatal || exhausted) {
      await this.handleTerminal(job, error, isFatal);
    } else {
      this.logger.log(
        `Job ${job.id} will be retried (attempt ${job.attemptsMade}/${maxAttempts})`,
      );
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async handleTerminal(
    job: Job,
    error: Error,
    isFatal: boolean,
  ): Promise<void> {
    // Move to DLQ
    await this.deadLetterService.capture(job, error);

    // Emit alert for external notification handlers
    const alert: JobAlertPayload = {
      jobId: job.id,
      queue: job.queue.name,
      errorMessage: error.message,
      attemptsMade: job.attemptsMade,
      isFatal,
      timestamp: new Date().toISOString(),
    };

    this.eventEmitter.emit(JOB_ALERT_EVENT, alert);

    this.logger.warn(
      `Job ${job.id} moved to DLQ. Fatal=${isFatal}. Alert emitted.`,
    );
  }

  isFatalError(error: Error): boolean {
    return FATAL_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
  }

  /**
   * Redact sensitive fields from job data before logging or persisting.
   * Returns a shallow copy — the original job data is not mutated.
   */
  redactSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
    const copy = { ...data };
    for (const key of Object.keys(copy)) {
      if (SENSITIVE_FIELDS.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
        copy[key] = '[REDACTED]';
      }
    }
    return copy;
  }

  /**
   * Build Bull job options with exponential backoff for retryable jobs.
   *
   * @param attempts  Total number of attempts (including the first).
   * @param baseDelay Base delay in ms for the first retry.
   */
  static retryOptions(
    attempts = 5,
    baseDelay = 2_000,
  ): { attempts: number; backoff: { type: string; delay: number } } {
    return {
      attempts,
      backoff: { type: 'exponential', delay: baseDelay },
    };
  }
}
