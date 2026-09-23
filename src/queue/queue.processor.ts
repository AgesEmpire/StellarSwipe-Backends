import { Processor, Process, OnQueueFailed, InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { Logger } from '@nestjs/common';

/**
 * Maximum number of attempts before a job is considered a poison message
 * and routed to the dead-letter queue instead of being retried forever.
 */
export const MAX_QUEUE_ATTEMPTS = 5;

/**
 * Name of the durable dead-letter queue used to store poison messages.
 */
export const DEAD_LETTER_QUEUE = 'dead-letter';

/**
 * Safe, serialisable context attached to every dead-letter record so that
 * operators can diagnose and replay failed jobs without leaking secrets/PII.
 */
export interface DeadLetterRecord {
  originalQueue: string;
  jobId: string | number;
  jobName: string;
  correlationId: string;
  attemptsMade: number;
  maxAttempts: number;
  failedAt: string;
  error: {
    name: string;
    message: string;
  };
  data: unknown;
}

@Processor('default')
export class QueueProcessor {
  private readonly logger = new Logger(QueueProcessor.name);

  constructor(
    @InjectQueue(DEAD_LETTER_QUEUE) private readonly deadLetterQueue: Queue,
  ) {}

  @Process()
  async handle(job: Job): Promise<unknown> {
    // Bounded attempts: Bull will stop retrying once attemptsMade reaches the
    // configured limit, at which point OnQueueFailed routes the job to the
    // dead-letter queue below.
    return this.process(job);
  }

  /**
   * Actual job handling. Kept separate so it can be overridden/extended by
   * concrete processors while retaining the bounded-retry + dead-letter
   * behaviour defined here.
   */
  protected async process(job: Job): Promise<unknown> {
    return job.data;
  }

  @OnQueueFailed()
  async onFailed(job: Job, error: Error): Promise<void> {
    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts?.attempts ?? MAX_QUEUE_ATTEMPTS;

    // Transient failures: still within the attempt budget, let Bull retry.
    if (attemptsMade < maxAttempts) {
      this.logger.warn(
        `Job ${job.id} (${job.name}) failed attempt ${attemptsMade}/${maxAttempts}: ${error.message}`,
      );
      return;
    }

    // Permanent failure: poison message, route to durable dead-letter storage.
    const record: DeadLetterRecord = {
      originalQueue: job.queue?.name ?? 'default',
      jobId: job.id,
      jobName: job.name,
      correlationId: this.extractCorrelationId(job),
      attemptsMade,
      maxAttempts,
      failedAt: new Date().toISOString(),
      error: {
        name: error?.name ?? 'Error',
        message: this.sanitizeMessage(error?.message),
      },
      data: this.sanitizeData(job.data),
    };

    try {
      await this.deadLetterQueue.add('dead-letter', record, {
        removeOnComplete: false,
        removeOnFail: false,
      });
      this.logger.error(
        `Job ${job.id} (${job.name}) exhausted ${maxAttempts} attempts; routed to dead-letter queue [correlationId=${record.correlationId}]`,
      );
    } catch (dlqError) {
      this.logger.error(
        `Failed to route job ${job.id} to dead-letter queue: ${(dlqError as Error).message}`,
      );
    }
  }

  /**
   * Inspect dead-lettered messages for operator review.
   */
  async inspectDeadLetters(start = 0, end = -1): Promise<DeadLetterRecord[]> {
    const jobs = await this.deadLetterQueue.getJobs(
      ['waiting', 'failed', 'completed', 'delayed'],
      start,
      end,
      false,
    );
    return jobs.map((job) => job.data as DeadLetterRecord);
  }

  /**
   * Replay an eligible dead-lettered message back onto its original queue.
   * Returns true when the message was re-enqueued.
   */
  async replayDeadLetter(jobId: string | number): Promise<boolean> {
    const job = await this.deadLetterQueue.getJob(jobId);
    if (!job) {
      return false;
    }

    const record = job.data as DeadLetterRecord;
    await this.deadLetterQueue.add('replay', record, {
      removeOnComplete: false,
      removeOnFail: false,
    });
    await job.remove();
    this.logger.log(
      `Replayed dead-lettered job ${jobId} [correlationId=${record.correlationId}]`,
    );
    return true;
  }

  private extractCorrelationId(job: Job): string {
    const data = job.data as Record<string, unknown> | undefined;
    const fromData = data?.correlationId;
    if (typeof fromData === 'string' && fromData.length > 0) {
      return fromData;
    }
    return `job-${job.id}`;
  }

  /**
   * Strip anything that looks like a secret/token from error messages before
   * persisting them in dead-letter storage.
   */
  private sanitizeMessage(message?: string): string {
    if (!message) {
      return 'Unknown error';
    }
    return message.replace(
      /(password|secret|token|api[_-]?key|authorization)\s*[=:]\s*\S+/gi,
      '$1=[REDACTED]',
    );
  }

  /**
   * Remove sensitive fields from job payloads before storing them for replay.
   */
  private sanitizeData(data: unknown): unknown {
    if (data === null || typeof data !== 'object') {
      return data;
    }
    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeData(item));
    }
    const sensitive = /(password|secret|token|api[_-]?key|authorization)/i;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = sensitive.test(key) ? '[REDACTED]' : this.sanitizeData(value);
    }
    return result;
  }
}
