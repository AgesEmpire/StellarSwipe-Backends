import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job, JobOptions } from 'bull';

export const PRIORITY_QUEUE = 'priority-queue';
export const CRITICAL_QUEUE = 'critical-queue';
export const LOW_PRIORITY_QUEUE = 'low-priority-queue';

/**
 * Job priority levels for Bull queue.
 *
 * BullMQ natively supports priority queues (lower priority number = higher priority).
 * CRITICAL (1)  — Market order execution, stop-loss trigger
 * HIGH    (10)  — Limit order check, DCA interval
 * NORMAL  (100) — Notification delivery, webhook dispatch
 * LOW     (1000)— Analytics processing, leaderboard update
 */
export enum JobPriority {
  CRITICAL = 1,
  HIGH = 10,
  NORMAL = 100,
  LOW = 1000,
}

export interface PriorityJobData {
  type: string;
  payload: unknown;
  priority: JobPriority;
  createdAt: Date;
}

/**
 * #386 — Priority queue service for worker jobs.
 *
 * Supports prioritized processing for critical versus non-critical worker queue jobs.
 * Uses Bull's built-in priority system to ensure high-priority jobs are processed first.
 */
@Injectable()
export class PriorityQueueService {
  private readonly logger = new Logger(PriorityQueueService.name);

  constructor(
    @InjectQueue(PRIORITY_QUEUE)
    private readonly queue: Queue<PriorityJobData>,
    @InjectQueue(CRITICAL_QUEUE)
    private readonly criticalQueue: Queue<PriorityJobData>,
    @InjectQueue(LOW_PRIORITY_QUEUE)
    private readonly lowPriorityQueue: Queue<PriorityJobData>,
  ) {}

  /**
   * Returns the appropriate queue based on priority level.
   * CRITICAL jobs go to the dedicated critical-queue to avoid starvation.
   * LOW priority jobs go to a separate low-priority-queue.
   * All other priorities use the shared priority-queue.
   */
  private getQueueForPriority(priority: JobPriority): Queue<PriorityJobData> {
    switch (priority) {
      case JobPriority.CRITICAL:
        return this.criticalQueue;
      case JobPriority.LOW:
        return this.lowPriorityQueue;
      default:
        return this.queue;
    }
  }

  /**
   * Add a job with specified priority.
   * CRITICAL priority jobs are added to a dedicated CRITICAL queue,
   * LOW priority jobs to a dedicated LOW queue, and others to the shared priority queue.
   */
  async addJob(
    type: string,
    payload: unknown,
    priority: JobPriority = JobPriority.NORMAL,
    options: Partial<JobOptions> = {},
  ): Promise<Job<PriorityJobData>> {
    const jobData: PriorityJobData = {
      type,
      payload,
      priority,
      createdAt: new Date(),
    };

    const jobOptions: JobOptions = {
      priority,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 50,
      removeOnFail: 10,
      ...options,
    };

    const targetQueue = this.getQueueForPriority(priority);
    this.logger.log(`Adding ${type} job with priority ${priority} to queue ${(targetQueue as any).name || 'priority-queue'}`);
    return targetQueue.add(type, jobData, jobOptions);
  }

  /**
   * Add a critical job (highest priority).
   */
  async addCriticalJob(type: string, payload: unknown): Promise<Job<PriorityJobData>> {
    return this.addJob(type, payload, JobPriority.CRITICAL);
  }

  /**
   * Add a high priority job.
   */
  async addHighPriorityJob(type: string, payload: unknown): Promise<Job<PriorityJobData>> {
    return this.addJob(type, payload, JobPriority.HIGH);
  }

  /**
   * Add a normal priority job.
   */
  async addNormalPriorityJob(type: string, payload: unknown): Promise<Job<PriorityJobData>> {
    return this.addJob(type, payload, JobPriority.NORMAL);
  }

  /**
   * Add a low priority job.
   */
  async addLowPriorityJob(type: string, payload: unknown): Promise<Job<PriorityJobData>> {
    return this.addJob(type, payload, JobPriority.LOW);
  }

