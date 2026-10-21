import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { Queue, Job, JobOptions } from 'bull';
import { v4 as uuidv4 } from 'uuid';
import { CorrelationIdStore } from '../common/correlation/correlation-id.store';
import {
  UnsupportedPayloadVersionError,
  VersionedPayloadSchema,
} from './payload-versioning';

export const PRIORITY_QUEUE = 'priority-queue';
export const CRITICAL_QUEUE = 'critical-queue';
export const LOW_PRIORITY_QUEUE = 'low-priority-queue';
export const CANCELLABLE_QUEUE_NAMES = [
  PRIORITY_QUEUE,
  CRITICAL_QUEUE,
  LOW_PRIORITY_QUEUE,
] as const;
export type CancellableQueueName = (typeof CANCELLABLE_QUEUE_NAMES)[number];
export type JobLifecycleStatus =
  | 'waiting'
  | 'running'
  | 'cancellation_requested'
  | 'cancelled'
  | 'completed'
  | 'failed';

const JOB_LIFECYCLE_TTL_SECONDS = 30 * 24 * 60 * 60;

const REQUEST_CANCELLATION_SCRIPT = `
  local state = redis.call('GET', KEYS[1])
  if state == 'cancelled' or state == 'completed' or state == 'failed' then
    return state
  end
  if state == 'cancellation_requested' then
    return state
  end
  if state ~= 'waiting' and state ~= 'running' and state ~= false then
    return redis.error_reply('Invalid job lifecycle state: ' .. state)
  end
  if state == 'running' then
    redis.call('SET', KEYS[1], 'cancellation_requested')
  else
    redis.call('SET', KEYS[1], 'cancellation_requested', 'EX', ARGV[1])
  end
  return 'cancellation_requested'
`;

const BEGIN_JOB_SCRIPT = `
  local state = redis.call('GET', KEYS[1])
  if state == false then
    redis.call('SET', KEYS[1], 'running')
    return 'running'
  end
  if state == 'waiting' then
    redis.call('SET', KEYS[1], 'running')
    return 'running'
  end
  return state
`;

const COMPLETE_JOB_SCRIPT = `
  local state = redis.call('GET', KEYS[1])
  if state == 'cancellation_requested' then
    redis.call('SET', KEYS[1], 'cancelled', 'EX', ARGV[1])
    return 'cancelled'
  end
  if state == 'running' or state == 'waiting' then
    redis.call('SET', KEYS[1], 'completed', 'EX', ARGV[1])
    return 'completed'
  end
  return state
`;

const CANCEL_JOB_SCRIPT = `
  local state = redis.call('GET', KEYS[1])
  if state == 'cancellation_requested' then
    redis.call('SET', KEYS[1], 'cancelled', 'EX', ARGV[1])
    return 'cancelled'
  end
  return state
`;

const FAIL_JOB_SCRIPT = `
  local state = redis.call('GET', KEYS[1])
  if state == 'cancelled' or state == 'completed' or state == 'failed' then
    return state
  end
  redis.call('SET', KEYS[1], 'failed', 'EX', ARGV[1])
  return 'failed'
`;

const RETRY_JOB_SCRIPT = `
  local state = redis.call('GET', KEYS[1])
  if state == 'cancellation_requested' then
    return state
  end
  if state == 'running' then
    redis.call('SET', KEYS[1], 'waiting', 'EX', ARGV[1])
    return 'waiting'
  end
  return state
`;

