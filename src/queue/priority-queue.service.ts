import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job, JobOptions } from 'bull';

export enum JobPriority {
  LOW = 1,
  NORMAL = 5,
  HIGH = 10,
  CRITICAL = 15,
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
    @InjectQueue('priority-queue')
    private readonly queue: Queue<PriorityJobData>,
  ) {}

  /**
   * Add a job to the priority queue with specified priority.
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

    this.logger.log(`Adding ${type} job with priority ${priority}`);
    return this.queue.add(type, jobData, jobOptions);
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
   * Get the underlying Bull queue instance.
   */
  getQueue(): Queue<PriorityJobData> {
    return this.queue;
  }
}