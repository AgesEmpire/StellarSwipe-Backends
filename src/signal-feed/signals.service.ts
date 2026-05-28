import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Signal, SignalStatus } from '../signals/entities/signal.entity';
import { ProviderStats } from '../signals/entities/provider-stats.entity';
import { SignalFeedQueryDto, SortBy } from './dto/signal-feed-query.dto';
import {
  SignalFeedResponseDto,
  SignalFeedItemDto,
  ProviderSummaryDto,
} from './dto/signal-feed-response.dto';
import { FeedRankingService } from './feed-ranking.service';
import { AssetPairMetadataService } from './asset-pair-metadata.service';

interface CursorPayload {
  id: string;
  ts: number;
  sortValue?: number;
}

@Injectable()
export class SignalsService {
  constructor(
    @InjectRepository(Signal)
    private readonly signalRepo: Repository<Signal>,
    @InjectRepository(ProviderStats)
    private readonly statsRepo: Repository<ProviderStats>,
    @Inject(CACHE_MANAGER)
    private readonly cache: Cache,
    private readonly rankingService: FeedRankingService,
    private readonly metadataService: AssetPairMetadataService,
  ) {}

  async getFeed(query: SignalFeedQueryDto): Promise<SignalFeedResponseDto> {
    const { cursor, page, limit = 20, asset, provider, sortBy = SortBy.RANKED } = query;

    const cacheKey = `feed:${sortBy}:${cursor ?? page ?? 1}:${limit}:${asset ?? '*'}:${provider ?? '*'}`;
    const cached = await this.cache.get<SignalFeedResponseDto>(cacheKey);
    if (cached) return cached;

    const qb = this.signalRepo
      .createQueryBuilder('s')
      .where('s.status = :status', { status: SignalStatus.ACTIVE })
      .andWhere('s.expires_at > NOW()');

    if (asset) {
      const [base, quote] = asset.split('/');
      if (!base || !quote) throw new BadRequestException('asset must be in BASE/QUOTE format');
      qb.andWhere('s.base_asset = :base AND s.counter_asset = :quote', { base, quote });
    }

    if (provider) {
      qb.andWhere('s.provider_id = :provider', { provider });
    }

    // For RANKED we fetch a larger window, rank in-memory, then paginate
    if (sortBy === SortBy.RANKED) {
      return this.getRankedFeed(qb, query, cacheKey);
    }

    // Cursor-based pagination for non-ranked sorts
    const cursorData = cursor ? this.decodeCursor(cursor) : null;
    this.applyCursorCondition(qb, cursorData, sortBy);
    this.applySorting(qb, sortBy);

    const rows = await qb.take(limit + 1).getMany();
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor = hasMore ? this.encodeCursor(slice[slice.length - 1], sortBy) : null;

    // Page-based metadata
    let pageNum: number | undefined;
    let totalPages: number | undefined;
    if (page) {
      const total = await qb.getCount();
      pageNum = page;
      totalPages = Math.ceil(total / limit);
    }

    const statsMap = await this.loadStatsMap(slice);
    const items = await this.toFeedItems(slice, statsMap);

    const response: SignalFeedResponseDto = { signals: items, nextCursor, hasMore, page: pageNum, totalPages };
    await this.cache.set(cacheKey, response, 30_000);
    return response;
  }

  private async getRankedFeed(
    qb: any,
    query: SignalFeedQueryDto,
    cacheKey: string,
  ): Promise<SignalFeedResponseDto> {
    const { cursor, page, limit = 20 } = query;

    // Fetch up to 200 active signals for in-memory ranking
    const rows = await qb.orderBy('s.created_at', 'DESC').take(200).getMany();
    const statsMap = await this.loadStatsMap(rows);
    const ranked = this.rankingService.rank(rows, statsMap);

    // Cursor decode → find offset
    let offset = 0;
    if (cursor) {
      const { id } = this.decodeCursor(cursor);
      const idx = ranked.findIndex((s) => s.id === id);
      offset = idx >= 0 ? idx + 1 : 0;
    } else if (page && page > 1) {
      offset = (page - 1) * limit;
    }

    const slice = ranked.slice(offset, offset + limit);
    const hasMore = offset + limit < ranked.length;
    const nextCursor = hasMore
      ? this.encodeCursor(slice[slice.length - 1], SortBy.RANKED)
      : null;

    const totalPages = Math.ceil(ranked.length / limit);
    const items = await this.toFeedItems(
      slice,
      statsMap,
      slice.map((s) => s.feedScore),
    );

    const response: SignalFeedResponseDto = {
      signals: items,
      nextCursor,
      hasMore,
      page: page ?? 1,
      totalPages,
    };
    await this.cache.set(cacheKey, response, 30_000);
    return response;
  }

