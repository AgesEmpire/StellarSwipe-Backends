import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { MarketRegime } from './regime-detection/entities/market-regime.entity';
import { RegimeTransition } from './regime-detection/entities/regime-transition.entity';
import { RegimeDetectorService } from './regime-detection/regime-detector.service';
import { RegimeController } from './regime-detection/regime.controller';
import { DetectRegimeChangesJob } from './regime-detection/jobs/detect-regime-changes.job';
import { PriceOracleModule } from '../prices/price-oracle.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MarketRegime, RegimeTransition]),
    ScheduleModule,
    PriceOracleModule,
  ],
  providers: [RegimeDetectorService, DetectRegimeChangesJob],
  controllers: [RegimeController],
  exports: [RegimeDetectorService],
})
export class MarketIntelligenceModule {}
