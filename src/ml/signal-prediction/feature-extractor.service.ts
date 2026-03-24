import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { Signal, SignalOutcome } from '../../signals/entities/signal.entity';
import { ProviderStats } from '../../signals/entities/provider-stats.entity';
import { PriceOracleService } from '../../prices/price-oracle.service';
import { StatisticalAnalysisService } from '../../analytics/services/statistical-analysis.service';
import {
  IFeatureSet,
  featureSetToVector,
  ProviderFeatures,
  MarketFeatures,
  SignalFeatures,
} from './interfaces/feature-set.interface';
import { FeatureNormalizer } from './utils/feature-normalizer';

@Injectable()
export class FeatureExtractorService {
  private readonly logger = new Logger(FeatureExtractorService.name);

  constructor(
    @InjectRepository(Signal)
    private signalRepository: Repository<Signal>,
    @InjectRepository(ProviderStats)
    private providerStatsRepository: Repository<ProviderStats>,
    private priceOracleService: PriceOracleService,
    private statisticalAnalysisService: StatisticalAnalysisService,
  ) {}

  async extract(signal: Signal): Promise<IFeatureSet> {
    const [providerFeatures, marketFeatures, signalFeatures] = await Promise.all([
      this.extractProviderFeatures(signal),
      this.extractMarketFeatures(signal),
      this.extractSignalFeatures(signal),
    ]);

    return { provider: providerFeatures, market: marketFeatures, signal: signalFeatures };
  }

  async extractAndVectorize(signal: Signal): Promise<number[]> {
    const featureSet = await this.extract(signal);
    const raw = featureSetToVector(featureSet);
    return FeatureNormalizer.clip(raw);
  }

  // ── Provider features ────────────────────────────────────────────────────

  private async extractProviderFeatures(signal: Signal): Promise<ProviderFeatures> {
    const stats = await this.providerStatsRepository.findOne({
      where: { providerId: signal.providerId },
    });

    if (!stats) {
      return {
        winRate: 0.5,
        reputationScore: 0.5,
        consistency: 0.5,
        avgHoldTimeHours: 0.5,
        totalSignals: 0,
        recentWinRate: 0.5,
        streakScore: 0,
      };
    }

    const recentWinRate = await this.computeRecentWinRate(signal.providerId);

    return {
      winRate: Math.min(1, Math.max(0, Number(stats.winRate) / 100)),
      reputationScore: Math.min(1, Math.max(0, Number(stats.reputationScore) / 100)),
      consistency: this.computeConsistency(stats),
      avgHoldTimeHours: Math.min(1, stats.averageHoldTimeSeconds / (168 * 3600)), // Cap at 1 week
      totalSignals: Math.min(1, stats.totalSignals / 500),
      recentWinRate,
      streakScore: this.computeStreakScore(stats),
    };
  }

  private async computeRecentWinRate(providerId: string): Promise<number> {
    const recent = await this.signalRepository.find({
      where: [
        { providerId, outcome: SignalOutcome.TARGET_HIT },
        { providerId, outcome: SignalOutcome.STOP_LOSS_HIT },
      ],
      order: { createdAt: 'DESC' },
      take: 20,
    });

    if (recent.length === 0) return 0.5;
    const wins = recent.filter((s) => s.outcome === SignalOutcome.TARGET_HIT).length;
    return wins / recent.length;
  }

  private computeConsistency(stats: ProviderStats): number {
    if (stats.totalSignals < 5) return 0.5;
    const winRate = Number(stats.winRate) / 100;
    // Consistency penalizes extreme streak lengths
    const streakPenalty = Math.min(0.3, Math.abs(stats.streakWins - stats.streakLosses) / 20);
    return Math.max(0, Math.min(1, winRate - streakPenalty + 0.1));
  }

  private computeStreakScore(stats: ProviderStats): number {
    const maxStreak = 10;
    if (stats.streakWins > stats.streakLosses) {
      return Math.min(1, stats.streakWins / maxStreak);
    }
    return -Math.min(1, stats.streakLosses / maxStreak);
  }

