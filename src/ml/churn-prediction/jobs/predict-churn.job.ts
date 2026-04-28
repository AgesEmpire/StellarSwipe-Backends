import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ChurnPredictorService } from '../churn-predictor.service';

// Stub user activity source — replace with real UserService/query
const MOCK_USERS: { userId: string; features: Parameters<ChurnPredictorService['predictForUser']>[1] }[] = [];

@Injectable()
export class PredictChurnJob {
  private readonly logger = new Logger(PredictChurnJob.name);

  constructor(private readonly churnService: ChurnPredictorService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async run(): Promise<void> {
    this.logger.log('Running daily churn prediction job');
    for (const { userId, features } of MOCK_USERS) {
      await this.churnService.predictForUser(userId, features);
    }
    this.logger.log('Churn prediction job complete');
  }
}
