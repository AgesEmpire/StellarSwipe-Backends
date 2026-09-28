import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobPriority, PriorityQueueService } from './priority-queue.service';

/**
 * #issue3 — Backpressure + starvation prevention for the priority queue tiers.
 *
 * All background jobs share the same worker resources, split across the
 * critical / normal / low-priority Bull queues (see `PriorityQueueService`).
 * That routing alone isn't enough under sustained load: without an explicit
 * backpressure check, callers can keep enqueueing low-priority work that
 * piles up behind critical jobs, and without an aging mechanism a
 * continuous stream of high-priority jobs can starve low-priority jobs
 * forever.
 *
 * This service adds the two missing pieces:
 *  1. `shouldDeferLowPriority()` — a cheap pressure check callers can use
 *     before enqueueing non-critical work, so it can be deferred/dropped
 *     when critical + normal queues are backed up during a traffic spike.
 *  2. `promoteStarvedJobs()` — a periodic sweep that re-queues low-priority
 *     jobs that have waited longer than `starvationAgeMs` into the shared
 *     priority queue at HIGH priority, guaranteeing forward progress.
 */
@Injectable()
export class QueueBackpressureService {
  private readonly logger = new Logger(QueueBackpressureService.name);

  constructor(
    private readonly priorityQueueService: PriorityQueueService,
    private readonly configService: ConfigService,
  ) {}

  private get pressureThreshold(): number {
    return this.configService.get<number>('queuePressure.pressureThreshold') ?? 500;
  }

  private get starvationAgeMs(): number {
    return this.configService.get<number>('queuePressure.starvationAgeMs') ?? 5 * 60 * 1000;
  }

  private get starvationScanBatchSize(): number {
    return this.configService.get<number>('queuePressure.starvationScanBatchSize') ?? 100;
  }

  /**
   * True when the customer-facing (critical + normal) queues are backed up
   * beyond the configured threshold. Callers enqueueing non-critical work
   * (analytics, leaderboard refresh, etc.) should check this first and
   * defer/skip the job rather than adding to the contention.
   */
  async shouldDeferLowPriority(): Promise<boolean> {
    const stats = await this.priorityQueueService.getAllQueueStats();
    const pending = stats.critical.waiting + stats.critical.active + stats.normal.waiting;
    const underPressure = pending >= this.pressureThreshold;

    if (underPressure) {
      this.logger.warn(
        `Queue under pressure (pending=${pending}, threshold=${this.pressureThreshold}); deferring low-priority work`,
      );
    }

    return underPressure;
  }

  /**
   * Scans the low-priority queue for jobs that have waited longer than
   * `starvationAgeMs` and promotes them into the shared priority queue at
   * HIGH priority so they can't be starved indefinitely by a constant
   * stream of critical/normal traffic. The original low-priority job is
   * removed once its replacement has been enqueued.
   *
   * Runs automatically every minute; also callable directly for tests or
   * on-demand admin triggers.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async promoteStarvedJobs(): Promise<number> {
    const lowQueue = this.priorityQueueService.getLowPriorityQueue();
    const waitingJobs = await lowQueue.getWaiting(0, this.starvationScanBatchSize - 1);
    const now = Date.now();
    let promoted = 0;

    for (const job of waitingJobs) {
      const createdAt = job.data?.createdAt ? new Date(job.data.createdAt).getTime() : job.timestamp;
      const age = now - createdAt;

      if (age < this.starvationAgeMs) continue;

      try {
        await this.priorityQueueService.addJob(
          job.data.type,
          job.data.payload,
          JobPriority.HIGH,
        );
        await job.remove();
        promoted++;

        this.logger.log(
          `Promoted starved job type=${job.data.type} (waited ${age}ms) from low-priority to HIGH`,
        );
      } catch (err) {
        // Leave the job in place — it'll be picked up by the next sweep or
        // eventually processed normally by the low-priority worker.
        this.logger.error(
          `Failed to promote starved job ${job.id}: ${(err as Error).message}`,
        );
      }
    }

    return promoted;
  }
}
