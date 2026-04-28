import { Injectable, OnModuleInit } from '@nestjs/common';
import { CohortAnalyzerService } from '../cohort-analyzer.service';
import { JobSchedulerService } from '../../../jobs/job-scheduler.service';

@Injectable()
export class CalculateCohortsJob implements OnModuleInit {
  constructor(
    private readonly cohortAnalyzerService: CohortAnalyzerService,
    private readonly scheduler: JobSchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: 'analytics.cohorts',
      cronEnvKey: 'CRON_ANALYTICS_COHORTS',
      defaultCron: '0 1 * * *', // daily at 1 AM
      handler: () => this.run(),
    });
  }

  async run(): Promise<void> {
    await this.cohortAnalyzerService.analyze({
      cohortType: 'signup_period',
      period: 'month',
      retentionPeriods: 6,
    });
  }
}
