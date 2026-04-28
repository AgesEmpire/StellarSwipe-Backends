import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import Queue, { Job, JobCounts } from 'bull';

export const DEAD_LETTER_QUEUE = 'dead-letter';

export interface DeadLetterEntry {
  jobId: string | number;
  queue: string;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
  failedAt: string; // ISO string — safe to serialise into Redis
}

/**
 * #368 — Dead-letter queue service.
 *
 * Captures jobs that have exhausted all retry attempts and stores them in a
 * dedicated Bull queue so they can be inspected, replayed, or discarded without
 * blocking the originating queue.
 *
 * Usage — attach to any Bull queue's `failed` global event:
 *
 *   @OnQueueFailed()
 *   async onFailed(job: Job, error: Error) {
 *     if (job.attemptsMade >= job.opts.attempts) {
 *       await this.deadLetterService.capture(job, error);
 *     }
 *   }
 */
@Injectable()
export class DeadLetterService implements OnModuleInit {
  private readonly logger = new Logger(DeadLetterService.name);

  constructor(
    @InjectQueue(DEAD_LETTER_QUEUE)
    private readonly dlq: Queue.Queue<DeadLetterEntry>,
  ) {}

  onModuleInit(): void {
    this.dlq.on('error', (err: Error) =>
      this.logger.error('DLQ connection error', err.stack),
    );
  }

  /** Move a failed job into the DLQ. */
  async capture(job: Job, error: Error): Promise<void> {
    const entry: DeadLetterEntry = {
      jobId: job.id,
      queue: job.queue.name,
      data: job.data,
      failedReason: error.message,
      attemptsMade: job.attemptsMade,
      failedAt: new Date().toISOString(),
    };

    await this.dlq.add(entry, {
      removeOnComplete: false,
      removeOnFail: false,
      attempts: 1,
    });

    this.logger.warn(
      `Job ${job.id} from "${job.queue.name}" moved to DLQ after ${job.attemptsMade} attempt(s): ${error.message}`,
    );
  }

  /** All jobs currently in the DLQ (waiting + failed states). */
  async list(): Promise<Job<DeadLetterEntry>[]> {
    return this.dlq.getJobs(['waiting', 'failed']);
  }

  /** Job counts per state in the DLQ. */
  async counts(): Promise<JobCounts> {
    return this.dlq.getJobCounts();
  }

  /** Permanently remove a DLQ entry. */
  async discard(jobId: string): Promise<void> {
    const job = await this.dlq.getJob(jobId);
    if (job) {
      await job.remove();
      this.logger.log(`DLQ job ${jobId} discarded`);
    }
  }

  /**
   * Re-queue a DLQ entry onto its original queue for another attempt.
   * The DLQ entry is removed after successful re-queue.
   */
  async replay(
    jobId: string,
    targetQueue: Queue.Queue,
  ): Promise<Job | null> {
    const job = await this.dlq.getJob(jobId);
    if (!job) return null;

    const replayed = await targetQueue.add(job.data.data, { attempts: 3 });
    await job.remove();

    this.logger.log(
      `DLQ job ${jobId} replayed as job ${replayed.id} on queue "${targetQueue.name}"`,
    );
    return replayed;
  }
}
