import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue, Job } from 'bull';

/**
 * Configuration for a job type's processing expectations
 */
export interface JobProcessingConfig {
  maxDurationMs: number; // Maximum expected processing time in milliseconds
  alertOnQuarantine?: boolean; // defaults to true
}

export enum QuarantineReason {
  EXCEEDED_MAX_DURATION = 'exceeded_max_duration',
  MANUAL_INTERVENTION = 'manual_intervention',
}

export interface QuarantinedJob {
  jobId: string;
  jobName: string;
  queueName: string;
  reason: QuarantineReason;
  maxDurationMs: number;
  actualDurationMs: number;
  startedAt: Date;
  quarantinedAt: Date;
  metadata?: Record<string, any>;
}

/**
 * StuckJobDetectorService
 *
 * Monitors BullMQ queues for jobs that have been actively processing
 * beyond their expected maximum duration and moves them to a quarantine state.
 *
 * The quarantine state is separate from the dead-letter queue, allowing
 * operator investigation and manual intervention.
 *
 * Usage:
 *   1. Register queue monitoring:
 *      this.stuckJobDetector.registerQueueMonitoring('my-queue', 'task-name', { maxDurationMs: 30000 })
 *   2. Pass queue instance (optional if you pass it during registration):
 *      this.stuckJobDetector.attachQueue(queue)
 *   3. Service runs scheduled checks automatically via @Cron
 *
 * Notes:
 *   - Quarantined jobs are stored with metadata for investigation
 *   - Alerts should be emitted (stubbed for integration)
 *   - Does not retry or fail jobs automatically; requires manual intervention
 */
@Injectable()
export class StuckJobDetectorService {
  private readonly logger = new Logger(StuckJobDetectorService.name);
  private readonly jobConfigs = new Map<string, JobProcessingConfig>(); // key: "{queueName}:{jobName}"
  private readonly queuesMap = new Map<string, Queue>(); // key: queueName
  private readonly quarantineStore = new Map<string, QuarantinedJob[]>(); // key: queueName

  constructor() {}

  /**
   * Register a job type for monitoring with max processing duration.
   * Call this during module initialization or queue setup.
   */
  registerQueueMonitoring(
    queueName: string,
    jobName: string,
    config: JobProcessingConfig,
  ): void {
    const key = `${queueName}:${jobName}`;
    this.jobConfigs.set(key, config);
    this.logger.log(
      `Registered queue monitoring: ${queueName}/${jobName} (max duration: ${config.maxDurationMs}ms)`,
    );
  }

  /**
   * Attach a Bull Queue instance for monitoring.
   * Call this after creating the queue in your module.
   */
  attachQueue(queue: Queue): void {
    const queueName = queue.name;
    this.queuesMap.set(queueName, queue);
    if (!this.quarantineStore.has(queueName)) {
      this.quarantineStore.set(queueName, []);
    }
    this.logger.debug(`Attached queue for monitoring: ${queueName}`);
  }