  /**
   * Get queue statistics.
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const counts = await this.queue.getJobCounts();
    return {
      waiting: counts.waiting,
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
    };
  }

  /**
   * Get aggregated queue stats across all priority tiers.
   */
  async getAllQueueStats(): Promise<{
    critical: { waiting: number; active: number; completed: number; failed: number; delayed: number };
    normal: { waiting: number; active: number; completed: number; failed: number; delayed: number };
    low: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  }> {
    const [criticalCounts, normalCounts, lowCounts] = await Promise.all([
      this.criticalQueue.getJobCounts(),
      this.queue.getJobCounts(),
      this.lowPriorityQueue.getJobCounts(),
    ]);

    return {
      critical: {
        waiting: criticalCounts.waiting,
        active: criticalCounts.active,
        completed: criticalCounts.completed,
        failed: criticalCounts.failed,
        delayed: criticalCounts.delayed,
      },
      normal: {
        waiting: normalCounts.waiting,
        active: normalCounts.active,
        completed: normalCounts.completed,
        failed: normalCounts.failed,
        delayed: normalCounts.delayed,
      },
      low: {
        waiting: lowCounts.waiting,
        active: lowCounts.active,
        completed: lowCounts.completed,
        failed: lowCounts.failed,
        delayed: lowCounts.delayed,
      },
    };
  }

  /**
   * Get admin-friendly queue stats with average wait time estimates.
   * Performs a lightweight check by sampling up to 20 waiting jobs.
   */
  async getAdminQueueStats(): Promise<{
    tiers: Record<string, { waiting: number; active: number; completed: number; failed: number; delayed: number; avgWaitTimeMs: number }>;
    totalJobs: number;
  }> {
    const allStats = await this.getAllQueueStats();
    const tiers: Record<string, any> = {};

    for (const [tier, stats] of Object.entries(allStats)) {
      let avgWaitTimeMs = 0;
      const queue = tier === 'critical' ? this.criticalQueue : tier === 'low' ? this.lowPriorityQueue : this.queue;
      try {
        const waitingJobs = await queue.getWaiting(0, 20);
        if (waitingJobs.length > 0) {
          const now = Date.now();
          const totalWait = waitingJobs.reduce((sum, j) => {
            const created = j.timestamp || j.data?.createdAt?.getTime?.() || now;
            return sum + (now - created);
          }, 0);
          avgWaitTimeMs = Math.round(totalWait / waitingJobs.length);
        }
      } catch {
        // If we can't compute wait time, just report 0
      }
      tiers[tier] = { ...stats, avgWaitTimeMs };
    }

    const totalJobs = Object.values(tiers).reduce(
      (sum, t: any) => sum + t.waiting + t.active + t.delayed,
      0,
    );

    return { tiers, totalJobs };
  }

  /**
   * Get jobs by priority level.
   */
  async getJobsByPriority(priority: JobPriority, state: 'waiting' | 'active' | 'completed' | 'failed' = 'waiting'): Promise<Job<PriorityJobData>[]> {
    const jobs = await this.queue.getJobs([state], 0, 100);
    return jobs.filter(job => job.data.priority === priority);
  }

  /**
   * Pause the queue.
   */
  async pause(): Promise<void> {
    await this.queue.pause();
    this.logger.log('Priority queue paused');
  }

  /**
   * Resume the queue.
   */
  async resume(): Promise<void> {
    await this.queue.resume();
    this.logger.log('Priority queue resumed');
  }

  /**
   * Clear all jobs from the queue.
   */
  async clear(): Promise<void> {
    await this.queue.empty();
    this.logger.log('Priority queue cleared');
  }

  /**
   * Get the underlying Bull queue instance for the given priority.
   */
  getQueue(priority?: JobPriority): Queue<PriorityJobData> {
    if (priority !== undefined) {
      return this.getQueueForPriority(priority);
    }
    return this.queue;
  }

  /**
   * Get the critical queue instance.
   */
  getCriticalQueue(): Queue<PriorityJobData> {
    return this.criticalQueue;
  }

  /**
   * Get the low priority queue instance.
   */
  getLowPriorityQueue(): Queue<PriorityJobData> {
    return this.lowPriorityQueue;
  }
}