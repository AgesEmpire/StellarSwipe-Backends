import {
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Between, In, Repository } from 'typeorm';

import { Signal } from '../../signals/entities/signal.entity';
import { Trade } from '../../trades/entities/trade.entity';
import { ProviderEarning } from '../../provider-rewards/provider-earning.entity';
import {
  AnalyticsResponseDto,
  PerformanceByAssetDto,
  RevenueChartDto,
  TopSignalDto,
} from './dto/analytics-response.dto';

@Injectable()
export class ProviderAnalyticsService {
  constructor(
    @InjectRepository(Signal)
    private readonly signalRepo: Repository<Signal>,
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    @InjectRepository(ProviderEarning)
    private readonly earningsRepo: Repository<ProviderEarning>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  async getAnalytics(
    providerId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<AnalyticsResponseDto> {
    const parsedRange = this.parseDateRange(startDate, endDate);
    const cacheKey = `providers:analytics:${providerId}:${parsedRange?.start.toISOString() ?? 'all'}:${parsedRange?.end.toISOString() ?? 'all'}`;

    const cached = await this.cacheManager.get<AnalyticsResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const signalWhere = parsedRange
      ? { providerId, createdAt: Between(parsedRange.start, parsedRange.end) }
      : { providerId };

    const earningWhere = parsedRange
      ? { providerId, createdAt: Between(parsedRange.start, parsedRange.end) }
      : { providerId };

    const signals = await this.signalRepo.find({
      where: signalWhere,
      order: { createdAt: 'DESC' },
    });

    if (!signals.length) {
      const empty = this.emptyResponse();
      await this.cacheManager.set(cacheKey, empty, 3600);
      return empty;
    }

    const signalIds = signals.map((s) => s.id);
    const tradeWhere = parsedRange
      ? { signalId: In(signalIds), createdAt: Between(parsedRange.start, parsedRange.end) }
      : { signalId: In(signalIds) };

    const [trades, earnings] = await Promise.all([
      this.tradeRepo.find({ where: tradeWhere }),
      this.earningsRepo.find({ where: earningWhere }),
    ]);

    const result: AnalyticsResponseDto = {
      overview: this.buildOverview(signals, trades, earnings),
      performanceByAsset: this.buildPerformanceByAsset(trades),
      revenueChart: this.buildRevenueChart(earnings),
      topSignals: this.getTopSignals(signals, trades),
    };

    await this.cacheManager.set(cacheKey, result, 3600);
    return result;
  }

  private parseDateRange(
    startDate?: string,
    endDate?: string,
  ): { start: Date; end: Date } | null {
    if (!startDate && !endDate) {
      return null;
    }

    if (!startDate || !endDate) {
      throw new BadRequestException('startDate and endDate must be provided together');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format. Use YYYY-MM-DD');
    }

    if (start > end) {
      throw new BadRequestException('startDate cannot be after endDate');
    }

    return { start, end };
  }

  private buildOverview(
    signals: Signal[],
    trades: Trade[],
    earnings: ProviderEarning[],
  ): AnalyticsResponseDto['overview'] {
    const uniqueCopiers = new Set(trades.map((trade) => trade.userId));
    const totalRevenue = earnings.reduce(
      (sum, earning) => sum + Number(earning.amount),
      0,
    );

    return {
      totalSignals: signals.length,
      totalCopiers: uniqueCopiers.size,
      totalRevenue: Number(totalRevenue.toFixed(8)),
      avgCopiesPerSignal: signals.length
        ? Number((trades.length / signals.length).toFixed(2))
        : 0,
    };
  }

  private buildPerformanceByAsset(trades: Trade[]): PerformanceByAssetDto[] {
    const assetMap: Record<string, { wins: number; total: number }> = {};

    for (const trade of trades) {
      const asset = `${trade.baseAsset}/${trade.counterAsset}`;
      if (!assetMap[asset]) {
        assetMap[asset] = { wins: 0, total: 0 };
      }

      if (trade.profitLoss != null) {
        assetMap[asset].total += 1;
        if (Number(trade.profitLoss) > 0) {
          assetMap[asset].wins += 1;
        }
      }
    }

    return Object.entries(assetMap).map(([asset, stats]) => ({
      asset,
      winRate: stats.total
        ? Number(((stats.wins / stats.total) * 100).toFixed(2))
        : 0,
    }));
  }

  private buildRevenueChart(earnings: ProviderEarning[]): RevenueChartDto[] {
    const dateMap: Record<string, number> = {};
    for (const earning of earnings) {
      const date = earning.createdAt.toISOString().split('T')[0];
      dateMap[date] = (dateMap[date] ?? 0) + Number(earning.amount);
    }

    return Object.entries(dateMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({
        date,
        amount: Number(amount.toFixed(8)),
      }));
  }

  private getTopSignals(signals: Signal[], trades: Trade[]): TopSignalDto[] {
    const signalCopierCount: Record<string, number> = {};
    for (const trade of trades) {
      signalCopierCount[trade.signalId] = (signalCopierCount[trade.signalId] ?? 0) + 1;
    }

    return [...signals]
      .sort((a, b) => {
        const countDiff = (signalCopierCount[b.id] ?? 0) - (signalCopierCount[a.id] ?? 0);
        if (countDiff !== 0) {
          return countDiff;
        }
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .slice(0, 5)
      .map((signal) => ({
        id: signal.id,
        assetPair: signal.getAssetPair(),
        copies: signalCopierCount[signal.id] ?? 0,
        createdAt: signal.createdAt.toISOString(),
      }));
  }

  private emptyResponse(): AnalyticsResponseDto {
    return {
      overview: {
        totalSignals: 0,
        totalCopiers: 0,
        totalRevenue: 0,
        avgCopiesPerSignal: 0,
      },
      performanceByAsset: [],
      revenueChart: [],
      topSignals: [],
    };
  }
}
