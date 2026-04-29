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
import { User } from '../users/entities/user.entity';
import { PriceService } from '../shared/price.service';
import { CorrelationService } from './services/correlation.service';
import { PriceHistory } from '../prices/entities/price-history.entity';
import { AssetPair } from '../assets/entities/asset-pair.entity';
import { TradePatternsModule } from './trade-patterns/trade-patterns.module';
import { JobsModule } from '../jobs/jobs.module';
import { FunnelTrackerService } from './funnels/funnel-tracker.service';
import { FunnelController } from './funnels/funnel.controller';
import { AnalyzeFunnelsJob } from './funnels/jobs/analyze-funnels.job';
import { Funnel } from './funnels/entities/funnel.entity';
import { FunnelStep } from './funnels/entities/funnel-step.entity';
import { UserFunnelProgress } from './funnels/entities/user-funnel-progress.entity';
import { AbTestAnalyzerService } from './ab-testing/ab-test-analyzer.service';
import { AbTestController } from './ab-testing/ab-test.controller';
import { ExperimentResult } from './ab-testing/entities/experiment-result.entity';
import { VariantPerformance } from './ab-testing/entities/variant-performance.entity';
import { LtvCalculatorService } from './ltv/ltv-calculator.service';
import { LtvController } from './ltv/ltv.controller';
import { UserLtv } from './ltv/entities/user-ltv.entity';
import { LtvSegment } from './ltv/entities/ltv-segment.entity';
import { CalculateLtvJob } from './ltv/jobs/calculate-ltv.job';
import { CohortController } from './cohort-analysis/cohort.controller';
import { CohortAnalyzerService } from './cohort-analysis/cohort-analyzer.service';
import { CalculateCohortsJob } from './cohort-analysis/jobs/calculate-cohorts.job';
import { Cohort } from './cohort-analysis/entities/cohort.entity';
import { CohortMetric } from './cohort-analysis/entities/cohort-metric.entity';
import { BehaviorTrackingService } from './behavior-tracking.service';
import { BehaviorTrackingController } from './behavior-tracking.controller';
import { UserSessionAnalytics } from './entities/user-session.entity';
import { UserPreference } from '../users/entities/user-preference.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEvent,
      MetricSnapshot,
      Trade,
      Signal,
      User,
      PriceHistory,
      AssetPair,
      ExperimentResult,
      VariantPerformance,
      UserLtv,
      LtvSegment,
      Funnel,
      FunnelStep,
      UserFunnelProgress,
      Cohort,
      CohortMetric,
      UserSessionAnalytics,
      UserPreference,
    ]),
    ScheduleModule.forRoot(),
    TradePatternsModule,
    JobsModule,
  ],
  controllers: [
    AnalyticsController,
    AbTestController,
    LtvController,
    FunnelController,
    CohortController,
    BehaviorTrackingController,
  ],
  providers: [
    AnalyticsService,
    RiskMetricsService,
    StatisticalAnalysisService,
    AttributionService,
    CorrelationService,
    PriceService,
    AbTestAnalyzerService,
    LtvCalculatorService,
    CalculateLtvJob,
    FunnelTrackerService,
    AnalyzeFunnelsJob,
    CohortAnalyzerService,
    CalculateCohortsJob,
    BehaviorTrackingService,
  ],
  exports: [
    AnalyticsService,
    RiskMetricsService,
    AttributionService,
    CorrelationService,
    StatisticalAnalysisService,
    AbTestAnalyzerService,
    LtvCalculatorService,
    FunnelTrackerService,
    CohortAnalyzerService,
    BehaviorTrackingService,
  ],
})
export class AnalyticsModule {}
