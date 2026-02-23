import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import {
  LeaderboardPeriod,
  LeaderboardQueryDto,
} from './dto/leaderboard-query.dto';

export interface LeaderboardEntry {
  rank: number;
  provider: string;
  name: string | null;
  avatar: string | null;
  bio: string | null;
  winRate: number;
  totalPnL: number;
  signalCount: number;
  score: number;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  period: LeaderboardPeriod;
  cachedAt: string;
}

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);
  private readonly CACHE_TTL_SECONDS = 300; // 5 minutes
  private readonly CACHE_KEY_PREFIX = 'leaderboard';

  constructor(
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,

    // Inject whatever ORM entities exist in the project.
    // These are named generically — replace with actual entity names.
    @InjectRepository('Signal')
    private readonly signalRepository: Repository<any>,

    @InjectRepository('Provider')
    private readonly providerRepository: Repository<any>,
  ) {}

  async getLeaderboard(
    query: LeaderboardQueryDto,
  ): Promise<LeaderboardResponse> {
    const period = query.period ?? LeaderboardPeriod.ALL_TIME;
    const limit = query.limit ?? 100;

    const cacheKey = `${this.CACHE_KEY_PREFIX}:${period}:${limit}`;

    const cached = await this.cacheManager.get<LeaderboardResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const leaderboard = await this.computeLeaderboard(period, limit);

    const response: LeaderboardResponse = {
      leaderboard,
      period,
      cachedAt: new Date().toISOString(),
    };

    await this.cacheManager.set(
      cacheKey,
      response,
      this.CACHE_TTL_SECONDS * 1000,
    );

    return response;
  }

  private async computeLeaderboard(
    period: LeaderboardPeriod,
    limit: number,
  ): Promise<LeaderboardEntry[]> {
    const dateFilter = this.getDateFilter(period);

    // Raw aggregation query — adjust table/column names to match your schema
    const query = this.signalRepository
      .createQueryBuilder('signal')
      .select('signal.provider_address', 'provider')
      .addSelect('COUNT(signal.id)', 'signalCount')
      .addSelect(
        `SUM(CASE WHEN signal.outcome = 'win' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(signal.id), 0) * 100`,
        'winRate',
      )
      .addSelect('COALESCE(SUM(signal.pnl), 0)', 'totalPnL')
      .where('signal.status = :status', { status: 'closed' })
      .groupBy('signal.provider_address')
      .orderBy(
        `(SUM(CASE WHEN signal.outcome = 'win' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(signal.id), 0) * 100 * 0.5)
         + (COALESCE(SUM(signal.pnl), 0) * 0.3)
         + (COUNT(signal.id) * 0.2)`,
        'DESC',
      )
      .limit(limit);

    if (dateFilter) {
      query.andWhere('signal.created_at >= :from', { from: dateFilter });
    }

    const rows: Array<{
      provider: string;
      signalCount: string;
      winRate: string;
      totalPnL: string;
    }> = await query.getRawMany();

    // Fetch provider metadata in one query
    const addresses = rows.map((r) => r.provider);
    const providerMetaMap = await this.getProviderMetadata(addresses);

    return rows.map((row, index) => {
      const winRate = parseFloat(row.winRate) || 0;
      const totalPnL = parseFloat(row.totalPnL) || 0;
      const signalCount = parseInt(row.signalCount, 10) || 0;
      const score = this.computeScore(winRate, totalPnL, signalCount);
      const meta = providerMetaMap.get(row.provider);

      return {
        rank: index + 1,
        provider: row.provider,
        name: meta?.name ?? null,
        avatar: meta?.avatar ?? null,
        bio: meta?.bio ?? null,
        winRate: Math.round(winRate * 100) / 100,
        totalPnL: Math.round(totalPnL * 100) / 100,
        signalCount,
        score: Math.round(score * 100) / 100,
      };
    });
  }

  private computeScore(
    winRate: number,
    totalPnL: number,
    signalCount: number,
  ): number {
    return winRate * 0.5 + totalPnL * 0.3 + signalCount * 0.2;
  }

  private getDateFilter(period: LeaderboardPeriod): Date | null {
    const now = new Date();

    switch (period) {
      case LeaderboardPeriod.DAILY: {
        const from = new Date(now);
        from.setHours(0, 0, 0, 0);
        return from;
      }
      case LeaderboardPeriod.WEEKLY: {
        const from = new Date(now);
        from.setDate(from.getDate() - 7);
        from.setHours(0, 0, 0, 0);
        return from;
      }
      case LeaderboardPeriod.ALL_TIME:
      default:
        return null;
    }
  }

  private async getProviderMetadata(
    addresses: string[],
  ): Promise<Map<string, { name: string; avatar: string; bio: string }>> {
    if (!addresses.length) return new Map();

    const providers = await this.providerRepository
      .createQueryBuilder('provider')
      .select([
        'provider.address',
        'provider.name',
        'provider.avatar',
        'provider.bio',
      ])
      .where('provider.address IN (:...addresses)', { addresses })
      .getMany();

    return new Map(
      providers.map((p) => [
        p.address,
        { name: p.name, avatar: p.avatar, bio: p.bio },
      ]),
    );
  }

  // Runs every 10 minutes to pre-warm all period/limit combinations
  @Cron('*/10 * * * *')
  async refreshLeaderboardCache(): Promise<void> {
    this.logger.log('Refreshing leaderboard cache...');

    const periods = [
      LeaderboardPeriod.DAILY,
      LeaderboardPeriod.WEEKLY,
      LeaderboardPeriod.ALL_TIME,
    ];
    const defaultLimit = 100;

    for (const period of periods) {
      try {
        const leaderboard = await this.computeLeaderboard(period, defaultLimit);
        const response: LeaderboardResponse = {
          leaderboard,
          period,
          cachedAt: new Date().toISOString(),
        };

        const cacheKey = `${this.CACHE_KEY_PREFIX}:${period}:${defaultLimit}`;
        await this.cacheManager.set(
          cacheKey,
          response,
          this.CACHE_TTL_SECONDS * 1000,
        );

        this.logger.log(`Refreshed leaderboard cache for period: ${period}`);
      } catch (error) {
        this.logger.error(
          `Failed to refresh leaderboard cache for period ${period}`,
          error,
        );
      }
    }
  }
}
