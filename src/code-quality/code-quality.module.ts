import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { QualityMetricsService } from './quality-metrics.service';
import { QualityController } from './quality.controller';
import { CoverageCollector } from './collectors/coverage-collector';
import { ComplexityCollector } from './collectors/complexity-collector';
import { VulnerabilityCollector } from './collectors/vulnerability-collector';
import { DependencyCollector } from './collectors/dependency-collector';
import { MetricAggregator } from './utils/metric-aggregator';
import { CollectMetricsJob } from './jobs/collect-metrics.job';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    QualityMetricsService,
    CoverageCollector,
    ComplexityCollector,
    VulnerabilityCollector,
    DependencyCollector,
    MetricAggregator,
    CollectMetricsJob,
  ],
  controllers: [QualityController],
  exports: [QualityMetricsService],
})
export class CodeQualityModule {}