  private async loadStatsMap(signals: Signal[]): Promise<Map<string, ProviderStats>> {
    if (!signals.length) return new Map();
    const ids = [...new Set(signals.map((s) => s.providerId))];
    const stats = await this.statsRepo.findByIds(ids);
    return new Map(stats.map((s) => [s.providerId, s]));
  }

  private async toFeedItems(
    signals: Signal[],
    statsMap: Map<string, ProviderStats>,
    feedScores?: number[],
  ): Promise<SignalFeedItemDto[]> {
    const pairs = signals.map((s) => ({ base: s.baseAsset, quote: s.counterAsset }));
    const metaMap = this.metadataService.getMetadataMap(pairs);

    return signals.map((signal, i) => {
      const stats = statsMap.get(signal.providerId);
      const pairKey = `${signal.baseAsset.toUpperCase()}/${signal.counterAsset.toUpperCase()}`;

      const provider: ProviderSummaryDto = {
        id: signal.providerId,
        displayName: signal.provider?.username ?? signal.providerId,
        successRate: stats ? parseFloat(stats.winRate) : 0,
        totalSignals: stats?.totalSignals ?? 0,
        reputationScore: stats ? parseFloat(stats.reputationScore) : 50,
      };

      const item: SignalFeedItemDto = {
        id: signal.id,
        pair: pairKey,
        action: signal.type as 'BUY' | 'SELL',
        price: signal.entryPrice,
        rationale: signal.rationale,
        provider,
        confidence: signal.confidenceScore,
        timestamp: signal.createdAt,
        expiresAt: signal.expiresAt,
        status: signal.status,
        targetPrice: signal.targetPrice,
        stopLossPrice: signal.stopLossPrice,
        pairMetadata: metaMap.get(pairKey)!,
      };

      if (feedScores) item.feedScore = feedScores[i];
      return item;
    });
  }

  private encodeCursor(signal: Signal & { feedScore?: number }, sortBy: SortBy): string {
    const payload: CursorPayload = { id: signal.id, ts: signal.createdAt.getTime() };
    if (sortBy === SortBy.POPULAR) payload.sortValue = signal.copiersCount;
    if (sortBy === SortBy.PERFORMANCE) payload.sortValue = signal.successRate;
    if (sortBy === SortBy.RANKED) payload.sortValue = signal.feedScore;
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  private decodeCursor(cursor: string): CursorPayload {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
  }

  private applyCursorCondition(qb: any, cursor: CursorPayload | null, sortBy: SortBy): void {
    if (!cursor) return;
    switch (sortBy) {
      case SortBy.RECENT:
        qb.andWhere(
          '(s.created_at < :ts OR (s.created_at = :ts AND s.id < :id))',
          { ts: new Date(cursor.ts), id: cursor.id },
        );
        break;
      case SortBy.POPULAR:
        qb.andWhere(
          '(s.copiers_count < :sv OR (s.copiers_count = :sv AND s.id < :id))',
          { sv: cursor.sortValue, id: cursor.id },
        );
        break;
      case SortBy.PERFORMANCE:
        qb.andWhere(
          '(s.success_rate < :sv OR (s.success_rate = :sv AND s.id < :id))',
          { sv: cursor.sortValue, id: cursor.id },
        );
        break;
    }
  }

  private applySorting(qb: any, sortBy: SortBy): void {
    switch (sortBy) {
      case SortBy.RECENT:
        qb.orderBy('s.created_at', 'DESC').addOrderBy('s.id', 'DESC');
        break;
      case SortBy.POPULAR:
        qb.orderBy('s.copiers_count', 'DESC').addOrderBy('s.id', 'DESC');
        break;
      case SortBy.PERFORMANCE:
        qb.orderBy('s.success_rate', 'DESC').addOrderBy('s.id', 'DESC');
        break;
    }
  }
}
