import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { MetricPeriod } from '../entities/metric-snapshot.entity';

export const ANALYTICS_REPORTS_QUEUE = 'analytics-reports';
export const GENERATE_EXPORT_JOB = 'generate-export';

export interface AnalyticsExportJobData {
  period: MetricPeriod;
  startDate: string;
  endDate: string;
  timezone: string;
}

export type AnalyticsReportJobState =
  | 'queued'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed'
  | 'unknown';

export interface AnalyticsReportStatus {
  jobId: string;
  state: AnalyticsReportJobState;
  attemptsMade: number;
  failedReason?: string;
  result?: string;
}

/**
 * Moves heavy analytics CSV export generation (`AnalyticsService.exportMetrics`)
 * out of the request thread. The report content itself is returned as the
 * Bull job's `returnvalue` rather than persisted, so status/result tracking
 * is backed entirely by the queue — no extra entity/migration needed.
 */
@Injectable()
export class AnalyticsReportsService {
  private readonly logger = new Logger(AnalyticsReportsService.name);

  constructor(
    @InjectQueue(ANALYTICS_REPORTS_QUEUE)
    private readonly queue: Queue<AnalyticsExportJobData>,
  ) {}

  async enqueueExport(params: AnalyticsExportJobData): Promise<{ jobId: string }> {
    const job = await this.queue.add(GENERATE_EXPORT_JOB, params, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 20,
      removeOnFail: 10,
    });

    this.logger.log(`Analytics export job ${job.id} queued for period=${params.period}`);
    return { jobId: String(job.id) };
  }

  async getJobStatus(jobId: string): Promise<AnalyticsReportStatus> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Analytics report job ${jobId} not found`);
    }

    const bullState = await job.getState();
    const state = this.mapState(bullState);

    return {
      jobId: String(job.id),
      state,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      result: state === 'completed' ? (job.returnvalue as string) : undefined,
    };
  }

  private mapState(bullState: string): AnalyticsReportJobState {
    switch (bullState) {
      case 'waiting':
      case 'paused':
        return 'queued';
      case 'active':
        return 'active';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'delayed':
        return 'delayed';
      default:
        return 'unknown';
    }
  }
}
