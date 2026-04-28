import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { ProviderBenchmark } from './entities/benchmark.entity';
import { PeerGroup } from './entities/peer-group.entity';
import {
  BenchmarkMetric,
  BenchmarkType,
  MetricCategory,
  PerformanceTier,
  PlatformStats,
} from './interfaces/benchmark-metric.interface';
import {
  GetBenchmarkReportDto,
  BenchmarkReportDto,
  BenchmarkHistoryQueryDto,
  BenchmarkHistoryDto,
} from './dto/benchmark-report.dto';
import {
  PeerComparisonQueryDto,
  PeerComparisonReportDto,
  PeerProviderSummaryDto,
} from './dto/peer-comparison.dto';
import {
  PercentileRankQueryDto,
  PercentileRankReportDto,
  MetricPercentileDto,
} from './dto/percentile-rank.dto';
import { PercentileCalculator } from './utils/percentile-calculator';

// Metric weights must sum to 1.0
const METRIC_WEIGHTS: Record<string, number> = {
  total_return: 0.25,
  sharpe_ratio: 0.2,
  max_drawdown: 0.15,
  win_rate: 0.15,
  volatility: 0.1,
  sortino_ratio: 0.1,
  calmar_ratio: 0.05,
};

@Injectable()
export class BenchmarkService {
  private readonly logger = new Logger(BenchmarkService.name);

  constructor(
    @InjectRepository(ProviderBenchmark)
    private readonly benchmarkRepository: Repository<ProviderBenchmark>,
    @InjectRepository(PeerGroup)
    private readonly peerGroupRepository: Repository<PeerGroup>,
  ) {}

  /**
   * Generate or retrieve a benchmark report for a provider.
   */
  async getBenchmarkReport(
    dto: GetBenchmarkReportDto,
  ): Promise<BenchmarkReportDto> {
    const entity = await this.benchmarkRepository.findOne({
      where: {
        providerId: dto.providerId,
        benchmarkType: dto.benchmarkType ?? BenchmarkType.PLATFORM,
        ...(dto.referenceId ? { referenceId: dto.referenceId } : {}),
      },
      order: { calculatedAt: 'DESC' },
    });

    if (!entity) {
      throw new NotFoundException(
        `No benchmark found for provider ${dto.providerId}`,
      );
    }

    return this.toReportDto(entity);
  }

  /**
   * Retrieve the benchmark history for a provider over time.
   */
  async getBenchmarkHistory(
    dto: BenchmarkHistoryQueryDto,
  ): Promise<BenchmarkHistoryDto> {
    const qb = this.benchmarkRepository
      .createQueryBuilder('bm')
      .where('bm.provider_id = :providerId', { providerId: dto.providerId });

    if (dto.benchmarkType) {
      qb.andWhere('bm.benchmark_type = :type', { type: dto.benchmarkType });
    }
    if (dto.after) {
      qb.andWhere('bm.period_start >= :after', { after: dto.after });
    }
    if (dto.before) {
      qb.andWhere('bm.period_end <= :before', { before: dto.before });
    }

    const entities = await qb.orderBy('bm.period_start', 'ASC').getMany();

    return {
      providerId: dto.providerId,
      entries: entities.map((e) => ({
        periodStart: e.periodStart,
        periodEnd: e.periodEnd,
        overallScore: Number(e.overallScore),
        overallPercentile: Number(e.overallPercentile),
        overallTier: e.overallTier,
        benchmarkType: e.benchmarkType,
        calculatedAt: e.calculatedAt,
      })),
    };
  }

