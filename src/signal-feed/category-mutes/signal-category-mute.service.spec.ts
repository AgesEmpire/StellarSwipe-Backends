import { BadRequestException, ConflictException } from '@nestjs/common';
import { SignalCategoryMuteService } from './signal-category-mute.service';
import { SignalCategory } from '../../signals/entities/signal.entity';
import { SignalsService } from '../signals.service';
import { SortBy } from '../dto/signal-feed-query.dto';
import { FeedRankingService } from '../feed-ranking.service';
import { AssetPairMetadataService } from '../asset-pair-metadata.service';

/** In-memory repo with the same atomic compare-and-set semantics as Postgres. */
function makeRepo() {
  const rows = new Map<string, { userId: string; mutedCategories: string[]; version: number }>();
  const repo = {
    rows,
    findOne: jest.fn(async ({ where }: any) => {
      const r = rows.get(where.userId);
      return r ? { ...r, mutedCategories: [...r.mutedCategories] } : null;
    }),
    insert: jest.fn(async (row: any) => {
      if (rows.has(row.userId)) throw Object.assign(new Error('dup'), { code: '23505' });
      rows.set(row.userId, { ...row, mutedCategories: [...row.mutedCategories] });
    }),
    update: jest.fn(async (where: any, patch: any) => {
      const r = rows.get(where.userId);
      if (!r || r.version !== where.version) return { affected: 0 };
      rows.set(where.userId, { ...r, ...patch });
      return { affected: 1 };
    }),
  };
  return repo;
}

describe('SignalCategoryMuteService (#1516)', () => {
  let repo: ReturnType<typeof makeRepo>;
  let svc: SignalCategoryMuteService;

  beforeEach(() => {
    repo = makeRepo();
    svc = new SignalCategoryMuteService(repo as any);
  });

  it('returns defaults (nothing muted, version 0) for a new user', async () => {
    expect(await svc.get('u1')).toEqual({ userId: 'u1', mutedCategories: [], version: 0 });
  });

  it('stores multiple categories, de-duplicated and ordered', async () => {
    const res = await svc.replace('u1', [
      SignalCategory.SWING,
      SignalCategory.DEFI,
      SignalCategory.SWING,
    ]);
    expect(res).toEqual({
      userId: 'u1',
      mutedCategories: [SignalCategory.DEFI, SignalCategory.SWING],
      version: 1,
    });
    expect((await svc.get('u1')).mutedCategories).toEqual([
      SignalCategory.DEFI,
      SignalCategory.SWING,
    ]);
  });

  it('mutes and unmutes single categories independently', async () => {
    await svc.mute('u1', SignalCategory.SCALP);
    await svc.mute('u1', SignalCategory.ARBITRAGE);
    await svc.unmute('u1', SignalCategory.SCALP);
    expect(await svc.getMutedCategories('u1')).toEqual([SignalCategory.ARBITRAGE]);
  });

  it('resets to defaults', async () => {
    await svc.replace('u1', [SignalCategory.DEFI]);
    const res = await svc.reset('u1');
    expect(res.mutedCategories).toEqual([]);
    expect(await svc.getMutedCategories('u1')).toEqual([]);
  });

  it('keeps users isolated', async () => {
    await svc.replace('u1', [SignalCategory.DEFI]);
    expect(await svc.getMutedCategories('u2')).toEqual([]);
  });

  it('rejects unknown categories', async () => {
    await expect(svc.replace('u1', ['NOPE'])).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('concurrent updates', () => {
    it('rejects a stale expectedVersion with 409', async () => {
      const { version } = await svc.replace('u1', [SignalCategory.DEFI]);
      await svc.replace('u1', [SignalCategory.SWING], version); // winner
      await expect(
        svc.replace('u1', [SignalCategory.SCALP], version), // loser, same base version
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await svc.getMutedCategories('u1')).toEqual([SignalCategory.SWING]);
    });

    it('rejects a concurrent first write that expected defaults', async () => {
      await svc.replace('u1', [SignalCategory.DEFI], 0);
      await expect(svc.replace('u1', [SignalCategory.SWING], 0)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('does not lose concurrent single-category mutes (CAS retry)', async () => {
      await Promise.all([
        svc.mute('u1', SignalCategory.DEFI),
        svc.mute('u1', SignalCategory.SWING),
        svc.mute('u1', SignalCategory.SCALP),
      ]);
      const prefs = await svc.get('u1');
      expect(prefs.mutedCategories).toEqual([
        SignalCategory.DEFI,
        SignalCategory.SCALP,
        SignalCategory.SWING,
      ]);
      expect(prefs.version).toBe(3);
    });
  });
});

describe('SignalsService feed with muted categories (#1516)', () => {
  const build = () => {
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getCount: jest.fn().mockResolvedValue(0),
    };
    const signalRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb), update: jest.fn(), save: jest.fn() };
    const cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const svc = new SignalsService(
      signalRepo as any,
      { findByIds: jest.fn().mockResolvedValue([]) } as any,
      cache as any,
      new FeedRankingService(),
      new AssetPairMetadataService(),
    );
    return { svc, qb, cache, signalRepo };
  };

  it('excludes muted categories but keeps uncategorised signals', async () => {
    const { svc, qb } = build();
    await svc.getFeed({ sortBy: SortBy.RECENT } as any, [], [SignalCategory.DEFI, SignalCategory.SWING]);
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(s.category IS NULL OR s.category NOT IN (:...mutedCategories))',
      { mutedCategories: [SignalCategory.DEFI, SignalCategory.SWING] },
    );
  });

  it('applies no category filter by default', async () => {
    const { svc, qb } = build();
    await svc.getFeed({ sortBy: SortBy.RECENT } as any);
    const clauses = qb.andWhere.mock.calls.map((c: any[]) => c[0]);
    expect(clauses.some((c: string) => c.includes('category'))).toBe(false);
  });

  it('separates cache entries per muted set and never mutates signals', async () => {
    const { svc, cache, signalRepo } = build();
    await svc.getFeed({ sortBy: SortBy.RECENT } as any, [], [SignalCategory.DEFI]);
    await svc.getFeed({ sortBy: SortBy.RECENT } as any, [], []);
    const keys = cache.get.mock.calls.map((c: any[]) => c[0]);
    expect(new Set(keys).size).toBe(2);
    expect(signalRepo.update).not.toHaveBeenCalled();
    expect(signalRepo.save).not.toHaveBeenCalled();
  });
});
