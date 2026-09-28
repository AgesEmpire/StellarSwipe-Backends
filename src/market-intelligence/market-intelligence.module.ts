import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { MarketRegime } from './regime-detection/entities/market-regime.entity';
import { RegimeTransition } from './regime-detection/entities/regime-transition.entity';
import { MarketSnapshot } from './entities/market-snapshot.entity';
import { RegimeDetectorService } from './regime-detection/regime-detector.service';
import { RegimeController } from './regime-detection/regime.controller';
import { DetectRegimeChangesJob } from './regime-detection/jobs/detect-regime-changes.job';
import { MarketDataIngestionService } from './market-data-ingestion.service';
import { MarketDataIngestionJob } from './jobs/market-data-ingestion.job';
import { MarketDataIngestionController } from './market-data-ingestion.controller';
import { PriceOracleModule } from '../prices/price-oracle.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MarketRegime, RegimeTransition, MarketSnapshot]),
    ScheduleModule,
    PriceOracleModule,
  ],
  providers: [
    RegimeDetectorService,
    DetectRegimeChangesJob,
    MarketDataIngestionService,
    MarketDataIngestionJob,
  ],
  controllers: [RegimeController, MarketDataIngestionController],
  exports: [RegimeDetectorService, MarketDataIngestionService, MarketDataIngestionJob],
})
export class MarketIntelligenceModule {}