  /**
   * Build a peer comparison report against either a named peer group or explicit peer IDs.
   */
  async getPeerComparison(
    dto: PeerComparisonQueryDto,
  ): Promise<PeerComparisonReportDto> {
    const subjectEntity = await this.benchmarkRepository.findOne({
      where: {
        providerId: dto.providerId,
        benchmarkType: BenchmarkType.PLATFORM,
      },
      order: { calculatedAt: 'DESC' },
    });

    if (!subjectEntity) {
      throw new NotFoundException(
        `No benchmark found for provider ${dto.providerId}`,
      );
    }

    let peerIds: string[] = dto.peerProviderIds ?? [];
    let peerGroupKey: string | null = dto.peerGroupKey ?? null;

    if (dto.peerGroupKey) {
      const peerGroup = await this.peerGroupRepository.findOne({
        where: { groupKey: dto.peerGroupKey, isActive: true },
      });
      if (peerGroup) {
        peerIds = peerGroup.providerIds.filter((id) => id !== dto.providerId);
      }
    }

    if (peerIds.length === 0) {
      throw new NotFoundException('No peers found for comparison.');
    }

    const peerEntities = await this.benchmarkRepository
      .createQueryBuilder('bm')
      .where('bm.provider_id IN (:...peerIds)', { peerIds })
      .andWhere('bm.benchmark_type = :type', { type: BenchmarkType.PLATFORM })
      .orderBy('bm.calculated_at', 'DESC')
      .distinctOn(['bm.provider_id'])
      .getMany();

    const allEntities = [subjectEntity, ...peerEntities];
    const allScores = allEntities
      .map((e) => Number(e.overallScore))
      .sort((a, b) => a - b);

    const subjectScore = Number(subjectEntity.overallScore);
    const subjectPercentile = PercentileCalculator.computePercentileRank(
      subjectScore,
      allScores,
    );
    const subjectTier =
      PercentileCalculator.toPerformanceTier(subjectPercentile);

    const ranked = [...allEntities].sort(
      (a, b) => Number(b.overallScore) - Number(a.overallScore),
    );
    const subjectRank =
      ranked.findIndex((e) => e.providerId === dto.providerId) + 1;

    const metricComparisons = this.buildMetricComparisons(
      subjectEntity,
      peerEntities,
    );

    const topPeers: PeerProviderSummaryDto[] = ranked
      .filter((e) => e.providerId !== dto.providerId)
      .slice(0, 3)
      .map((e, i) => ({
        providerId: e.providerId,
        overallScore: Number(e.overallScore),
        overallPercentile: Number(e.overallPercentile),
        overallTier: e.overallTier,
        rankInGroup: i + 1,
      }));

    const bottomPeers: PeerProviderSummaryDto[] = ranked
      .filter((e) => e.providerId !== dto.providerId)
      .slice(-3)
      .reverse()
      .map((e, i) => ({
        providerId: e.providerId,
        overallScore: Number(e.overallScore),
        overallPercentile: Number(e.overallPercentile),
        overallTier: e.overallTier,
        rankInGroup: ranked.length - i,
      }));

    return {
      providerId: dto.providerId,
      peerGroupKey,
      peerGroupSize: peerEntities.length,
      subjectRank,
      subjectScore,
      subjectPercentile,
      subjectTier,
      metricComparisons,
      topPeers,
      bottomPeers,
      generatedAt: new Date(),
    };
  }

  /**
   * Compute the percentile rank of each metric for a given provider.
   */
  async getPercentileRanks(
    dto: PercentileRankQueryDto,
  ): Promise<PercentileRankReportDto> {
    const subjectEntity = await this.benchmarkRepository.findOne({
      where: {
        providerId: dto.providerId,
        benchmarkType: BenchmarkType.PLATFORM,
      },
      order: { calculatedAt: 'DESC' },
    });

    if (!subjectEntity) {
      throw new NotFoundException(
        `No benchmark found for provider ${dto.providerId}`,
      );
    }

    // Gather all providers' latest platform benchmarks for distribution
    const allEntities = await this.benchmarkRepository
      .createQueryBuilder('bm')
      .where('bm.benchmark_type = :type', { type: BenchmarkType.PLATFORM })
      .orderBy('bm.calculated_at', 'DESC')
      .distinctOn(['bm.provider_id'])
      .getMany();

    const subjectMetrics = subjectEntity.metrics as BenchmarkMetric[];
    const filteredMetrics = dto.category
      ? subjectMetrics.filter((m) => m.category === dto.category)
      : subjectMetrics;

    const metricRankings: MetricPercentileDto[] = filteredMetrics.map(
      (metric) => {
        const platformValues = allEntities.flatMap((e) => {
          const m = (e.metrics as BenchmarkMetric[]).find(
            (x) => x.name === metric.name,
          );
          return m ? [m.providerValue] : [];
        });

        const sorted = [...platformValues].sort((a, b) => a - b);
        const stats = PercentileCalculator.computePlatformStats(
          metric.name,
          platformValues,
        );
        const percentileRank = PercentileCalculator.computePercentileRank(
          metric.providerValue,
          sorted,
        );
        const performanceTier =
          PercentileCalculator.toPerformanceTier(percentileRank);

        return {
          metricName: metric.name,
          category: metric.category,
          providerValue: metric.providerValue,
          percentileRank,
          performanceTier,
          platformMean: stats.mean,
          platformMedian: stats.median,
          platformStdDev: stats.stdDev,
        };
      },
    );

    const sortedByRank = [...metricRankings].sort(
      (a, b) => b.percentileRank - a.percentileRank,
    );

    return {
      providerId: dto.providerId,
      overallPercentile: Number(subjectEntity.overallPercentile),
      overallTier: subjectEntity.overallTier,
      metricRankings,
      strongestMetrics: sortedByRank.slice(0, 3),
      weakestMetrics: sortedByRank.slice(-3).reverse(),
      generatedAt: new Date(),
    };
  }

