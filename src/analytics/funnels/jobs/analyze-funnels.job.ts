import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FunnelTrackerService } from '../funnel-tracker.service';
import { USER_ACQUISITION_FUNNEL } from '../interfaces/funnel-step.interface';

@Injectable()
export class AnalyzeFunnelsJob {
  private readonly logger = new Logger(AnalyzeFunnelsJob.name);

  constructor(private readonly funnelTrackerService: FunnelTrackerService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async run() {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    try {
      const report = await this.funnelTrackerService.getConversionReport(
        USER_ACQUISITION_FUNNEL.name,
        from,
        to,
      );
      this.logger.log(
        `Weekly funnel report — conversion: ${report.overallConversionRate}%, ` +
          `top drop-off: ${report.dropOffPoints[0]?.stepKey ?? 'none'}`,
      );
    } catch (err) {
      this.logger.error('Failed to run funnel analysis job', err);
    }
  }
}
