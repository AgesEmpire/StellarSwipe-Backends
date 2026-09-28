import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bull';
import { PermanentError } from '../common/retry';
import { Bulkhead, BulkheadMetrics } from '../stellar/bulkhead/bulkhead';
import {
  CRITICAL_QUEUE,
  LOW_PRIORITY_QUEUE,
  PRIORITY_QUEUE,
  PriorityJobData,
  PriorityQueueService,
} from './priority-queue.service';
import {
  DEFAULT_QUEUE_CONCURRENCY,
  QUEUE_CATEGORY_QUEUES,
  QueueCategory,
} from './queue-concurrency.config';

export type PriorityJobHandler = (
  job: Job<PriorityJobData>,
) => Promise<unknown>;

/**
 * #1228 — Consumes the priority queues with a separate concurrency ceiling
 * per workload category (see `queue-concurrency.config.ts`).
 *
 * Every queue gets its own Bull worker, and every category shares one
 * bounded pool across its queues, so at most `ceiling` jobs of a category run
 * at once and a saturated category cannot take slots from another.
 *
 * Feature modules register a handler per job `type` (the name passed to
 * `PriorityQueueService.addJob`). A job whose type has no handler fails with a
 * `PermanentError` so it is dead-lettered instead of retried.
 */
@Injectable()
export class PriorityQueueWorker implements OnModuleInit {
  private readonly logger = new Logger(PriorityQueueWorker.name);
  private readonly handlers = new Map<string, PriorityJobHandler>();
  private readonly pools = new Map<QueueCategory, Bulkhead>();

  constructor(
    private readonly priorityQueueService: PriorityQueueService,
    private readonly configService: ConfigService,
  ) {}

  registerHandler(type: string, handler: PriorityJobHandler): void {
    if (this.handlers.has(type)) {
      throw new Error(
        `A handler for priority job type "${type}" is already registered`,
      );
    }
    this.handlers.set(type, handler);
  }

  onModuleInit(): void {
    const queues: Record<string, Queue<PriorityJobData>> = {
      [CRITICAL_QUEUE]: this.priorityQueueService.getCriticalQueue(),
      [PRIORITY_QUEUE]: this.priorityQueueService.getQueue(),
      [LOW_PRIORITY_QUEUE]: this.priorityQueueService.getLowPriorityQueue(),
    };

    for (const category of Object.values(QueueCategory)) {
      const ceiling =
        this.configService.get<number>(`queueConcurrency.${category}`) ??
        DEFAULT_QUEUE_CONCURRENCY[category];
      const queueNames = QUEUE_CATEGORY_QUEUES[category];
      // Each queue's worker fetches at most `ceiling` jobs, so the pool's wait
      // list only has to hold the other queues' fetches and never rejects.
      const pool = new Bulkhead(
        category,
        ceiling,
        ceiling * (queueNames.length - 1),
      );
      this.pools.set(category, pool);

      for (const name of queueNames) {
        queues[name]
          .process('*', ceiling, (job: Job<PriorityJobData>) =>
            pool.execute(() => this.dispatch(job)),
          )
          .catch((error: Error) =>
            this.logger.error(
              `Worker for queue "${name}" stopped: ${error.message}`,
            ),
          );
      }
      this.logger.log(
        `Queue category "${category}" workers started (ceiling=${ceiling}, queues=${queueNames.join(', ')})`,
      );
    }
  }

  /** Active/queued job counts per category, for saturation monitoring. */
  getCategoryMetrics(): BulkheadMetrics[] {
    return Array.from(this.pools.values()).map((pool) => pool.getMetrics());
  }

  private dispatch(job: Job<PriorityJobData>): Promise<unknown> {
    const handler = this.handlers.get(job.data?.type);
    if (!handler) {
      throw new PermanentError(
        `No handler registered for priority job type "${job.data?.type}"`,
      );
    }
    return handler(job);
  }
}
