import { Injectable } from '@nestjs/common';
import { Signal } from '../signals/entities/signal.entity';
import { ProviderStats } from '../signals/entities/provider-stats.entity';

export interface RankingWeights {
  freshness: number;
  providerScore: number;
  riskVolume: number;
}

const DEFAULT_WEIGHTS: RankingWeights = {
  freshness: 0.4,
  providerScore: 0.4,
  riskVolume: 0.2,
};

const FRESHNESS_DECAY_HOURS = 24;

@Injectable()
export class FeedRankingService {
  /**
   * Calculates a 0–100 feed score for a signal.
   * Higher = more relevant for the feed.
   */
  score(
    signal: Signal,
    providerStats: ProviderStats | null,
    weights: RankingWeights = DEFAULT_WEIGHTS,
  ): number {
    const freshness = this.freshnessScore(signal.createdAt);
    const provider = this.providerScore(providerStats);
    const riskVolume = this.riskVolumeScore(signal, providerStats);

    return (
      freshness * weights.freshness +
      provider * weights.providerScore +
      riskVolume * weights.riskVolume
    );
  }

  /**
   * Sorts signals descending by feed score.
   */
  rank(
    signals: Signal[],
    statsMap: Map<string, ProviderStats>,
    weights?: RankingWeights,
  ): Array<Signal & { feedScore: number }> {
    return signals
      .map((s) => ({
        ...s,
        feedScore: this.score(s, statsMap.get(s.providerId) ?? null, weights),
      }))
      .sort((a, b) => b.feedScore - a.feedScore);
  }

  /** 0–100: decays exponentially over FRESHNESS_DECAY_HOURS */
  private freshnessScore(createdAt: Date): number {
    const ageHours = (Date.now() - createdAt.getTime()) / 3_600_000;
    return Math.max(0, 100 * Math.exp(-ageHours / FRESHNESS_DECAY_HOURS));
  }

  /** 0–100: based on win rate and reputation score */
  private providerScore(stats: ProviderStats | null): number {
    if (!stats) return 50;
    const winRate = parseFloat(stats.winRate) || 0;
    const reputation = parseFloat(stats.reputationScore) || 50;
    return winRate * 0.6 + reputation * 0.4;
  }

  /** 0–100: rewards high copier volume, penalises high drawdown */
  private riskVolumeScore(signal: Signal, stats: ProviderStats | null): number {
    const copiers = Math.min(signal.copiersCount / 100, 1) * 50;
    const drawdown = stats ? parseFloat(stats.maxDrawdown) || 0 : 0;
    const drawdownPenalty = Math.min(drawdown * 2, 50);
    return Math.max(0, 50 + copiers - drawdownPenalty);
  }
}
