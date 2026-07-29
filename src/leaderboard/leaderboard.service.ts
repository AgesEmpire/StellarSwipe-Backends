import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Cron } from '@nestjs/schedule';
import {
  LeaderboardPeriod,
  LeaderboardQueryDto,
} from './dto/leaderboard-query.dto';
import { LeaderboardRepository } from './leaderboard.repository';
import {
  LeaderboardResponse,
  ProviderLeaderboardEntry,
  UserLeaderboardEntry,
} from './leaderboard.types';

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);
  private readonly CACHE_TTL_SECONDS = 300; // 5 minutes
  private readonly CACHE_KEY_PREFIX = 'leaderboard';

  constructor(
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly leaderboardRepository: LeaderboardRepository,
  ) {}

  async getProviderLeaderboard(
    query: LeaderboardQueryDto,
  ): Promise<LeaderboardResponse<ProviderLeaderboardEntry>> {
    const period = query.period ?? LeaderboardPeriod.ALL_TIME;
    const limit = query.limit ?? 20;
    const page = query.page ?? 1;
    const minActivity = query.minActivity ?? 3;
    const cacheKey = `${this.CACHE_KEY_PREFIX}:providers:${period}:${limit}:${page}:${minActivity}`;

    const cached = await this.cacheManager.get<
      LeaderboardResponse<ProviderLeaderboardEntry>
    >(cacheKey);
    if (cached) {
      return cached;
    }

    const leaderboard = await this.leaderboardRepository.aggregateProviderLeaderboard(
      period,
      limit,
      page,
      minActivity,
    );

    const response: LeaderboardResponse<ProviderLeaderboardEntry> = {
      leaderboard,
      period,
      cachedAt: new Date().toISOString(),
      page,
      limit,
      total: leaderboard.length,
    };

    await this.cacheManager.set(
      cacheKey,
      response,
      this.CACHE_TTL_SECONDS * 1000,
    );

    return response;
  }

  async getUserLeaderboard(
    query: LeaderboardQueryDto,
  ): Promise<LeaderboardResponse<UserLeaderboardEntry>> {
    const period = query.period ?? LeaderboardPeriod.ALL_TIME;
    const limit = query.limit ?? 20;
    const page = query.page ?? 1;
    const minActivity = query.minActivity ?? 3;
    const cacheKey = `${this.CACHE_KEY_PREFIX}:users:${period}:${limit}:${page}:${minActivity}`;

    const cached = await this.cacheManager.get<
      LeaderboardResponse<UserLeaderboardEntry>
    >(cacheKey);
    if (cached) {
      return cached;
    }

    const leaderboard = await this.leaderboardRepository.aggregateUserLeaderboard(
      period,
      limit,
      page,
      minActivity,
    );

    const response: LeaderboardResponse<UserLeaderboardEntry> = {
      leaderboard,
      period,
      cachedAt: new Date().toISOString(),
      page,
      limit,
      total: leaderboard.length,
    };

    await this.cacheManager.set(
      cacheKey,
      response,
      this.CACHE_TTL_SECONDS * 1000,
    );

    return response;
  }

  @Cron('*/10 * * * *')
  async refreshLeaderboardCache(): Promise<void> {
    this.logger.log('Refreshing leaderboard cache...');

    const periods = [
      LeaderboardPeriod.DAILY,
      LeaderboardPeriod.WEEKLY,
      LeaderboardPeriod.MONTHLY,
      LeaderboardPeriod.ALL_TIME,
    ];
    const defaultLimit = 20;
    const defaultPage = 1;
    const defaultMinActivity = 3;

    for (const period of periods) {
      try {
        const providerLeaderboard = await this.leaderboardRepository.aggregateProviderLeaderboard(
          period,
          defaultLimit,
          defaultPage,
          defaultMinActivity,
        );
        const providerResponse: LeaderboardResponse<ProviderLeaderboardEntry> = {
          leaderboard: providerLeaderboard,
          period,
          cachedAt: new Date().toISOString(),
          page: defaultPage,
          limit: defaultLimit,
          total: providerLeaderboard.length,
        };
        await this.cacheManager.set(
          `${this.CACHE_KEY_PREFIX}:providers:${period}:${defaultLimit}:${defaultPage}:${defaultMinActivity}`,
          providerResponse,
          this.CACHE_TTL_SECONDS * 1000,
        );

        const userLeaderboard = await this.leaderboardRepository.aggregateUserLeaderboard(
          period,
          defaultLimit,
          defaultPage,
          defaultMinActivity,
        );
        const userResponse: LeaderboardResponse<UserLeaderboardEntry> = {
          leaderboard: userLeaderboard,
          period,
          cachedAt: new Date().toISOString(),
          page: defaultPage,
          limit: defaultLimit,
          total: userLeaderboard.length,
        };
        await this.cacheManager.set(
          `${this.CACHE_KEY_PREFIX}:users:${period}:${defaultLimit}:${defaultPage}:${defaultMinActivity}`,
          userResponse,
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
