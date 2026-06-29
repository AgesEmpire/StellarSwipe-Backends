import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { RefreshTokenCleanupService } from './refresh-token-cleanup.service';
import { RefreshToken } from './entities/refresh-token.entity';

function makeDeleteQb(affected: number) {
  const qb: any = {
    delete: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected }),
  };
  return qb;
}

describe('RefreshTokenCleanupService', () => {
  let service: RefreshTokenCleanupService;
  let qbFactory: jest.Mock;
  let countMock: jest.Mock;

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
              key === 'REFRESH_TOKEN_CLEANUP_BATCH_SIZE' ? 500 : def,
            ),
          },
        },
      ],
    }).compile();

    service = module.get(RefreshTokenCleanupService);
  });

  describe('deleteExpiredTokens', () => {
    it('deletes expired tokens in a single batch when fewer than batch size', async () => {
      const qb = makeDeleteQb(10);
      qbFactory.mockReturnValueOnce(qb).mockReturnValueOnce(makeDeleteQb(0));

      await service.deleteExpiredTokens();

      expect(qb.execute).toHaveBeenCalled();
    });

    it('loops until batch returns 0 rows (batch boundary)', async () => {
      const fullBatch = makeDeleteQb(500);
      const partialBatch = makeDeleteQb(200);
      const emptyBatch = makeDeleteQb(0);

      qbFactory
        .mockReturnValueOnce(fullBatch)
        .mockReturnValueOnce(partialBatch)
        .mockReturnValueOnce(emptyBatch);

      await service.deleteExpiredTokens();

      expect(fullBatch.execute).toHaveBeenCalledTimes(1);
      expect(partialBatch.execute).toHaveBeenCalledTimes(1);
    });

    it('does not throw when repository throws — logs the error', async () => {
      qbFactory.mockReturnValueOnce({
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        execute: jest.fn().mockRejectedValue(new Error('DB error')),
      });

      await expect(service.deleteExpiredTokens()).resolves.toBeUndefined();
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
