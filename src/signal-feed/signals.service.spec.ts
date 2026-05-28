import { BadRequestException } from '@nestjs/common';
import { SignalsService } from './signals.service';
import { SortBy } from './dto/signal-feed-query.dto';
import { SignalStatus, SignalType } from '../signals/entities/signal.entity';

const makeSignal = (id: string, overrides: Record<string, any> = {}) => ({
  id,
  providerId: 'prov-1',
  baseAsset: 'XLM',
  counterAsset: 'USDC',
  type: SignalType.BUY,
  status: SignalStatus.ACTIVE,
  entryPrice: '0.15',
  targetPrice: '0.20',
  stopLossPrice: '0.12',
  rationale: 'Test rationale',
  confidenceScore: 75,
  copiersCount: 5,
  successRate: 60,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3_600_000),
  provider: { username: 'trader1' },
  ...overrides,
});

const buildService = (signals: any[] = [], stats: any[] = []) => {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(signals),
    getCount: jest.fn().mockResolvedValue(signals.length),
  };

  const signalRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };
  const statsRepo = {
    findByIds: jest.fn().mockResolvedValue(stats),
  };
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };

  const { FeedRankingService } = require('./feed-ranking.service');
  const { AssetPairMetadataService } = require('./asset-pair-metadata.service');

  return new SignalsService(
    signalRepo as any,
    statsRepo as any,
    cache as any,
    new FeedRankingService(),
    new AssetPairMetadataService(),
  );
};

describe('SignalsService (feed)', () => {
  describe('getFeed() — pagination', () => {
    it('returns hasMore=false when results <= limit', async () => {
      const svc = buildService([makeSignal('a'), makeSignal('b')]);
      const res = await svc.getFeed({ limit: 20, sortBy: SortBy.RECENT });
      expect(res.hasMore).toBe(false);
      expect(res.nextCursor).toBeNull();
    });

    it('returns hasMore=true and nextCursor when results > limit', async () => {
      // Service fetches limit+1; simulate 3 rows with limit=2
      const signals = [makeSignal('a'), makeSignal('b'), makeSignal('c')];
      const svc = buildService(signals);
      const res = await svc.getFeed({ limit: 2, sortBy: SortBy.RECENT });
      expect(res.hasMore).toBe(true);
      expect(res.nextCursor).not.toBeNull();
      expect(res.signals).toHaveLength(2);
    });

    it('returns page and totalPages when page param is provided', async () => {
      const svc = buildService([makeSignal('a')]);
      const res = await svc.getFeed({ page: 1, limit: 10, sortBy: SortBy.RECENT });
      expect(res.page).toBe(1);
      expect(typeof res.totalPages).toBe('number');
    });

    it('throws BadRequestException for malformed cursor', async () => {
      const svc = buildService([]);
      await expect(
        svc.getFeed({ cursor: 'not-valid-base64!!', sortBy: SortBy.RECENT }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for malformed asset filter', async () => {
      const svc = buildService([]);
      await expect(svc.getFeed({ asset: 'NOSLASH', sortBy: SortBy.RECENT })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getFeed() — response shape', () => {
    it('includes all required feed fields on each item', async () => {
      const svc = buildService([makeSignal('sig-1')]);
      const res = await svc.getFeed({ limit: 10, sortBy: SortBy.RECENT });
      const item = res.signals[0];
      expect(item).toHaveProperty('pair');
      expect(item).toHaveProperty('action');
      expect(item).toHaveProperty('price');
      expect(item).toHaveProperty('rationale');
      expect(item).toHaveProperty('provider');
      expect(item).toHaveProperty('confidence');
      expect(item).toHaveProperty('timestamp');
      expect(item).toHaveProperty('pairMetadata');
    });

    it('returns empty signals array when no active signals', async () => {
      const svc = buildService([]);
      const res = await svc.getFeed({ sortBy: SortBy.RECENT });
      expect(res.signals).toHaveLength(0);
      expect(res.hasMore).toBe(false);
    });
  });

  describe('getFeed() — RANKED sort', () => {
    it('attaches feedScore to each item', async () => {
      const svc = buildService([makeSignal('a'), makeSignal('b')]);
      const res = await svc.getFeed({ sortBy: SortBy.RANKED });
      res.signals.forEach((s) => expect(typeof s.feedScore).toBe('number'));
    });

    it('returns page/totalPages for ranked feed', async () => {
      const svc = buildService([makeSignal('a')]);
      const res = await svc.getFeed({ sortBy: SortBy.RANKED, page: 1, limit: 10 });
      expect(res.page).toBeDefined();
      expect(res.totalPages).toBeDefined();
    });
  });

  describe('getFeed() — caching', () => {
    it('returns cached response without hitting the DB', async () => {
      const cached = { signals: [], hasMore: false, nextCursor: null };
      const signalRepo = { createQueryBuilder: jest.fn() };
      const statsRepo = { findByIds: jest.fn() };
      const cache = {
        get: jest.fn().mockResolvedValue(cached),
        set: jest.fn(),
      };
      const { FeedRankingService } = require('./feed-ranking.service');
      const { AssetPairMetadataService } = require('./asset-pair-metadata.service');
      const svc = new SignalsService(
        signalRepo as any,
        statsRepo as any,
        cache as any,
        new FeedRankingService(),
        new AssetPairMetadataService(),
      );
      const res = await svc.getFeed({ sortBy: SortBy.RECENT });
      expect(res).toBe(cached);
      expect(signalRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
