import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PriorityQueueService } from './priority-queue.service';

/**
 * Coordinates graceful Bull worker drain during NestJS shutdown (issue #1026).
 *
 * Behaviour:
 * 1. Pause all priority queues so no new jobs are started.
 * 2. Wait up to `QUEUE_SHUTDOWN_GRACE_MS` (default 30s) for active jobs to finish.
 * 3. Log any jobs still active when the grace period expires (forced interruption).
 * 4. Exit predictably so the process can terminate.
 */
@Injectable()
export class QueueShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueShutdownService.name);
  private readonly graceMs: number;

  constructor(
    private readonly priorityQueue: PriorityQueueService,
    private readonly config: ConfigService,
  ) {
    this.graceMs =
      this.config.get<number>('QUEUE_SHUTDOWN_GRACE_MS') ?? 30_000;
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(
      `Queue shutdown started (signal=${signal ?? 'unknown'}, grace=${this.graceMs}ms)`,
    );

    const queues = [
      this.priorityQueue.getCriticalQueue(),
      this.priorityQueue.getQueue(),
      this.priorityQueue.getLowPriorityQueue(),
    ];

    // 1. Stop accepting new work
    await Promise.all(
      queues.map(async (q) => {
        try {
          await q.pause(true); // true = local pause (this worker only)
          this.logger.log(`Paused queue ${(q as any).name}`);
        } catch (err) {
          this.logger.warn(
            `Failed to pause queue ${(q as any).name}: ${(err as Error).message}`,
          );
        }
      }),
    );

    // 2. Wait for active jobs
    const deadline = Date.now() + this.graceMs;
    let remaining = await this.countActive(queues);

    while (remaining > 0 && Date.now() < deadline) {
      this.logger.log(`Waiting for ${remaining} active job(s) to finish…`);
      await new Promise((r) => setTimeout(r, 500));
      remaining = await this.countActive(queues);
    }

    // 3. Record forced interruptions
    if (remaining > 0) {
      this.logger.warn(
        `Shutdown forced with ${remaining} active job(s) still running (grace period expired)`,
      );
    } else {
      this.logger.log('All active jobs drained successfully');
    }

    // 4. Close queue connections
    await Promise.all(
      queues.map(async (q) => {
        try {
          await q.close();
        } catch (err) {
          this.logger.warn(
            `Error closing queue ${(q as any).name}: ${(err as Error).message}`,
          );
        }
      }),
    );

    this.logger.log('Queue shutdown complete');
  }

  private async countActive(
    queues: ReturnType<PriorityQueueService['getQueue']>[],
  ): Promise<number> {
    const counts = await Promise.all(
      queues.map(async (q) => {
        try {
          const c = await q.getJobCounts();
          return c.active ?? 0;
        } catch {
          return 0;
        }
      }),
    );
    return counts.reduce((a, b) => a + b, 0);
  }
}
