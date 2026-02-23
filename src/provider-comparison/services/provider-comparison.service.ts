import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  CompareProvidersDto,
  ComparisonMetric,
  ComparisonTimeframe,
} from '../dto/compare-providers.dto';
import {
  ComparisonResultDto,
  ProviderComparisonData,
  MetricComparison,
} from '../dto/comparison-result.dto';

// Placeholder entities - adjust imports based on your actual entities
interface Provider {
  id: string;
  name: string;
  totalSignals?: number;
  followers?: number;
}

interface Signal {
  providerId: string;
  outcome: 'win' | 'loss';
  pnl: number;
  createdAt: Date;
}

@Injectable()
export class ProviderComparisonService {
  constructor(
    @InjectRepository('Provider')
    private readonly providerRepository: Repository<Provider>,
    @InjectRepository('Signal')
    private readonly signalRepository: Repository<Signal>,
  ) {}

  async compareProviders(
    dto: CompareProvidersDto,
  ): Promise<ComparisonResultDto> {
    const { providerIds, metrics, timeframe } = dto;

    // Fetch providers
    const providers = await this.providerRepository.find({
      where: { id: In(providerIds) },
    });

    if (providers.length !== providerIds.length) {
      throw new NotFoundException('One or more providers not found');
    }

    // Calculate date range
    const startDate = this.getStartDate(timeframe);

    // Fetch signals for all providers
    const signals = await this.fetchSignals(providerIds, startDate);

    // Calculate metrics for each provider
    const comparisons: ProviderComparisonData[] = [];
    const warnings: string[] = [];

    for (const provider of providers) {
      const providerSignals = signals.filter(
        (s) => s.providerId === provider.id,
      );

      const metricsData: any = {};

      for (const metric of metrics) {
        const value = this.calculateMetric(
          metric,
          provider,
          providerSignals,
        );
        metricsData[metric] = { value, rank: 0, percentile: 0 };
      }

      comparisons.push({
        id: provider.id,
        name: provider.name,
        metrics: metricsData,
        overallScore: 0,
        totalSignals: providerSignals.length,
      });

      // Check for edge cases
      if (providerSignals.length < 10) {
        warnings.push(
          `Provider ${provider.name} has limited data (${providerSignals.length} signals)`,
        );
      }
    }

    // Calculate rankings and percentiles
    this.calculateRankings(comparisons, metrics);

    // Calculate overall scores
    this.calculateOverallScores(comparisons, metrics);

    // Perform statistical significance tests
    this.performStatisticalTests(comparisons, signals);

    // Generate recommendation
    const recommendation = this.generateRecommendation(comparisons);

    return {
      providers: comparisons,
      recommendation,
      timeframe,
      comparedAt: new Date(),
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  private getStartDate(timeframe: ComparisonTimeframe): Date | null {
    const now = new Date();
    switch (timeframe) {
      case ComparisonTimeframe.THIRTY_DAYS:
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case ComparisonTimeframe.NINETY_DAYS:
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      case ComparisonTimeframe.ALL:
        return null;
    }
  }

  private async fetchSignals(
    providerIds: string[],
    startDate: Date | null,
  ): Promise<Signal[]> {
    const query = this.signalRepository
      .createQueryBuilder('signal')
      .where('signal.providerId IN (:...providerIds)', { providerIds });

    if (startDate) {
      query.andWhere('signal.createdAt >= :startDate', { startDate });
    }

    return query.getMany();
  }

  private calculateMetric(
    metric: ComparisonMetric,
    provider: Provider,
    signals: Signal[],
  ): number {
    switch (metric) {
      case ComparisonMetric.WIN_RATE:
        return this.calculateWinRate(signals);
      case ComparisonMetric.TOTAL_PNL:
        return this.calculateTotalPnL(signals);
      case ComparisonMetric.CONSISTENCY:
        return this.calculateConsistency(signals);
      case ComparisonMetric.FOLLOWERS:
        return provider.followers || 0;
      default:
        return 0;
    }
  }

  private calculateWinRate(signals: Signal[]): number {
    if (signals.length === 0) return 0;
    const wins = signals.filter((s) => s.outcome === 'win').length;
    return (wins / signals.length) * 100;
  }

  private calculateTotalPnL(signals: Signal[]): number {
    return signals.reduce((sum, s) => sum + (s.pnl || 0), 0);
  }

  private calculateConsistency(signals: Signal[]): number {
    if (signals.length < 2) return 0;

    const pnls = signals.map((s) => s.pnl || 0);
    const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    const variance =
      pnls.reduce((sum, pnl) => sum + Math.pow(pnl - mean, 2), 0) /
      pnls.length;
    const stdDev = Math.sqrt(variance);

    // Consistency score: higher mean with lower volatility is better
    // Normalize to 0-100 scale
    if (stdDev === 0) return mean > 0 ? 100 : 0;
    const sharpeRatio = mean / stdDev;
    return Math.max(0, Math.min(100, 50 + sharpeRatio * 10));
  }

  private calculateRankings(
    comparisons: ProviderComparisonData[],
    metrics: ComparisonMetric[],
  ): void {
    for (const metric of metrics) {
      // Sort by metric value (descending)
      const sorted = [...comparisons].sort(
        (a, b) => (b.metrics[metric]?.value || 0) - (a.metrics[metric]?.value || 0),
      );

      // Assign ranks and percentiles
      sorted.forEach((provider, index) => {
        const comparison = comparisons.find((c) => c.id === provider.id);
        if (comparison?.metrics[metric]) {
          comparison.metrics[metric].rank = index + 1;
          comparison.metrics[metric].percentile =
            ((sorted.length - index) / sorted.length) * 100;
        }
      });
    }
  }

  private calculateOverallScores(
    comparisons: ProviderComparisonData[],
    metrics: ComparisonMetric[],
  ): void {
    for (const comparison of comparisons) {
      let totalScore = 0;
      let metricCount = 0;

      for (const metric of metrics) {
        if (comparison.metrics[metric]) {
          // Use percentile as normalized score (0-100)
          totalScore += comparison.metrics[metric].percentile;
          metricCount++;
        }
      }

      comparison.overallScore =
        metricCount > 0 ? Math.round(totalScore / metricCount) : 0;
    }
  }

  private performStatisticalTests(
    comparisons: ProviderComparisonData[],
    allSignals: Signal[],
  ): void {
    // Simple statistical significance test based on sample size
    const MIN_SAMPLE_SIZE = 30;

    for (const comparison of comparisons) {
      const providerSignals = allSignals.filter(
        (s) => s.providerId === comparison.id,
      );

      for (const metricKey in comparison.metrics) {
        const metric = comparison.metrics[metricKey];
        if (metric) {
          metric.sampleSize = providerSignals.length;
          metric.isStatisticallySignificant =
            providerSignals.length >= MIN_SAMPLE_SIZE;
        }
      }
    }
  }

  private generateRecommendation(
    comparisons: ProviderComparisonData[],
  ): string {
    // Sort by overall score
    const sorted = [...comparisons].sort(
      (a, b) => b.overallScore - a.overallScore,
    );

    const best = sorted[0];
    const scoreDiff =
      sorted.length > 1 ? best.overallScore - sorted[1].overallScore : 0;

    if (scoreDiff > 20) {
      return `${best.name} shows significantly stronger performance with an overall score of ${best.overallScore}/100.`;
    } else if (scoreDiff > 10) {
      return `${best.name} leads with a score of ${best.overallScore}/100, though ${sorted[1]?.name} is competitive.`;
    } else if (sorted.length > 1) {
      return `${best.name} and ${sorted[1].name} show similar performance. Consider other factors like trading style and risk tolerance.`;
    }

    return `${best.name} is the top performer with a score of ${best.overallScore}/100.`;
  }
}