const REMOVE_INITIAL_STATE_SCRIPT = `
  if redis.call('GET', KEYS[1]) == 'waiting' then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;

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
  /** Payload schema version, see `PRIORITY_JOB_SCHEMA`. */
  schemaVersion: number;
  type: string;
  payload: unknown;
  priority: JobPriority;
  createdAt: Date;
  /** Correlation ID propagated from the originating HTTP request or generated for scheduled work. */
  correlationId: string;
}

/**
 * Versions of the `PriorityJobData` envelope:
 *  - v1: no `schemaVersion`; `correlationId` may be missing (jobs enqueued
 *    before correlation IDs were propagated).
 *  - v2: `schemaVersion` stamped and `correlationId` always present.
 */
export const PRIORITY_JOB_SCHEMA = new VersionedPayloadSchema<PriorityJobData>(
  'priority-job',
  2,
  {
    1: (payload) => ({
      ...payload,
      correlationId:
        typeof payload.correlationId === 'string' && payload.correlationId
          ? payload.correlationId
          : uuidv4(),
    }),
  },
);

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
    private readonly configService: ConfigService,
    private readonly correlationIdStore: CorrelationIdStore,
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
    // Propagate correlation ID from the active HTTP context, or mint a fresh one
    // for scheduled/background work so every job has a traceable ID.
    const correlationId =
      this.correlationIdStore.getCorrelationId() ?? uuidv4();

    const jobData: PriorityJobData = {
      schemaVersion: PRIORITY_JOB_SCHEMA.currentVersion,
      type,
      payload,
      priority,
      createdAt: new Date(),
      correlationId,
    };

    const defaultAttempts =
      this.configService.get<number>('queueRetry.attempts') ?? 3;
    const defaultBackoffType =
      this.configService.get<'fixed' | 'exponential'>(
        'queueRetry.backoffType',
      ) ?? 'exponential';
    const defaultBackoffDelay =
      this.configService.get<number>('queueRetry.backoffDelay') ?? 2000;

    const jobOptions: JobOptions = {
      priority,
      attempts: defaultAttempts,
      backoff: {
        type: defaultBackoffType,
        delay: defaultBackoffDelay,
      },
      removeOnComplete: 50,
      removeOnFail: 10,
      ...options,
      jobId: options.jobId ? String(options.jobId) : uuidv4(),
    };

    const targetQueue = this.getQueueForPriority(priority);
    const jobId = String(jobOptions.jobId);
    const lifecycleKey = this.getLifecycleKey(targetQueue, jobId);
    const redis = await targetQueue.client;
    const initialized = await redis.set(
      lifecycleKey,
      'waiting',
      'EX',
      JOB_LIFECYCLE_TTL_SECONDS,
      'NX',
    );
    if (initialized !== 'OK') {
      throw new ConflictException(
        `Job identifier "${jobId}" is already in use or reserved.`,
      );
    }
    this.logger.log(
      `Adding ${type} job priority=${priority} correlationId=${correlationId} queue=${(targetQueue as any).name ?? 'priority-queue'}`,
    );
    try {
      return await targetQueue.add(type, jobData, jobOptions);
    } catch (error) {
      await redis.eval(REMOVE_INITIAL_STATE_SCRIPT, 1, lifecycleKey);
      throw error;
    }
  }

  async requestCancellation(
    queueName: string,
    jobId: string,
  ): Promise<JobLifecycleStatus> {
    const queue = this.getCancellableQueue(queueName);
    const lifecycleKey = this.getLifecycleKey(queue, jobId);
    const redis = await queue.client;
    const job = await queue.getJob(jobId);
    if (!job) {
      const savedState = (await redis.get(lifecycleKey)) as
        | JobLifecycleStatus
        | null;
      if (
        savedState === 'cancelled' ||
        savedState === 'completed' ||
        savedState === 'failed' ||
        savedState === 'cancellation_requested'
      ) {
        return savedState;
      }
      throw new NotFoundException(`Job "${jobId}" was not found.`);
    }

    let currentState = (await redis.get(lifecycleKey)) as
      | JobLifecycleStatus
      | null;

    if (!currentState) {
      const bullState = await job.getState();
      if (bullState === 'completed' || bullState === 'failed') {
        return bullState;
      }
      if (bullState === 'active') {
        throw new ConflictException(
          'This active job predates cooperative cancellation and cannot be stopped safely.',
        );
      }
      if (
        bullState !== 'waiting' &&
        bullState !== 'delayed' &&
        bullState !== 'paused'
      ) {
        throw new NotFoundException(`Job "${jobId}" was not found.`);
      }
      const initialized = await redis.set(
        lifecycleKey,
        'waiting',
        'EX',
        JOB_LIFECYCLE_TTL_SECONDS,
        'NX',
      );
      if (initialized === 'OK') {
        currentState = 'waiting';
      } else {
        currentState = (await redis.get(lifecycleKey)) as
          | JobLifecycleStatus
          | null;
      }
    }

    if (!currentState) {
      throw new Error(
        `Could not initialize lifecycle state for job "${jobId}".`,
      );
    }

    const requested = (await redis.eval(
      REQUEST_CANCELLATION_SCRIPT,
      1,
      lifecycleKey,
      JOB_LIFECYCLE_TTL_SECONDS,
    )) as JobLifecycleStatus;

    if (requested !== 'cancellation_requested') {
      return requested;
    }

    const bullState = await job.getState();
    if (
      bullState === 'waiting' ||
      bullState === 'delayed' ||
      bullState === 'paused'
    ) {
      try {
        await job.remove();
        return this.cancelRequestedJob(queue, jobId);
      } catch (error) {
        if ((await job.getState()) !== 'active') {
          throw error;
        }
      }
    }

    return ((await redis.get(lifecycleKey)) as JobLifecycleStatus | null) ??
      'cancellation_requested';
  }

  async getJobLifecycle(
    queueName: string,
    jobId: string,
  ): Promise<JobLifecycleStatus> {
    const queue = this.getCancellableQueue(queueName);
    const job = await queue.getJob(jobId);
    const lifecycleKey = this.getLifecycleKey(queue, jobId);
    const redis = await queue.client;
    const savedState = (await redis.get(lifecycleKey)) as
      | JobLifecycleStatus
      | null;

    if (savedState) {
      return savedState;
    }
    if (!job) {
      throw new NotFoundException(`Job "${jobId}" was not found.`);
    }

    const state = await job.getState();
    if (state === 'active') return 'running';
    if (state === 'completed' || state === 'failed') return state;
    return 'waiting';
  }

  async beginProcessing(
    queueName: string,
    jobId: string,
  ): Promise<JobLifecycleStatus> {
    const queue = this.getCancellableQueue(queueName);
    const redis = await queue.client;
    return (await redis.eval(
      BEGIN_JOB_SCRIPT,
      1,
      this.getLifecycleKey(queue, jobId),
      JOB_LIFECYCLE_TTL_SECONDS,
    )) as JobLifecycleStatus;
  }

  async completeProcessing(
    queueName: string,
    jobId: string,
  ): Promise<JobLifecycleStatus> {
    return this.transitionJob(
      COMPLETE_JOB_SCRIPT,
      queueName,
      jobId,
      'completed',
    );
  }

  async cancelRequestedProcessing(
    queueName: string,
    jobId: string,
  ): Promise<JobLifecycleStatus> {
    return this.transitionJob(
      CANCEL_JOB_SCRIPT,
      queueName,
      jobId,
      'cancelled',
    );
  }

  async failProcessing(queueName: string, jobId: string): Promise<void> {
    await this.transitionJob(FAIL_JOB_SCRIPT, queueName, jobId, 'failed');
  }

  async prepareRetry(
    queueName: string,
    jobId: string,
  ): Promise<JobLifecycleStatus> {
    return this.transitionJob(
      RETRY_JOB_SCRIPT,
      queueName,
      jobId,
      'waiting',
    );
  }

  private async cancelRequestedJob(
    queue: Queue<PriorityJobData>,
    jobId: string,
  ): Promise<JobLifecycleStatus> {
    const redis = await queue.client;
    return (await redis.eval(
      CANCEL_JOB_SCRIPT,
      1,
      this.getLifecycleKey(queue, jobId),
      JOB_LIFECYCLE_TTL_SECONDS,
    )) as JobLifecycleStatus;
  }

  private async transitionJob(
    script: string,
    queueName: string,
    jobId: string,
    fallback: JobLifecycleStatus,
  ): Promise<JobLifecycleStatus> {
    const queue = this.getCancellableQueue(queueName);
    const redis = await queue.client;
    return ((await redis.eval(
      script,
      1,
      this.getLifecycleKey(queue, jobId),
      JOB_LIFECYCLE_TTL_SECONDS,
    )) as JobLifecycleStatus | null) ?? fallback;
  }

  private getLifecycleKey(
    queue: Queue<PriorityJobData>,
    jobId: string,
  ): string {
    return `${queue.toKey(jobId)}:lifecycle`;
  }

  private getCancellableQueue(
    queueName: string,
  ): Queue<PriorityJobData> {
    switch (queueName) {
      case PRIORITY_QUEUE:
        return this.queue;
      case CRITICAL_QUEUE:
        return this.criticalQueue;
      case LOW_PRIORITY_QUEUE:
        return this.lowPriorityQueue;
      default:
        throw new BadRequestException(
          `Unsupported cancellable queue "${queueName}".`,
        );
    }
  }

  /**
   * Returns a job's data in the current `PriorityJobData` schema, migrating
   * payloads written by older app versions. Processors should read job data
   * through this method rather than `job.data`.
   *
   * An unsupported version throws `UnsupportedPayloadVersionError` (a
   * `PermanentError`) and the job is discarded from further retries, so it
   * fails once and `JobErrorHandler` dead-letters it as a fatal failure.
   */
  readJobData(job: Job<PriorityJobData>): PriorityJobData {
    try {
      return PRIORITY_JOB_SCHEMA.upgrade(job.data);
    } catch (error) {
      if (error instanceof UnsupportedPayloadVersionError) {
        void job.discard();
        this.logger.error(`Job ${job.id} rejected: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Add a critical job (highest priority).
   */
  async addCriticalJob(
    type: string,
    payload: unknown,
  ): Promise<Job<PriorityJobData>> {
    return this.addJob(type, payload, JobPriority.CRITICAL);
  }

  /**
   * Add a high priority job.
   */
  async addHighPriorityJob(
    type: string,
    payload: unknown,
  ): Promise<Job<PriorityJobData>> {
    return this.addJob(type, payload, JobPriority.HIGH);
  }

  /**
   * Add a normal priority job.
   */
  async addNormalPriorityJob(
    type: string,
    payload: unknown,
  ): Promise<Job<PriorityJobData>> {
    return this.addJob(type, payload, JobPriority.NORMAL);
  }

  /**
   * Add a low priority job.
   */
  async addLowPriorityJob(
    type: string,
    payload: unknown,
  ): Promise<Job<PriorityJobData>> {
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
    critical: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    };
    normal: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    };
    low: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    };
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
    tiers: Record<
      string,
      {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
        avgWaitTimeMs: number;
      }
    >;
    totalJobs: number;
  }> {
    const allStats = await this.getAllQueueStats();
    const tiers: Record<string, any> = {};

    for (const [tier, stats] of Object.entries(allStats)) {
      let avgWaitTimeMs = 0;
      const queue =
        tier === 'critical'
          ? this.criticalQueue
          : tier === 'low'
            ? this.lowPriorityQueue
            : this.queue;
      try {
        const waitingJobs = await queue.getWaiting(0, 20);
        if (waitingJobs.length > 0) {
          const now = Date.now();
          const totalWait = waitingJobs.reduce((sum, j) => {
            const created =
              j.timestamp || j.data?.createdAt?.getTime?.() || now;
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
  async getJobsByPriority(
    priority: JobPriority,
    state: 'waiting' | 'active' | 'completed' | 'failed' = 'waiting',
  ): Promise<Job<PriorityJobData>[]> {
    const jobs = await this.queue.getJobs([state], 0, 100);
    return jobs.filter((job) => job.data.priority === priority);
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
