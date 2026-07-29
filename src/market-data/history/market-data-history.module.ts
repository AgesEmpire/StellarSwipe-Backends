import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from '../../jobs/jobs.module';
import { PriceHistory } from '../../prices/entities/price-history.entity';
import { PriceCacheRefreshService } from './price-cache-refresh.service';
import { RefreshHistoricalPricesJob } from './jobs/refresh-historical-prices.job';

@Module({
  imports: [TypeOrmModule.forFeature([PriceHistory]), JobsModule],
  providers: [PriceCacheRefreshService, RefreshHistoricalPricesJob],
  exports: [PriceCacheRefreshService],
})
export class MarketDataHistoryModule {}
