import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ChurnPredictorService } from '../churn-predictor.service';

@Injectable()
export class TriggerRetentionJob {
  private readonly logger = new Logger(TriggerRetentionJob.name);

  constructor(private readonly churnService: ChurnPredictorService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async run(): Promise<void> {
    this.logger.log('Running retention trigger job');
    const highRisk = await this.churnService.getHighRiskUsers();
    await Promise.allSettled(highRisk.map((p) => this.churnService.triggerRetention(p)));
    this.logger.log(`Retention triggered for ${highRisk.length} users`);
  }
}
