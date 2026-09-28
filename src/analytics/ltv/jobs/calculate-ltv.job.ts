import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserLtv } from '../entities/user-ltv.entity';
import { LtvCalculatorService } from '../ltv-calculator.service';
import { JobSchedulerService } from '../../../jobs/job-scheduler.service';

@Injectable()
export class CalculateLtvJob implements OnModuleInit {
  constructor(
    @InjectRepository(UserLtv)
    private readonly ltvRepo: Repository<UserLtv>,
    private readonly ltvService: LtvCalculatorService,
    private readonly scheduler: JobSchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: 'analytics.ltv',
      cronEnvKey: 'CRON_ANALYTICS_LTV',
      defaultCron: '0 0 * * *', // daily at midnight
      handler: () => this.recalculateAll(),
    });
  }

  async recalculateAll(): Promise<void> {
    const records = await this.ltvRepo.find();
    for (const record of records) {
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
    }
  }
}
