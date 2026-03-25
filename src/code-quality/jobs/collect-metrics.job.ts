import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QualityMetricsService } from '../quality-metrics.service';

@Injectable()
export class CollectMetricsJob {
  private readonly logger = new Logger(CollectMetricsJob.name);

  constructor(private readonly qualityMetricsService: QualityMetricsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyCollection(): Promise<void> {
    this.logger.log('Running scheduled code quality metrics collection...');
    try {
      const report = await this.qualityMetricsService.collectAll();
      this.logger.log(`Scheduled collection complete. Score: ${report.score}/100`);
    } catch (err) {
      this.logger.error(`Scheduled collection failed: ${err.message}`);
    }
  }
}
