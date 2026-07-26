import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { RefreshTokenCleanupService } from './refresh-token-cleanup.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { DistributedLockService } from '../common/services/distributed-lock.service';

function makeSelectQb(ids: string[]) {
  const qb: any = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(ids.map((id) => ({ id }))),
  };
  return qb;
}

function makeDeleteQb(affected: number) {
  const qb: any = {
    delete: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    whereInIds: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected }),
  };
  return qb;
}

describe('RefreshTokenCleanupService', () => {
  let service: RefreshTokenCleanupService;
  let qbFactory: jest.Mock;
  let countMock: jest.Mock;
  let distributedLock: DistributedLockService;

  beforeEach(async () => {
    qbFactory = jest.fn();
    countMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenCleanupService,
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: {
            createQueryBuilder: qbFactory,
            count: countMock,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: any) =>
              key === 'REFRESH_TOKEN_CLEANUP_BATCH_SIZE' ? 5 : def,
            ),
          },
        },
        {
          provide: DistributedLockService,
          useValue: {
            withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<any>) => ({
              ran: true,
              result: await fn(),
            })),
          },
        },
      ],
    }).compile();

    service = module.get(RefreshTokenCleanupService);
    distributedLock = module.get(DistributedLockService);
  });

  describe('deleteExpiredTokens', () => {
    it('deletes expired tokens in a single batch when fewer than batch size', async () => {
      const selectQb = makeSelectQb(['id-1', 'id-2']);
      const deleteQb = makeDeleteQb(2);
      qbFactory.mockReturnValueOnce(selectQb).mockReturnValueOnce(deleteQb);

      const total = await service.deleteExpiredTokens();

      expect(selectQb.getRawMany).toHaveBeenCalled();
      expect(deleteQb.whereInIds).toHaveBeenCalledWith(['id-1', 'id-2']);
      expect(deleteQb.execute).toHaveBeenCalled();
      expect(total).toBe(2);
    });

    it('loops across batch boundaries until fewer ids than batch size are found', async () => {
      // batch size is mocked to 5
      const fullSelect = makeSelectQb(['a', 'b', 'c', 'd', 'e']);
      const fullDelete = makeDeleteQb(5);
      const partialSelect = makeSelectQb(['f', 'g']);
      const partialDelete = makeDeleteQb(2);

      qbFactory
        .mockReturnValueOnce(fullSelect)
        .mockReturnValueOnce(fullDelete)
        .mockReturnValueOnce(partialSelect)
        .mockReturnValueOnce(partialDelete);

      const total = await service.deleteExpiredTokens();

      expect(fullDelete.execute).toHaveBeenCalledTimes(1);
      expect(partialDelete.execute).toHaveBeenCalledTimes(1);
      expect(total).toBe(7);
    });

    it('stops immediately and returns 0 when no expired tokens exist', async () => {
      const emptySelect = makeSelectQb([]);
      qbFactory.mockReturnValueOnce(emptySelect);

      const total = await service.deleteExpiredTokens();

      expect(total).toBe(0);
      expect(qbFactory).toHaveBeenCalledTimes(1);
    });

    it('never selects or deletes rows that are not yet expired (only expiresAt < now is queried)', async () => {
      const selectQb = makeSelectQb([]);
      qbFactory.mockReturnValueOnce(selectQb);

      await service.deleteExpiredTokens();

      expect(selectQb.where).toHaveBeenCalledWith('rt.expiresAt < :now', {
        now: expect.any(Date),
      });
    });

    it('does not throw when the repository throws — logs and returns partial progress', async () => {
      qbFactory.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockRejectedValue(new Error('DB error')),
      });

      await expect(service.deleteExpiredTokens()).resolves.toBe(0);
    });
  });

  describe('handleCron', () => {
    it('runs the cleanup under a distributed lock', async () => {
      const emptySelect = makeSelectQb([]);
      qbFactory.mockReturnValueOnce(emptySelect);

      await service.handleCron();

      expect(distributedLock.withLock).toHaveBeenCalledWith(
        'refresh-token-cleanup',
        expect.any(Number),
        expect.any(Function),
      );
    });

    it('skips cleanup entirely when another replica already holds the lock', async () => {
      (distributedLock.withLock as jest.Mock).mockResolvedValueOnce({ ran: false });

      await service.handleCron();

      expect(qbFactory).not.toHaveBeenCalled();
    });
  });

  describe('countExpired / countActive', () => {
    it('countExpired queries tokens with expiresAt < now', async () => {
      countMock.mockResolvedValue(3);
      const result = await service.countExpired();
      expect(result).toBe(3);
      expect(countMock).toHaveBeenCalledWith({ where: { expiresAt: expect.anything() } });
    });

    it('countActive uses a query builder to count non-expired tokens', async () => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(7),
      };
      qbFactory.mockReturnValue(qb);
      const result = await service.countActive();
      expect(result).toBe(7);
    });
  });
});
