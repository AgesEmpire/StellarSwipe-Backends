import { Injectable } from '@nestjs/common';
import { QualityReportDto } from '../dto/quality-report.dto';
import { CoverageStatsDto } from '../dto/coverage-stats.dto';
import { ComplexityMetricsDto } from '../dto/complexity-metrics.dto';

@Injectable()
export class MetricAggregator {
  computeScore(report: Omit<QualityReportDto, 'score' | 'generatedAt'>): number {
    const coverageScore = this.coverageScore(report.coverage);
    const complexityScore = this.complexityScore(report.complexity);
    const vulnScore = this.vulnerabilityScore(report.vulnerabilities.length);
    const depScore = this.dependencyScore(report.dependencies.outdated, report.dependencies.total);

    return Math.round(coverageScore * 0.35 + complexityScore * 0.30 + vulnScore * 0.25 + depScore * 0.10);
  }

  private coverageScore(c: CoverageStatsDto): number {
    return (c.lines + c.statements + c.functions + c.branches) / 4;
  }

  private complexityScore(c: ComplexityMetricsDto): number {
    const avgScore = Math.max(0, 100 - (c.averageCyclomaticComplexity - 1) * 10);
    const debtScore = Math.max(0, 100 - c.technicalDebtMinutes / 60);
    return (avgScore + debtScore) / 2;
  }

  private vulnerabilityScore(count: number): number {
    return Math.max(0, 100 - count * 10);
  }

  private dependencyScore(outdated: number, total: number): number {
    if (total === 0) return 100;
    return Math.max(0, 100 - (outdated / total) * 100);
  }
}
