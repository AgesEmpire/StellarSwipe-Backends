import { CoverageStatsDto } from './coverage-stats.dto';
import { ComplexityMetricsDto } from './complexity-metrics.dto';

export class VulnerabilityDto {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  package: string;
  description: string;
  fixAvailable: boolean;
}

export class DependencyStatsDto {
  total: number;
  outdated: number;
  vulnerable: number;
  collectedAt: Date;
}

export class QualityReportDto {
  coverage: CoverageStatsDto;
  complexity: ComplexityMetricsDto;
  vulnerabilities: VulnerabilityDto[];
  dependencies: DependencyStatsDto;
  score: number;
  generatedAt: Date;
}
