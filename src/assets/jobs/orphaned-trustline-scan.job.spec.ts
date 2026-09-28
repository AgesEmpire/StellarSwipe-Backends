import { OrphanedTrustlineScanJob } from './orphaned-trustline-scan.job';
import { PlatformTrustline, TrustlineStatus } from '../entities/platform-trustline.entity';
import { Asset } from '../entities/asset.entity';

function makeTrustline(
  id: string,
  assetActive: boolean,
  status: TrustlineStatus = TrustlineStatus.ACTIVE,
): PlatformTrustline {
  const asset = { id: `asset-${id}`, isActive: assetActive } as Asset;
  return { id, platformAccount: `GACCT${id}`, assetId: asset.id, asset, status } as PlatformTrustline;
}

function makeRepo(queryResults: PlatformTrustline[] = []) {
  const qb: any = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(queryResults),
  };

  return {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    save: jest.fn().mockImplementation(async (rows) => rows),
  } as any;
}

describe('OrphanedTrustlineScanJob', () => {
  it('flags trustlines whose asset is no longer active', async () => {
    const orphanedTrustline = makeTrustline('1', false);
    const repo = makeRepo([orphanedTrustline]);
    const job = new OrphanedTrustlineScanJob(repo);

    const result = await job.scan();

    expect(result.flagged).toBe(1);
    expect(repo.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ status: TrustlineStatus.ORPHANED, flaggedAt: expect.any(Date) }),
      ]),
    );
  });

  it('does not flag trustlines whose asset is still active', async () => {
    const repo = makeRepo([]); // query returns nothing — all trustlines are for active assets
    const job = new OrphanedTrustlineScanJob(repo);

    const result = await job.scan();

    expect(result.flagged).toBe(0);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('flags multiple orphaned trustlines in a single run', async () => {
    const orphans = [makeTrustline('a', false), makeTrustline('b', false)];
    const repo = makeRepo(orphans);
    const job = new OrphanedTrustlineScanJob(repo);

    const result = await job.scan();

    expect(result.flagged).toBe(2);
  });

  it('returns previously-flagged orphaned trustlines via getOrphanedTrustlines', async () => {
    const flagged = makeTrustline('z', false, TrustlineStatus.ORPHANED);
    const repo = makeRepo([flagged]);
    const job = new OrphanedTrustlineScanJob(repo);

    const list = await job.getOrphanedTrustlines();

    expect(list).toHaveLength(1);
    expect(list[0].status).toBe(TrustlineStatus.ORPHANED);
  });
});
