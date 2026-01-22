import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProviderStats } from '../entities/provider-stats.entity';
import { Signal, SignalStatus, SignalOutcome } from '../entities/signal.entity';
import { ProviderStatsQueryDto } from '../dto';

@Injectable()
export class ProviderStatsService {

  constructor(
    @InjectRepository(ProviderStats)
    private providerStatsRepository: Repository<ProviderStats>,
    @InjectRepository(Signal)
    private signalRepository: Repository<Signal>,
  ) {}

  async getOrCreateProviderStats(providerId: string): Promise<ProviderStats> {
    let stats = await this.providerStatsRepository.findOne({
      where: { providerId },
    });

    if (!stats) {
      stats = this.providerStatsRepository.create({
        providerId,
        reputationScore: '50',
      });
      stats = await this.providerStatsRepository.save(stats);
    }

    return stats;
  }

  async getProviderStats(providerId: string): Promise<ProviderStats> {
    const stats = await this.providerStatsRepository.findOne({
      where: { providerId },
    });

    if (!stats) {
      throw new NotFoundException('Provider stats not found');
    }

    return stats;
  }

  async listProviderStats(query: ProviderStatsQueryDto): Promise<{
    data: ProviderStats[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'reputationScore';
    const order = query.order ?? 'DESC';

    const sortField = this.mapSortField(sortBy);

    const [data, total] = await this.providerStatsRepository.findAndCount({
      order: { [sortField]: order },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  private mapSortField(sortBy: string): string {
    const fieldMap: Record<string, string> = {
      winRate: 'winRate',
      totalPnl: 'totalPnl',
      reputationScore: 'reputationScore',
      totalSignals: 'totalSignals',
    };
    return fieldMap[sortBy] || 'reputationScore';
  }

  async onSignalCreated(providerId: string): Promise<void> {
    const stats = await this.getOrCreateProviderStats(providerId);

    stats.totalSignals += 1;
    stats.activeSignals += 1;
    stats.lastSignalAt = new Date();

    await this.providerStatsRepository.save(stats);
  }

  async onSignalClosed(
    providerId: string,
    outcome: SignalOutcome,
    pnlPercentage: string,
    holdTimeSeconds: number,
    copiersCount: number,
    volumeCopied: string,
  ): Promise<void> {
    const stats = await this.getOrCreateProviderStats(providerId);

    stats.activeSignals = Math.max(0, stats.activeSignals - 1);
    stats.closedSignals += 1;

    const pnl = parseFloat(pnlPercentage);

    if (outcome === SignalOutcome.TARGET_HIT) {
      stats.successfulSignals += 1;
      stats.streakWins += 1;
      stats.streakLosses = 0;
    } else if (outcome === SignalOutcome.STOP_LOSS_HIT) {
      stats.failedSignals += 1;
      stats.streakLosses += 1;
      stats.streakWins = 0;
    } else if (outcome === SignalOutcome.EXPIRED) {
      stats.expiredSignals += 1;
      if (pnl > 0) {
        stats.successfulSignals += 1;
      } else {
        stats.failedSignals += 1;
      }
      stats.streakWins = 0;
      stats.streakLosses = 0;
    }

    stats.totalPnl = (parseFloat(stats.totalPnl) + pnl).toFixed(8);

    if (pnl > parseFloat(stats.bestSignalPnl)) {
      stats.bestSignalPnl = pnlPercentage;
    }
    if (pnl < parseFloat(stats.worstSignalPnl)) {
      stats.worstSignalPnl = pnlPercentage;
    }

    if (pnl < parseFloat(stats.maxDrawdown)) {
      stats.maxDrawdown = pnlPercentage;
    }

    if (stats.closedSignals > 0) {
      stats.averagePnl = (
        parseFloat(stats.totalPnl) / stats.closedSignals
      ).toFixed(4);

      const successRate =
        (stats.successfulSignals / stats.closedSignals) * 100;
      stats.winRate = successRate.toFixed(2);

      const currentTotalHoldTime =
        stats.averageHoldTimeSeconds * (stats.closedSignals - 1);
      stats.averageHoldTimeSeconds = Math.floor(
        (currentTotalHoldTime + holdTimeSeconds) / stats.closedSignals,
      );
    }

    stats.totalCopiers += copiersCount;
    stats.totalVolumeCopied = (
      parseFloat(stats.totalVolumeCopied) + parseFloat(volumeCopied)
    ).toFixed(8);

    stats.reputationScore = this.calculateReputationScore(stats);

    await this.providerStatsRepository.save(stats);
  }

  private calculateReputationScore(stats: ProviderStats): string {
    let score = 50;

    const winRate = parseFloat(stats.winRate);
    score += (winRate - 50) * 0.3;

    const avgPnl = parseFloat(stats.averagePnl);
    score += Math.min(avgPnl * 2, 20);

    const consistency = Math.min(stats.closedSignals / 10, 1) * 10;
    score += consistency;

    score += Math.min(stats.streakWins * 2, 10);

    score -= Math.min(stats.streakLosses * 3, 15);

    const maxDrawdown = parseFloat(stats.maxDrawdown);
    if (maxDrawdown < -20) {
      score -= 10;
    } else if (maxDrawdown < -10) {
      score -= 5;
    }

    if (stats.totalCopiers > 100) {
      score += 5;
    } else if (stats.totalCopiers > 50) {
      score += 3;
    } else if (stats.totalCopiers > 10) {
      score += 1;
    }

    score = Math.max(0, Math.min(100, score));

    return score.toFixed(2);
  }

  async recalculateAllStats(providerId: string): Promise<ProviderStats> {
    const signals = await this.signalRepository.find({
      where: { providerId },
    });

    const stats = await this.getOrCreateProviderStats(providerId);

    stats.totalSignals = signals.length;
    stats.activeSignals = signals.filter(
      (s) => s.status === SignalStatus.ACTIVE,
    ).length;
    stats.closedSignals = signals.filter(
      (s) => s.status === SignalStatus.CLOSED,
    ).length;

    const closedSignals = signals.filter((s) => s.status === SignalStatus.CLOSED);

    stats.successfulSignals = closedSignals.filter(
      (s) => s.outcome === SignalOutcome.TARGET_HIT,
    ).length;
    stats.failedSignals = closedSignals.filter(
      (s) => s.outcome === SignalOutcome.STOP_LOSS_HIT,
    ).length;
    stats.expiredSignals = closedSignals.filter(
      (s) => s.outcome === SignalOutcome.EXPIRED,
    ).length;

    let totalPnl = 0;
    let bestPnl = 0;
    let worstPnl = 0;
    let totalHoldTime = 0;
    let totalCopiers = 0;
    let totalVolume = 0;

    for (const signal of closedSignals) {
      if (signal.closePrice && signal.entryPrice) {
        const pnl =
          ((parseFloat(signal.closePrice) - parseFloat(signal.entryPrice)) /
            parseFloat(signal.entryPrice)) *
          100;
        totalPnl += pnl;
        if (pnl > bestPnl) bestPnl = pnl;
        if (pnl < worstPnl) worstPnl = pnl;
      }

      if (signal.closedAt) {
        const holdTime = Math.floor(
          (signal.closedAt.getTime() - signal.createdAt.getTime()) / 1000,
        );
        totalHoldTime += holdTime;
      }

      totalCopiers += signal.copiersCount;
      totalVolume += parseFloat(signal.totalCopiedVolume);
    }

    stats.totalPnl = totalPnl.toFixed(8);
    stats.bestSignalPnl = bestPnl.toFixed(4);
    stats.worstSignalPnl = worstPnl.toFixed(4);
    stats.maxDrawdown = worstPnl.toFixed(4);

    if (closedSignals.length > 0) {
      stats.averagePnl = (totalPnl / closedSignals.length).toFixed(4);
      stats.winRate = (
        (stats.successfulSignals / closedSignals.length) *
        100
      ).toFixed(2);
      stats.averageHoldTimeSeconds = Math.floor(
        totalHoldTime / closedSignals.length,
      );
    }

    stats.totalCopiers = totalCopiers;
    stats.totalVolumeCopied = totalVolume.toFixed(8);

    stats.reputationScore = this.calculateReputationScore(stats);

    const lastSignal = signals.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
    if (lastSignal) {
      stats.lastSignalAt = lastSignal.createdAt;
    }

    return this.providerStatsRepository.save(stats);
  }

  async getLeaderboard(limit: number = 10): Promise<ProviderStats[]> {
    return this.providerStatsRepository.find({
      where: {},
      order: { reputationScore: 'DESC' },
      take: limit,
    });
  }

  async getTopPerformers(
    metric: 'winRate' | 'averagePnl' | 'totalPnl',
    limit: number = 10,
  ): Promise<ProviderStats[]> {
    return this.providerStatsRepository.find({
      order: { [metric]: 'DESC' },
      take: limit,
    });
  }
}