  // ── Market features ──────────────────────────────────────────────────────

  private async extractMarketFeatures(signal: Signal): Promise<MarketFeatures> {
    const assetPair = `${signal.baseAsset}/${signal.counterAsset}`;

    try {
      const priceHistory = await this.priceOracleService.getPriceHistory(assetPair, 24);
      const prices = priceHistory.map((p) => Number(p.price));

      if (prices.length < 2) {
        return this.defaultMarketFeatures();
      }

      const stdDev = this.statisticalAnalysisService.calculateStandardDeviation(prices);
      const mean = prices.reduce((s, p) => s + p, 0) / prices.length;
      const normalizedVolatility = mean > 0 ? Math.min(1, stdDev / mean) : 0;

      return {
        assetVolatility: normalizedVolatility,
        marketTrend: this.computeTrend(prices),
        volumeRatio: 0.5, // Volume data not available in PriceOracle — default to neutral
        rsiScore: this.computeRSI(prices),
        priceDeviation: this.computePriceDeviation(prices, mean),
      };
    } catch (err) {
      this.logger.warn(`Could not fetch price history for ${assetPair}: ${err}`);
      return this.defaultMarketFeatures();
    }
  }

  private defaultMarketFeatures(): MarketFeatures {
    return { assetVolatility: 0.3, marketTrend: 0, volumeRatio: 0.5, rsiScore: 0.5, priceDeviation: 0 };
  }

  private computeTrend(prices: number[]): number {
    // Compare newest vs oldest price
    const newest = prices[0];
    const oldest = prices[prices.length - 1];
    if (oldest === 0) return 0;
    const change = (newest - oldest) / oldest;
    if (change > 0.02) return 1;
    if (change < -0.02) return -1;
    return change / 0.02; // -1 to 1 gradient in neutral zone
  }

  private computeRSI(prices: number[], period = 14): number {
    if (prices.length < period + 1) return 0.5;

    let gains = 0;
    let losses = 0;

    for (let i = 0; i < period; i++) {
      const diff = prices[i] - prices[i + 1];
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }

    if (losses === 0) return 1;
    const rs = gains / losses;
    const rsi = 1 - 1 / (1 + rs);
    return rsi; // Already 0-1
  }

  private computePriceDeviation(prices: number[], mean: number): number {
    if (mean === 0) return 0;
    const latestPrice = prices[0];
    return Math.min(1, Math.abs(latestPrice - mean) / mean);
  }

  // ── Signal features ──────────────────────────────────────────────────────

  private async extractSignalFeatures(signal: Signal): Promise<SignalFeatures> {
    const entryPrice = Number(signal.entryPrice);
    const targetPrice = Number(signal.targetPrice);
    const stopLossPrice = signal.stopLossPrice ? Number(signal.stopLossPrice) : null;

    const riskRewardRatio = this.computeRiskReward(entryPrice, targetPrice, stopLossPrice);
    const assetPairPopularity = await this.computeAssetPairPopularity(
      signal.baseAsset,
      signal.counterAsset,
    );

    return {
      confidenceScore: Math.min(1, Math.max(0, signal.confidenceScore / 100)),
      riskRewardRatio,
      timeOfDay: signal.createdAt.getUTCHours() / 24,
      dayOfWeek: signal.createdAt.getUTCDay() / 7,
      assetPairPopularity,
    };
  }

  private computeRiskReward(
    entry: number,
    target: number,
    stopLoss: number | null,
  ): number {
    if (!stopLoss || stopLoss === entry) return 0.5;
    const reward = Math.abs(target - entry);
    const risk = Math.abs(entry - stopLoss);
    if (risk === 0) return 1;
    const ratio = reward / risk;
    return Math.min(1, ratio / 5); // Cap at 5:1 = 1.0
  }

  private async computeAssetPairPopularity(base: string, counter: string): Promise<number> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const count = await this.signalRepository.count({
      where: {
        baseAsset: base,
        counterAsset: counter,
        createdAt: MoreThanOrEqual(thirtyDaysAgo),
      },
    });
    return Math.min(1, count / 100);
  }
}
