import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Funnel } from '../entities/funnel.entity';
import { FunnelTrackerService } from '../funnel-tracker.service';
import { JobSchedulerService } from '../../../jobs/job-scheduler.service';

@Injectable()
export class AnalyzeFunnelsJob implements OnModuleInit {
  constructor(
    @InjectRepository(Funnel) private readonly funnelRepo: Repository<Funnel>,
    private readonly funnelTrackerService: FunnelTrackerService,
    private readonly scheduler: JobSchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: 'analytics.funnels',
      cronEnvKey: 'CRON_ANALYTICS_FUNNELS',
      defaultCron: '0 0 * * *', // daily at midnight
      handler: () => this.run(),
    });
  }

  async run(): Promise<void> {
    const funnels = await this.funnelRepo.find({ where: { isActive: true } });
    for (const funnel of funnels) {
      await this.funnelTrackerService.analyzeFunnel(funnel.id);
    }
  }
}
