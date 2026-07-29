import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobSchedulerService } from '../../../jobs/job-scheduler.service';
import { PriceCacheRefreshService } from '../price-cache-refresh.service';

@Injectable()
export class RefreshHistoricalPricesJob implements OnModuleInit {
  constructor(
    private readonly scheduler: JobSchedulerService,
    private readonly priceCacheRefreshService: PriceCacheRefreshService,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: 'market-data.refresh-historical-prices',
      cronEnvKey: 'CRON_REFRESH_HISTORICAL_PRICES',
      defaultCron: '0 */6 * * *',
      handler: () => this.run(),
    });
  }

  async run(): Promise<void> {
    await this.priceCacheRefreshService.refreshHistoricalPriceCaches();
  }
}