  /**
   * Scheduled check (runs every 5 minutes) to detect stuck jobs.
   * Moves jobs exceeding their max duration to quarantine.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async detectAndQuarantineStuckJobs(): Promise<void> {
    for (const [queueName, queue] of this.queuesMap.entries()) {
      try {
        await this.checkQueueForStuckJobs(queueName, queue);
      } catch (error) {
        this.logger.error(
          `Error checking queue ${queueName} for stuck jobs: ${(error as Error).message}`,
          { type: 'stuck_job_check_error', queue: queueName },
        );
      }
    }
  }

  private async checkQueueForStuckJobs(queueName: string, queue: Queue): Promise<void> {
    try {
      // Get all active jobs
      const activeJobs = await queue.getActive();

      const now = Date.now();

      for (const job of activeJobs) {
        const config = this.jobConfigs.get(`${queueName}:${job.name}`);
        if (!config) {
          continue; // Job type not registered for monitoring
        }

        const progressedAt = job.progressedAt ?? job.processedOn ?? job.finishedOn ?? job.timestamp;
        if (!progressedAt) {
          continue; // Unable to determine start time
        }

        const durationMs = now - progressedAt;

        if (durationMs > config.maxDurationMs) {
          await this.quarantineJob(job, queueName, config.maxDurationMs, durationMs);
        }
      }
    } catch (error) {
      this.logger.error(
        `Error processing active jobs for queue ${queueName}: ${(error as Error).message}`,
      );
    }
  }

  private async quarantineJob(
    job: Job,
    queueName: string,
    maxDurationMs: number,
    actualDurationMs: number,
  ): Promise<void> {
    const quarantinedJob: QuarantinedJob = {
      jobId: job.id?.toString() || 'unknown',
      jobName: job.name,
      queueName,
      reason: QuarantineReason.EXCEEDED_MAX_DURATION,
      maxDurationMs,
      actualDurationMs,
      startedAt: new Date(job.timestamp || Date.now()),
      quarantinedAt: new Date(),
      metadata: {
        attempts: job.attemptsMade,
        failedReason: job.failedReason,
        data: job.data,
      },
    };

    // Store quarantine record
    const store = this.quarantineStore.get(queueName) || [];
    store.push(quarantinedJob);
    this.quarantineStore.set(queueName, store);

    this.logger.error(
      `Job quarantined: ${job.name} (${job.id}) in queue ${queueName} - exceeded max duration (${actualDurationMs}ms > ${maxDurationMs}ms)`,
      {
        type: 'job_quarantined',
        queue: queueName,
        jobName: job.name,
        jobId: job.id,
        durationMs: actualDurationMs,
        maxDurationMs,
        timestamp: new Date().toISOString(),
      },
    );

    // Remove job from active state to prevent continued processing
    try {
      await job.moveToFailed(
        new Error(
          `Job quarantined due to exceeding max processing duration of ${maxDurationMs}ms`,
        ),
        false, // do not skipAttempts
      );
    } catch (error) {
      this.logger.warn(
        `Failed to move quarantined job to failed state: ${(error as Error).message}`,
      );
    }

    // TODO: Integrate with alerting system
    // Example: this.alertingService.alert({
    //   severity: 'high',
    //   type: 'stuck_job_quarantined',
    //   message: `Job ${job.name} (${job.id}) quarantined in queue ${queueName}`,
    //   details: quarantinedJob,
    // })
  }

  /**
   * Retrieve quarantined jobs for a queue (for dashboard/investigation)
   */
  getQuarantinedJobs(queueName: string): QuarantinedJob[] {
    return this.quarantineStore.get(queueName) || [];
  }

  /**
   * Retrieve all quarantined jobs across all queues
   */
  getAllQuarantinedJobs(): Map<string, QuarantinedJob[]> {
    return new Map(this.quarantineStore);
  }

  /**
   * Manually quarantine a job for operator investigation
   */
  async manuallyQuarantineJob(
    queueName: string,
    jobId: string | number,
    reason?: string,
  ): Promise<void> {
    const queue = this.queuesMap.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not registered`);
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found in queue ${queueName}`);
    }

    const quarantinedJob: QuarantinedJob = {
      jobId: job.id?.toString() || jobId.toString(),
      jobName: job.name,
      queueName,
      reason: QuarantineReason.MANUAL_INTERVENTION,
      maxDurationMs: 0,
      actualDurationMs: 0,
      startedAt: new Date(job.timestamp || Date.now()),
      quarantinedAt: new Date(),
      metadata: {
        manualReason: reason,
        attempts: job.attemptsMade,
      },
    };

    const store = this.quarantineStore.get(queueName) || [];
    store.push(quarantinedJob);
    this.quarantineStore.set(queueName, store);

    this.logger.warn(
      `Job manually quarantined: ${job.name} (${job.id}) in queue ${queueName}. Reason: ${reason || 'unspecified'}`,
      {
        type: 'job_manually_quarantined',
        queue: queueName,
        jobName: job.name,
        jobId: job.id,
        reason,
        timestamp: new Date().toISOString(),
      },
    );
  }

  /**
   * Clear quarantine records for a queue (after investigation/resolution)
   */
  clearQuarantineRecords(queueName: string): void {
    this.quarantineStore.delete(queueName);
    this.logger.log(`Cleared quarantine records for queue ${queueName}`);
  }
}
