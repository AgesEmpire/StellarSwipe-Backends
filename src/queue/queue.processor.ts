import { Processor, Process, OnQueueFailed, InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { Logger, OnApplicationShutdown } from '@nestjs/common';

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
 * Bounded grace period (ms) granted to in-flight jobs during shutdown before
 * the worker is forced to stop. Jobs still running past this window are left
 * unacknowledged so Bull returns them to the queue for recovery.
 */
export const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;

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
export class QueueProcessor implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueProcessor.name);

  /**
   * When true, intake is paused and no new jobs are picked up. Set during
   * shutdown so the worker drains rather than accepting fresh work.
   */
  private draining = false;

  /**
   * Resolves once all currently running jobs have settled (or the drain
   * timeout elapses). Used to bound the shutdown grace period.
   */
  private drainPromise: Promise<void> | null = null;
  private resolveDrain: (() => void) | null = null;
  private activeJobs = 0;

  constructor(
    @InjectQueue(DEAD_LETTER_QUEUE) private readonly deadLetterQueue: Queue,
  ) {}

  @Process()
  async handle(job: Job): Promise<unknown> {
    // Bounded attempts: Bull will stop retrying once attemptsMade reaches the
    // configured limit, at which point OnQueueFailed routes the job to the
    // dead-letter queue below.
    this.activeJobs += 1;
    try {
      return await this.process(job);
    } finally {
      this.activeJobs -= 1;
      if (this.activeJobs === 0 && this.resolveDrain) {
        this.resolveDrain();
      }
    }
  }

  /**
   * Actual job handling. Kept separate so it can be overridden/extended by
   * concrete processors while retaining the bounded-retry + dead-letter
   * behaviour defined here.
   */
  protected async process(job: Job): Promise<unknown> {
    return job.data;
  }

  /**
   * Pause queue intake so no new jobs are picked up, then wait a bounded time
   * for in-flight jobs to finish. Jobs that exceed the grace period are left
   * unacknowledged so Bull returns them to the queue (recoverable) rather than
   * marking them complete.
   */
  async drain(timeoutMs: number = DEFAULT_DRAIN_TIMEOUT_MS): Promise<void> {
    if (this.draining) {
      return this.drainPromise ?? Promise.resolve();
    }
    this.draining = true;

    // Stop intake: pause the queue so no new jobs are picked up.
    try {
      await this.deadLetterQueue.pause(true);
    } catch (error) {
      this.logger.warn(
        `Failed to pause queue intake during drain: ${(error as Error).message}`,
      );
    }

    if (this.activeJobs === 0) {
      this.logger.log('Drain complete: no active jobs to wait for.');
      return;
    }

    this.drainPromise = new Promise<void>((resolve) => {
      this.resolveDrain = resolve;
    });

    const timeout = new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs).unref?.();
    });

    await Promise.race([this.drainPromise, timeout]);

    if (this.activeJobs > 0) {
      this.logger.warn(
        `Drain timeout (${timeoutMs}ms) reached with ${this.activeJobs} job(s) still running; leaving them unacknowledged for recovery.`,
      );
    } else {
      this.logger.log('Drain complete: all active jobs finished.');
    }
  }

  /**
   * Nest lifecycle hook: pause intake and drain active jobs on shutdown.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.drain();
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
