import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LeaderboardRepository } from './leaderboard.repository';
import { Signal } from '../signals/entities/signal.entity';
import { CopiedPosition } from '../signals/entities/copied-position.entity';
import { User } from '../users/entities/user.entity';
import { LeaderboardPeriod } from './dto/leaderboard-query.dto';

const mockSignalRepo = () => ({
  createQueryBuilder: jest.fn(),
});

const mockCopiedPositionRepo = () => ({
  createQueryBuilder: jest.fn(),
});

const mockUserRepo = () => ({
  createQueryBuilder: jest.fn(),
});

const mockDataSource = () => ({
  query: jest.fn(),
});

describe('LeaderboardRepository', () => {
  let repo: LeaderboardRepository;
  let signalRepo: ReturnType<typeof mockSignalRepo>;
  let copiedPositionRepo: ReturnType<typeof mockCopiedPositionRepo>;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let dataSource: ReturnType<typeof mockDataSource>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardRepository,
        { provide: getRepositoryToken(Signal), useFactory: mockSignalRepo },
        { provide: getRepositoryToken(CopiedPosition), useFactory: mockCopiedPositionRepo },
        { provide: getRepositoryToken(User), useFactory: mockUserRepo },
        { provide: DataSource, useFactory: mockDataSource },
      ],
    }).compile();

    repo = module.get(LeaderboardRepository);
    signalRepo = module.get(getRepositoryToken(Signal));
    copiedPositionRepo = module.get(getRepositoryToken(CopiedPosition));
    userRepo = module.get(getRepositoryToken(User));
    dataSource = module.get(DataSource);
  });

  const buildQb = (rows: any[]) => {
    const qb: any = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      having: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rows),
    };
    return qb;
  };

  describe('aggregateProviderLeaderboard', () => {
    it('returns empty array when no signals exist', async () => {
      signalRepo.createQueryBuilder.mockReturnValue(buildQb([]));
      const result = await repo.aggregateProviderLeaderboard(LeaderboardPeriod.ALL_TIME, 100);
      expect(result).toEqual([]);
    });

    it('maps raw rows to provider leaderboard entries with metadata', async () => {
      const rawRows = [
        { providerId: 'provider-1', signalCount: '10', winRate: '70.00', totalPnl: '500.00' },
        { providerId: 'provider-2', signalCount: '5', winRate: '60.00', totalPnl: '200.00' },
      ];
      signalRepo.createQueryBuilder.mockReturnValue(buildQb(rawRows));

      const userQb: any = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: 'provider-1', username: 'alice', displayName: 'Alice', bio: 'bio1' },
          { id: 'provider-2', username: 'bob', displayName: 'Bob', bio: 'bio2' },
        ]),
      };
      userRepo.createQueryBuilder.mockReturnValue(userQb);

      const result = await repo.aggregateProviderLeaderboard(LeaderboardPeriod.ALL_TIME, 100);

      expect(result).toHaveLength(2);
      expect(result[0].rank).toBe(1);
      expect(result[0].providerId).toBe('provider-1');
      expect(result[0].username).toBe('alice');
      expect(result[1].rank).toBe(2);
    });

    it('applies date filter for MONTHLY period', async () => {
      const qb = buildQb([]);
      signalRepo.createQueryBuilder.mockReturnValue(qb);

      await repo.aggregateProviderLeaderboard(LeaderboardPeriod.MONTHLY, 20);

      expect(qb.andWhere).toHaveBeenCalledWith('s.createdAt >= :from', expect.objectContaining({ from: expect.any(Date) }));
    });

    it('applies offset for page 2', async () => {
      const qb = buildQb([]);
      signalRepo.createQueryBuilder.mockReturnValue(qb);

      await repo.aggregateProviderLeaderboard(LeaderboardPeriod.ALL_TIME, 10, 2, 3);

      expect(qb.offset).toHaveBeenCalledWith(10);
    });

    it('applies minimum activity threshold via HAVING clause', async () => {
      const qb = buildQb([]);
      signalRepo.createQueryBuilder.mockReturnValue(qb);

      await repo.aggregateProviderLeaderboard(LeaderboardPeriod.ALL_TIME, 20, 1, 5);

      expect(qb.having).toHaveBeenCalledWith('COUNT(s.id) >= :minActivity', { minActivity: 5 });
    });
  });

  describe('aggregateUserLeaderboard', () => {
    it('returns empty array when no copied positions exist', async () => {
      copiedPositionRepo.createQueryBuilder.mockReturnValue(buildQb([]));
      const result = await repo.aggregateUserLeaderboard(LeaderboardPeriod.ALL_TIME, 100);
      expect(result).toEqual([]);
    });

    it('maps raw rows to user leaderboard entries with metadata', async () => {
      const rawRows = [
        {
          userId: 'user-1',
          adoptionCount: '20',
          successRate: '75.00',
          averageReturn: '3.50',
          totalReturn: '70.00',
        },
      ];
      copiedPositionRepo.createQueryBuilder.mockReturnValue(buildQb(rawRows));

      const userQb: any = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: 'user-1', username: 'carol', displayName: 'Carol' },
        ]),
      };
      userRepo.createQueryBuilder.mockReturnValue(userQb);

      const result = await repo.aggregateUserLeaderboard(LeaderboardPeriod.ALL_TIME, 100);

      expect(result).toHaveLength(1);
      expect(result[0].rank).toBe(1);
      expect(result[0].userId).toBe('user-1');
      expect(result[0].username).toBe('carol');
      expect(result[0].adoptionCount).toBe(20);
    });
  });

  describe('ensureIndexes', () => {
    it('executes three CREATE INDEX statements', async () => {
      dataSource.query.mockResolvedValue(undefined);
      await repo.ensureIndexes();
      expect(dataSource.query).toHaveBeenCalledTimes(3);
    });

    it('does not throw when index already exists', async () => {
      dataSource.query.mockRejectedValue(new Error('already exists'));
      await expect(repo.ensureIndexes()).resolves.not.toThrow();
    });
  });
});
