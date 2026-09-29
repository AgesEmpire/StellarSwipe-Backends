import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
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
 * Structured alert emitted when a job exceeds its processing window.
 */
export interface StuckJobAlert {
  severity: 'high';
  type: 'stuck_job_quarantined';
  message: string;
  queueName: string;
  jobName: string;
  jobId: string;
  ageMs: number;
  maxDurationMs: number;
  startedAt: string;
  detectedAt: string;
}

/**
 * Pluggable alert sink (e.g. PagerDuty, Slack, monitoring system).
 * Provide an implementation under STUCK_JOB_ALERT_PROVIDER to enable alerting.
 */
export interface StuckJobAlertProvider {
  sendAlert(alert: StuckJobAlert): Promise<void> | void;
}

export const STUCK_JOB_ALERT_PROVIDER = 'STUCK_JOB_ALERT_PROVIDER';

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
 *   - Alerts are sent once per stuck job via STUCK_JOB_ALERT_PROVIDER (if provided)
 *   - Does not retry or fail jobs automatically; requires manual intervention
 */
@Injectable()
export class StuckJobDetectorService {
  private readonly logger = new Logger(StuckJobDetectorService.name);
  private readonly jobConfigs = new Map<string, JobProcessingConfig>(); // key: "{queueName}:{jobName}"
  private readonly queuesMap = new Map<string, Queue>(); // key: queueName
  private readonly quarantineStore = new Map<string, QuarantinedJob[]>(); // key: queueName
  private readonly quarantinedJobKeys = new Set<string>(); // key: "{queueName}:{jobId}"
  private readonly pendingAlerts = new Map<string, QuarantinedJob>(); // alerts awaiting delivery

  constructor(
    @Optional()
    @Inject(STUCK_JOB_ALERT_PROVIDER)
    private readonly alertProvider?: StuckJobAlertProvider,
  ) {}

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
          const key = `${queueName}:${job.id}`;
          if (this.quarantinedJobKeys.has(key)) {
            // Already quarantined on a previous scan; only retry an undelivered alert
            const pending = this.pendingAlerts.get(key);
            if (pending) {
              await this.sendStuckJobAlert(pending);
            }
            continue;
          }
          await this.quarantineJob(job, queueName, config, durationMs);
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
    config: JobProcessingConfig,
    actualDurationMs: number,
  ): Promise<void> {
    const { maxDurationMs } = config;
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
    this.quarantinedJobKeys.add(`${queueName}:${quarantinedJob.jobId}`);

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

    if (config.alertOnQuarantine !== false) {
      this.pendingAlerts.set(`${queueName}:${quarantinedJob.jobId}`, quarantinedJob);
      await this.sendStuckJobAlert(quarantinedJob);
    }
  }

  private async sendStuckJobAlert(quarantinedJob: QuarantinedJob): Promise<void> {
    const key = `${quarantinedJob.queueName}:${quarantinedJob.jobId}`;
    if (!this.alertProvider) {
      this.pendingAlerts.delete(key);
      return;
    }

    const alert: StuckJobAlert = {
      severity: 'high',
      type: 'stuck_job_quarantined',
      message: `Job ${quarantinedJob.jobName} (${quarantinedJob.jobId}) quarantined in queue ${quarantinedJob.queueName}`,
      queueName: quarantinedJob.queueName,
      jobName: quarantinedJob.jobName,
      jobId: quarantinedJob.jobId,
      ageMs: quarantinedJob.actualDurationMs,
      maxDurationMs: quarantinedJob.maxDurationMs,
      startedAt: quarantinedJob.startedAt.toISOString(),
      detectedAt: quarantinedJob.quarantinedAt.toISOString(),
    };

    try {
      await this.alertProvider.sendAlert(alert);
      this.pendingAlerts.delete(key);
    } catch (error) {
      // Keep the alert pending so the next scan retries delivery
      this.logger.error(
        `Failed to send stuck job alert for ${key}: ${(error as Error).message}`,
        { type: 'stuck_job_alert_failed', queue: quarantinedJob.queueName, jobId: quarantinedJob.jobId },
      );
    }
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
    for (const key of [...this.quarantinedJobKeys]) {
      if (key.startsWith(`${queueName}:`)) {
        this.quarantinedJobKeys.delete(key);
        this.pendingAlerts.delete(key);
      }
    }
    this.logger.log(`Cleared quarantine records for queue ${queueName}`);
  }
}
