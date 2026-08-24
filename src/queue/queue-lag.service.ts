import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PriorityQueueService } from './priority-queue.service';

export interface QueueLagSnapshot {
  queue: string;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
  /** Age of the oldest waiting job in ms (0 if none) */
  oldestJobAgeMs: number;
  /** Estimated average wait of sampled waiting jobs */
  avgWaitMs: number;
  sampledAt: string;
}

/**
 * Queue lag and processing-time observability (issue #1028).
 *
 * Periodically samples priority queues and exposes structured snapshots
 * suitable for metrics exporters / dashboards. Labels are bounded
 * (queue name only) to avoid high-cardinality cardinality explosions.
 */
@Injectable()
export class QueueLagService {
  private readonly logger = new Logger(QueueLagService.name);
  private latest: QueueLagSnapshot[] = [];

  constructor(private readonly priorityQueue: PriorityQueueService) {}

  /** Latest snapshots for metrics scrapers. */
  getSnapshots(): QueueLagSnapshot[] {
    return this.latest;
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async sample(): Promise<void> {
    try {
      const queues = [
        { name: 'critical', q: this.priorityQueue.getCriticalQueue() },
        { name: 'normal', q: this.priorityQueue.getQueue() },
        { name: 'low', q: this.priorityQueue.getLowPriorityQueue() },
      ];

      const snapshots: QueueLagSnapshot[] = [];

      for (const { name, q } of queues) {
        const counts = await q.getJobCounts();
        let oldestJobAgeMs = 0;
        let avgWaitMs = 0;

        try {
          const waiting = await q.getWaiting(0, 20);
          if (waiting.length > 0) {
            const now = Date.now();
            const ages = waiting.map((j) => {
              const created =
                j.timestamp ||
                (j.data as any)?.createdAt?.getTime?.() ||
                now;
              return now - created;
            });
            oldestJobAgeMs = Math.max(...ages);
            avgWaitMs = Math.round(
              ages.reduce((a, b) => a + b, 0) / ages.length,
            );
          }
        } catch {
          // sampling is best-effort
        }

        snapshots.push({
          queue: name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
          oldestJobAgeMs,
          avgWaitMs,
          sampledAt: new Date().toISOString(),
        });
      }

      this.latest = snapshots;

      for (const s of snapshots) {
        if (s.waiting > 100 || s.oldestJobAgeMs > 60_000) {
          this.logger.warn(
            `Queue lag elevated: queue=${s.queue} waiting=${s.waiting} oldestAgeMs=${s.oldestJobAgeMs} avgWaitMs=${s.avgWaitMs}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Queue lag sampling failed: ${(err as Error).message}`,
      );
    }
  }
}