  /**
   * Calculate and persist benchmarks for all active providers.
   * Intended to be called by the scheduled job.
   */
  async calculateAndStoreBenchmarks(
    providerMetrics: Array<{
      providerId: string;
      metrics: Record<string, number>;
    }>,
  ): Promise<{ processed: number; errors: number }> {
    this.logger.log(
      `Calculating benchmarks for ${providerMetrics.length} providers`,
    );

    // Compute platform-wide stats per metric
    const metricNames = Object.keys(METRIC_WEIGHTS);
    const platformStats: Record<string, PlatformStats> = {};

    for (const metricName of metricNames) {
      const values = providerMetrics
        .map((p) => p.metrics[metricName])
        .filter((v) => v !== undefined && isFinite(v));
      platformStats[metricName] = PercentileCalculator.computePlatformStats(
        metricName,
        values,
      );
    }

    const sortedByMetric: Record<string, number[]> = {};
    for (const metricName of metricNames) {
      sortedByMetric[metricName] = providerMetrics
        .map((p) => p.metrics[metricName] ?? 0)
        .sort((a, b) => a - b);
    }

    let processed = 0;
    let errors = 0;
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

    for (const provider of providerMetrics) {
      try {
        const metrics: BenchmarkMetric[] = metricNames
          .filter((name) => provider.metrics[name] !== undefined)
          .map((name) => {
            const providerValue = provider.metrics[name];
            const benchmarkValue = platformStats[name].median;
            const delta = providerValue - benchmarkValue;
            const deltaPercent =
              benchmarkValue !== 0
                ? (delta / Math.abs(benchmarkValue)) * 100
                : 0;
            const percentileRank = PercentileCalculator.computePercentileRank(
              providerValue,
              sortedByMetric[name],
            );
            const performanceTier =
              PercentileCalculator.toPerformanceTier(percentileRank);

            return {
              name,
              category: this.resolveCategory(name),
              providerValue,
              benchmarkValue,
              delta: Math.round(delta * 10000) / 10000,
              deltaPercent: Math.round(deltaPercent * 100) / 100,
              percentileRank,
              performanceTier,
              weight: METRIC_WEIGHTS[name] ?? 0,
            };
          });

        const overallScore = PercentileCalculator.computeWeightedScore(
          metrics.map((m) => ({
            percentileRank: m.percentileRank,
            weight: m.weight,
          })),
        );
        const overallPercentile = PercentileCalculator.computePercentileRank(
          overallScore,
          providerMetrics
            .map((p) =>
              PercentileCalculator.computeWeightedScore(
                metricNames
                  .filter((n) => p.metrics[n] !== undefined)
                  .map((n) => ({
                    percentileRank: PercentileCalculator.computePercentileRank(
                      p.metrics[n],
                      sortedByMetric[n],
                    ),
                    weight: METRIC_WEIGHTS[n] ?? 0,
                  })),
              ),
            )
            .sort((a, b) => a - b),
        );
        const overallTier =
          PercentileCalculator.toPerformanceTier(overallPercentile);

        const entity = this.benchmarkRepository.create({
          providerId: provider.providerId,
          benchmarkType: BenchmarkType.PLATFORM,
          referenceId: null,
          periodStart,
          periodEnd: now,
          overallScore,
          overallPercentile,
          overallTier,
          metrics,
          platformStats,
          sampleSize: providerMetrics.length,
          calculatedAt: now,
        });

        await this.benchmarkRepository.save(entity);
        processed++;
      } catch (err) {
        this.logger.error(
          `Failed to calculate benchmark for provider ${provider.providerId}`,
          (err as Error).stack,
        );
        errors++;
      }
    }

    this.logger.log(
      `Benchmark calculation done. Processed: ${processed}, Errors: ${errors}`,
    );
    return { processed, errors };
  }

