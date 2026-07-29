import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { AnalyticsService } from '../analytics.service';
import { DeadLetterService } from '../../jobs/dead-letter.service';
import {
  ANALYTICS_REPORTS_QUEUE,
  GENERATE_EXPORT_JOB,
  AnalyticsExportJobData,
} from './analytics-reports.service';

@Processor(ANALYTICS_REPORTS_QUEUE)
export class AnalyticsReportsProcessor {
  private readonly logger = new Logger(AnalyticsReportsProcessor.name);

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly deadLetterService: DeadLetterService,
  ) {}

  @Process(GENERATE_EXPORT_JOB)
  async handleGenerateExport(job: Job<AnalyticsExportJobData>): Promise<string> {
    const { period, startDate, endDate, timezone } = job.data;
    this.logger.log(`Generating analytics export (job ${job.id}) for period=${period}`);

    return this.analyticsService.exportMetrics({
      period,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      timezone,
    });
  }

  @OnQueueFailed()
  async onFailed(job: Job, error: Error): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= attempts) {
      await this.deadLetterService.capture(job, error);
    }
  }
}
