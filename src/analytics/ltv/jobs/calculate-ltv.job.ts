import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UserLtv } from '../entities/user-ltv.entity';
import { LtvCalculatorService } from '../ltv-calculator.service';

@Injectable()
export class CalculateLtvJob {
  private readonly logger = new Logger(CalculateLtvJob.name);

  constructor(
    @InjectRepository(UserLtv)
    private readonly ltvRepo: Repository<UserLtv>,
    private readonly ltvService: LtvCalculatorService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async recalculateAll(): Promise<void> {
    const records = await this.ltvRepo.find();
    this.logger.log(`Recalculating LTV for ${records.length} users`);
    for (const record of records) {
      try {
        await this.ltvService.calculate({
          userId: record.userId,
          subscriptionTier: record.subscriptionTier as 'free' | 'basic' | 'pro' | 'enterprise',
          monthsActive: 0,
          totalTradeVolume: 0,
          tradeCount: 0,
          avgMonthlyRevenue: 0,
          engagementScore: 0,
          churnRisk: 0,
          ...(record.metadata as object),
        });
      } catch (err) {
        this.logger.error(`Failed LTV recalc for ${record.userId}`, err);
      }
    }
  }
}