  // -------------------------
  // Private helpers
  // -------------------------

  private buildMetricComparisons(
    subject: ProviderBenchmark,
    peers: ProviderBenchmark[],
  ) {
    const subjectMetrics = subject.metrics as BenchmarkMetric[];

    return subjectMetrics.map((sm) => {
      const peerValues = peers
        .flatMap((p) => {
          const pm = (p.metrics as BenchmarkMetric[]).find(
            (m) => m.name === sm.name,
          );
          return pm ? [pm.providerValue] : [];
        })
        .sort((a, b) => a - b);

      const stats = PercentileCalculator.computePlatformStats(
        sm.name,
        peerValues,
      );
      const subjectPercentileInPeer =
        PercentileCalculator.computePercentileRank(
          sm.providerValue,
          peerValues,
        );

      return {
        metricName: sm.name,
        subjectValue: sm.providerValue,
        peerMedian: stats.median,
        peerP25: stats.p25,
        peerP75: stats.p75,
        subjectPercentileInPeer,
      };
    });
  }

  private toReportDto(entity: ProviderBenchmark): BenchmarkReportDto {
    const metrics = entity.metrics as BenchmarkMetric[];
    const insights = this.generateInsights(
      metrics,
      Number(entity.overallPercentile),
    );

    return {
      providerId: entity.providerId,
      benchmarkType: entity.benchmarkType,
      referenceId: entity.referenceId,
      periodStart: entity.periodStart,
      periodEnd: entity.periodEnd,
      overallScore: Number(entity.overallScore),
      overallPercentile: Number(entity.overallPercentile),
      overallTier: entity.overallTier,
      metrics,
      platformStats: entity.platformStats
        ? (Object.values(entity.platformStats) as PlatformStats[])
        : null,
      sampleSize: entity.sampleSize,
      calculatedAt: entity.calculatedAt,
      insights,
    };
  }

  private generateInsights(
    metrics: BenchmarkMetric[],
    overallPercentile: number,
  ): string[] {
    const insights: string[] = [];

    insights.push(
      `Overall platform percentile: ${overallPercentile.toFixed(1)}th — ${PercentileCalculator.toPerformanceTier(overallPercentile)} tier.`,
    );

    const strongest = [...metrics].sort(
      (a, b) => b.percentileRank - a.percentileRank,
    )[0];
    if (strongest) {
      insights.push(
        `Strongest metric: ${strongest.name} at the ${strongest.percentileRank.toFixed(0)}th percentile (${strongest.deltaPercent >= 0 ? '+' : ''}${strongest.deltaPercent.toFixed(1)}% vs platform median).`,
      );
    }

    const weakest = [...metrics].sort(
      (a, b) => a.percentileRank - b.percentileRank,
    )[0];
    if (weakest && weakest.name !== strongest?.name) {
      insights.push(
        `Area for improvement: ${weakest.name} at the ${weakest.percentileRank.toFixed(0)}th percentile.`,
      );
    }

    const abovePlatform = metrics.filter((m) => m.delta > 0).length;
    insights.push(
      `${abovePlatform} of ${metrics.length} metrics are above the platform median.`,
    );

    return insights;
  }

  private resolveCategory(metricName: string): MetricCategory {
    const map: Record<string, MetricCategory> = {
      total_return: MetricCategory.RETURN,
      sharpe_ratio: MetricCategory.EFFICIENCY,
      max_drawdown: MetricCategory.RISK,
      win_rate: MetricCategory.CONSISTENCY,
      volatility: MetricCategory.RISK,
      sortino_ratio: MetricCategory.EFFICIENCY,
      calmar_ratio: MetricCategory.EFFICIENCY,
    };
    return map[metricName] ?? MetricCategory.RETURN;
  }
}
