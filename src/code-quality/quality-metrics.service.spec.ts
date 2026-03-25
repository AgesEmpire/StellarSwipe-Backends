import { Test, TestingModule } from '@nestjs/testing';
import { QualityMetricsService } from './quality-metrics.service';
import { CoverageCollector } from './collectors/coverage-collector';
import { ComplexityCollector } from './collectors/complexity-collector';
import { VulnerabilityCollector } from './collectors/vulnerability-collector';
import { DependencyCollector } from './collectors/dependency-collector';
import { MetricAggregator } from './utils/metric-aggregator';

const mockCoverage = { lines: 80, statements: 78, functions: 75, branches: 70, uncoveredFiles: [], collectedAt: new Date() };
const mockComplexity = { averageCyclomaticComplexity: 3, maxCyclomaticComplexity: 12, highComplexityFiles: [], technicalDebtMinutes: 60, collectedAt: new Date() };
const mockVulns = [{ id: 'CVE-001', severity: 'high' as const, package: 'lodash', description: 'Prototype pollution', fixAvailable: true }];
const mockDeps = { total: 50, outdated: 5, vulnerable: 1, collectedAt: new Date() };

describe('QualityMetricsService', () => {
  let service: QualityMetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualityMetricsService,
        MetricAggregator,
        { provide: CoverageCollector, useValue: { collect: jest.fn().mockResolvedValue(mockCoverage) } },
        { provide: ComplexityCollector, useValue: { collect: jest.fn().mockResolvedValue(mockComplexity) } },
        { provide: VulnerabilityCollector, useValue: { collect: jest.fn().mockResolvedValue(mockVulns) } },
        { provide: DependencyCollector, useValue: { collect: jest.fn().mockResolvedValue(mockDeps) } },
      ],
    }).compile();

    service = module.get<QualityMetricsService>(QualityMetricsService);
  });

  it('should return null before any collection', () => {
    expect(service.getLatestReport()).toBeNull();
  });

  it('should collect all metrics and return a report with a score', async () => {
    const report = await service.collectAll();

    expect(report.coverage).toEqual(mockCoverage);
    expect(report.complexity).toEqual(mockComplexity);
    expect(report.vulnerabilities).toEqual(mockVulns);
    expect(report.dependencies).toEqual(mockDeps);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    expect(report.generatedAt).toBeInstanceOf(Date);
  });

  it('should cache the latest report', async () => {
    await service.collectAll();
    expect(service.getLatestReport()).not.toBeNull();
  });

  it('should compute a lower score when vulnerabilities are present', async () => {
    const reportWithVulns = await service.collectAll();
    expect(reportWithVulns.score).toBeLessThan(100);
  });
});
