import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LeaderboardRepository } from './leaderboard.repository';
import { Signal } from '../signals/signal.entity';
import { Provider } from '../providers/provider.entity';
import { LeaderboardPeriod } from './dto/leaderboard-query.dto';

const mockSignalRepo = () => ({
  createQueryBuilder: jest.fn(),
});

const mockProviderRepo = () => ({
  createQueryBuilder: jest.fn(),
});

const mockDataSource = () => ({
  query: jest.fn(),
});

describe('LeaderboardRepository', () => {
  let repo: LeaderboardRepository;
  let signalRepo: ReturnType<typeof mockSignalRepo>;
  let providerRepo: ReturnType<typeof mockProviderRepo>;
  let dataSource: ReturnType<typeof mockDataSource>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardRepository,
        { provide: getRepositoryToken(Signal), useFactory: mockSignalRepo },
        { provide: getRepositoryToken(Provider), useFactory: mockProviderRepo },
        { provide: DataSource, useFactory: mockDataSource },
      ],
    }).compile();

    repo = module.get(LeaderboardRepository);
    signalRepo = module.get(getRepositoryToken(Signal));
    providerRepo = module.get(getRepositoryToken(Provider));
    dataSource = module.get(DataSource);
  });

  // ── aggregateLeaderboard ──────────────────────────────────────────────────

  describe('aggregateLeaderboard', () => {
    const buildQb = (rows: any[]) => {
      const qb: any = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      return qb;
    };

    it('returns empty array when no signals exist', async () => {
      signalRepo.createQueryBuilder.mockReturnValue(buildQb([]));
      const result = await repo.aggregateLeaderboard(LeaderboardPeriod.ALL_TIME, 100);
      expect(result).toEqual([]);
    });

    it('maps raw rows to LeaderboardEntry with correct rank', async () => {
      const rawRows = [
        { provider: 'addr1', signalCount: '10', winRate: '70.00', totalPnL: '500.00' },
        { provider: 'addr2', signalCount: '5', winRate: '60.00', totalPnL: '200.00' },
      ];
      signalRepo.createQueryBuilder.mockReturnValue(buildQb(rawRows));

      const providerQb: any = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { address: 'addr1', name: 'Alice', avatar: 'a.png', bio: 'bio1' },
          { address: 'addr2', name: 'Bob', avatar: 'b.png', bio: 'bio2' },
        ]),
      };
      providerRepo.createQueryBuilder.mockReturnValue(providerQb);

      const result = await repo.aggregateLeaderboard(LeaderboardPeriod.ALL_TIME, 100);

      expect(result).toHaveLength(2);
      expect(result[0].rank).toBe(1);
      expect(result[0].provider).toBe('addr1');
      expect(result[0].name).toBe('Alice');
      expect(result[1].rank).toBe(2);
    });

    it('applies date filter for DAILY period', async () => {
      const qb = buildQb([]);
      signalRepo.createQueryBuilder.mockReturnValue(qb);

      await repo.aggregateLeaderboard(LeaderboardPeriod.DAILY, 10);

      expect(qb.andWhere).toHaveBeenCalledWith(
        's.created_at >= :from',
        expect.objectContaining({ from: expect.any(Date) }),
      );
    });

    it('applies date filter for WEEKLY period', async () => {
      const qb = buildQb([]);
      signalRepo.createQueryBuilder.mockReturnValue(qb);

      await repo.aggregateLeaderboard(LeaderboardPeriod.WEEKLY, 10);

      expect(qb.andWhere).toHaveBeenCalledWith(
        's.created_at >= :from',
        expect.objectContaining({ from: expect.any(Date) }),
      );
    });

    it('does NOT apply date filter for ALL_TIME period', async () => {
      const qb = buildQb([]);
      signalRepo.createQueryBuilder.mockReturnValue(qb);

      await repo.aggregateLeaderboard(LeaderboardPeriod.ALL_TIME, 10);

      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('handles missing provider metadata gracefully', async () => {
      const rawRows = [
        { provider: 'unknown_addr', signalCount: '3', winRate: '50.00', totalPnL: '100.00' },
      ];
      signalRepo.createQueryBuilder.mockReturnValue(buildQb(rawRows));

      const providerQb: any = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      providerRepo.createQueryBuilder.mockReturnValue(providerQb);

      const result = await repo.aggregateLeaderboard(LeaderboardPeriod.ALL_TIME, 100);

      expect(result[0].name).toBeNull();
      expect(result[0].avatar).toBeNull();
    });
  });

  // ── ensureIndexes ─────────────────────────────────────────────────────────

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
