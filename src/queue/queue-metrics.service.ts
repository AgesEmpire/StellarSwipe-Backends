import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import {
  PRIORITY_QUEUE,
  CRITICAL_QUEUE,
  LOW_PRIORITY_QUEUE,
} from './priority-queue.service';

export interface QueueTierMetrics {
  queueName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  /** Approximate wait time of the oldest waiting job in milliseconds. */
  oldestWaitingJobAgeMs: number;
  /** Average wait time sampled from up to 20 waiting jobs (ms). */
  avgWaitTimeMs: number;
  /** Average processing duration sampled from up to 20 recently completed jobs (ms). */
  avgProcessingTimeMs: number;
  /** Total retry count across up to 20 failed jobs. */
  totalRetries: number;
  sampledAt: string;
}

export interface QueueObservabilitySnapshot {
  tiers: Record<string, QueueTierMetrics>;
  totalActive: number;
  totalWaiting: number;
  totalFailed: number;
  snapshotAt: string;
}

/**
 * Issue #1028 — Queue lag and processing-time observability.
 *
 * Measures per-queue waiting time, active duration, retries, and oldest-job
 * age for the critical, normal, and low-priority tiers. Payloads and secrets
 * are never exposed — only numeric counts and timestamps are collected.
 */
@Injectable()
export class QueueMetricsService {
  private readonly logger = new Logger(QueueMetricsService.name);

  constructor(
    @InjectQueue(PRIORITY_QUEUE)
    private readonly normalQueue: Queue,
    @InjectQueue(CRITICAL_QUEUE)
    private readonly criticalQueue: Queue,
    @InjectQueue(LOW_PRIORITY_QUEUE)
    private readonly lowQueue: Queue,
  ) {}

  async collectSnapshot(): Promise<QueueObservabilitySnapshot> {
    const [criticalMetrics, normalMetrics, lowMetrics] = await Promise.all([
      this.collectTierMetrics(CRITICAL_QUEUE, this.criticalQueue),
      this.collectTierMetrics(PRIORITY_QUEUE, this.normalQueue),
      this.collectTierMetrics(LOW_PRIORITY_QUEUE, this.lowQueue),
    ]);

    const tiers: Record<string, QueueTierMetrics> = {
      critical: criticalMetrics,
      normal: normalMetrics,
      low: lowMetrics,
    };

    return {
      tiers,
      totalActive:
        criticalMetrics.active + normalMetrics.active + lowMetrics.active,
      totalWaiting:
        criticalMetrics.waiting + normalMetrics.waiting + lowMetrics.waiting,
      totalFailed:
        criticalMetrics.failed + normalMetrics.failed + lowMetrics.failed,
      snapshotAt: new Date().toISOString(),
    };
  }

  private async collectTierMetrics(
    queueName: string,
    queue: Queue,
  ): Promise<QueueTierMetrics> {
    const now = Date.now();

    const counts = await queue.getJobCounts();

    const [waitingJobs, completedJobs, failedJobs] = await Promise.all([
      queue.getWaiting(0, 19).catch(() => []),
      queue.getCompleted(0, 19).catch(() => []),
      queue.getFailed(0, 19).catch(() => []),
    ]);

    // Oldest waiting job age
    let oldestWaitingJobAgeMs = 0;
    if (waitingJobs.length > 0) {
      const oldest = Math.min(...waitingJobs.map((j) => j.timestamp ?? now));
      oldestWaitingJobAgeMs = now - oldest;
    }

    // Average wait time (time from enqueue to processedOn)
    let avgWaitTimeMs = 0;
    const jobsWithWait = waitingJobs.filter((j) => j.timestamp);
    if (jobsWithWait.length > 0) {
      const total = jobsWithWait.reduce(
        (sum, j) => sum + (now - j.timestamp),
        0,
      );
      avgWaitTimeMs = Math.round(total / jobsWithWait.length);
    }

    // Average processing duration (processedOn → finishedOn)
    let avgProcessingTimeMs = 0;
    const jobsWithDuration = completedJobs.filter(
      (j) => j.processedOn != null && j.finishedOn != null,
    );
    if (jobsWithDuration.length > 0) {
      const total = jobsWithDuration.reduce(
        (sum, j) => sum + (j.finishedOn! - j.processedOn!),
        0,
      );
      avgProcessingTimeMs = Math.round(total / jobsWithDuration.length);
    }

    // Total retries across sampled failed jobs
    const totalRetries = failedJobs.reduce(
      (sum, j) => sum + (j.attemptsMade ?? 0),
      0,
    );

    return {
      queueName,
      waiting: counts.waiting,
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
      oldestWaitingJobAgeMs,
      avgWaitTimeMs,
      avgProcessingTimeMs,
      totalRetries,
      sampledAt: new Date().toISOString(),
    };
  }
}
