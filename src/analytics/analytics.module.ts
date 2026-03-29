import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { UserEvent } from './entities/user-event.entity';
import { MetricSnapshot } from './entities/metric-snapshot.entity';
import { RiskMetricsService } from './services/risk-metrics.service';
import { StatisticalAnalysisService } from './services/statistical-analysis.service';
import { AttributionService } from './services/attribution.service';
import { Trade } from '../trades/entities/trade.entity';
import { Signal } from '../signals/entities/signal.entity';
import { PriceService } from '../shared/price.service';
import { CorrelationService } from './services/correlation.service';
import { PriceHistory } from '../prices/entities/price-history.entity';
import { AssetPair } from '../assets/entities/asset-pair.entity';
import { TradePatternsModule } from './trade-patterns/trade-patterns.module';
import { FunnelsModule } from './funnels/funnels.module';
 feature/ltv-calculator

import { AbTestAnalyzerService } from './ab-testing/ab-test-analyzer.service';
import { AbTestController } from './ab-testing/ab-test.controller';
import { ExperimentResult } from './ab-testing/entities/experiment-result.entity';
import { VariantPerformance } from './ab-testing/entities/variant-performance.entity';
 main
import { LtvCalculatorService } from './ltv/ltv-calculator.service';
import { LtvController } from './ltv/ltv.controller';
import { UserLtv } from './ltv/entities/user-ltv.entity';
import { LtvSegment } from './ltv/entities/ltv-segment.entity';
import { CalculateLtvJob } from './ltv/jobs/calculate-ltv.job';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEvent,
      MetricSnapshot,
      Trade,
      Signal,
      PriceHistory,
      AssetPair,
 feature/ltv-calculator

      ExperimentResult,
      VariantPerformance,
 main
      UserLtv,
      LtvSegment,
    ]),
    ScheduleModule.forRoot(),
    TradePatternsModule,
    FunnelsModule,
  ],
 feature/ltv-calculator
  controllers: [AnalyticsController, LtvController],

  controllers: [AnalyticsController, AbTestController, LtvController],
 main
  providers: [
    AnalyticsService,
    RiskMetricsService,
    StatisticalAnalysisService,
    AttributionService,
    CorrelationService,
    PriceService,
feature/ltv-calculator

    AbTestAnalyzerService,
main
    LtvCalculatorService,
    CalculateLtvJob,
  ],
  exports: [
    AnalyticsService,
    RiskMetricsService,
    AttributionService,
    CorrelationService,
    StatisticalAnalysisService,
 feature/ltv-calculator

    AbTestAnalyzerService,
 main
    LtvCalculatorService,
  ],
})
export class AnalyticsModule {}
