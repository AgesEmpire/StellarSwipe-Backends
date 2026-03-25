import { Injectable, Logger } from '@nestjs/common';
import { CoverageCollector } from './collectors/coverage-collector';
import { ComplexityCollector } from './collectors/complexity-collector';
import { VulnerabilityCollector } from './collectors/vulnerability-collector';
import { DependencyCollector } from './collectors/dependency-collector';
import { MetricAggregator } from './utils/metric-aggregator';
import { QualityReportDto } from './dto/quality-report.dto';

@Injectable()
export class QualityMetricsService {
  private readonly logger = new Logger(QualityMetricsService.name);
  private cachedReport: QualityReportDto | null = null;

  constructor(
    private readonly coverageCollector: CoverageCollector,
    private readonly complexityCollector: ComplexityCollector,
    private readonly vulnerabilityCollector: VulnerabilityCollector,
    private readonly dependencyCollector: DependencyCollector,
    private readonly aggregator: MetricAggregator,
  ) {}

  async collectAll(): Promise<QualityReportDto> {
    this.logger.log('Collecting code quality metrics...');

    const [coverage, complexity, vulnerabilities, dependencies] = await Promise.all([
      this.coverageCollector.collect(),
      this.complexityCollector.collect(),
      this.vulnerabilityCollector.collect(),
      this.dependencyCollector.collect(),
    ]);

    const partial = { coverage, complexity, vulnerabilities, dependencies };
    const report: QualityReportDto = {
      ...partial,
      score: this.aggregator.computeScore(partial),
      generatedAt: new Date(),
    };

    this.cachedReport = report;
    this.logger.log(`Quality metrics collected. Score: ${report.score}/100`);
    return report;
  }

  getLatestReport(): QualityReportDto | null {
    return this.cachedReport;
  }
}
