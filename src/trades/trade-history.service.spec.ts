import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TradeHistoryService } from './trade-history.service';
import { Trade, TradeStatus, TradeSide } from './entities/trade.entity';
import { tradeFactory } from '../../test/utils/mock-factories';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal mock QueryBuilder that chains fluently and resolves data */
function buildMockQb(resolveWith: Trade | Trade[] | [Trade[], number] | any) {
  const qb: any = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(Array.isArray(resolveWith) && !Array.isArray(resolveWith[0]) ? resolveWith : (resolveWith as [Trade[], number])[0] ?? resolveWith),
    getManyAndCount: jest.fn().mockResolvedValue(resolveWith),
    getRawOne: jest.fn().mockResolvedValue(resolveWith),
  };
  return qb;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TradeHistoryService', () => {
  let service: TradeHistoryService;
  let mockRepository: any;

  beforeEach(async () => {
    mockRepository = {
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeHistoryService,
        { provide: getRepositoryToken(Trade), useValue: mockRepository },
      ],
    }).compile();

    service = module.get<TradeHistoryService>(TradeHistoryService);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // getUserTradeHistory
  // -------------------------------------------------------------------------

  describe('getUserTradeHistory', () => {
    it('returns paginated results with total count', async () => {
      const trade = tradeFactory({ id: 'trade-1' });
      const qb = buildMockQb([[trade], 1]);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getUserTradeHistory({ userId: 'user-123' });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(qb.getManyAndCount).toHaveBeenCalled();
    });

    it('applies status filter when provided', async () => {
      const qb = buildMockQb([[], 0]);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getUserTradeHistory({ userId: 'user-123', status: 'completed' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'trade.status = :status',
        { status: 'completed' },
      );
    });

    it('does NOT apply status filter when status is "all"', async () => {
      const qb = buildMockQb([[], 0]);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getUserTradeHistory({ userId: 'user-123', status: 'all' });

      const statusCalls = (qb.andWhere as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0].includes('status'),
      );
      expect(statusCalls).toHaveLength(0);
    });

    it('applies startDate filter when provided', async () => {
      const qb = buildMockQb([[], 0]);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getUserTradeHistory({
        userId: 'user-123',
        startDate: '2024-01-01',
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'trade.created_at >= :startDate',
        expect.objectContaining({ startDate: expect.any(Date) }),
      );
    });

    it('applies endDate filter when provided', async () => {
      const qb = buildMockQb([[], 0]);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getUserTradeHistory({
        userId: 'user-123',
        endDate: '2024-12-31',
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'trade.created_at <= :endDate',
        expect.objectContaining({ endDate: expect.any(Date) }),
      );
    });

    it('caps limit at 100', async () => {
      const qb = buildMockQb([[], 0]);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getUserTradeHistory({ userId: 'user-123', limit: 500 });

      expect(qb.take).toHaveBeenCalledWith(100);
    });

    it('uses provided offset', async () => {
      const qb = buildMockQb([[], 0]);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getUserTradeHistory({ userId: 'user-123', offset: 40 });

      expect(qb.skip).toHaveBeenCalledWith(40);
    });

    it('maps trade entity fields to TradeDetailsDto correctly', async () => {
      const trade = tradeFactory({
        id: 'trade-abc',
        userId: 'user-123',
        status: TradeStatus.COMPLETED,
        side: TradeSide.BUY,
        profitLoss: '15.00000000',
      });
      const qb = buildMockQb([[trade], 1]);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getUserTradeHistory({ userId: 'user-123' });

      expect(result.data[0].id).toBe('trade-abc');
      expect(result.data[0].profitLoss).toBe('15.00000000');
      expect(result.data[0].status).toBe(TradeStatus.COMPLETED);
    });
  });

  // -------------------------------------------------------------------------
  // getUserTradesSummary
  // -------------------------------------------------------------------------

  describe('getUserTradesSummary', () => {
    it('returns correct summary from DB aggregates', async () => {
      const rawRow = {
        totalTrades: '10',
        openTrades: '2',
        completedTrades: '6',
        failedTrades: '2',
        totalProfitLoss: '50.5',
        winningTrades: '4',
        closedWithPnl: '6',
        averageProfitLoss: '8.416666',
      };
      const qb = buildMockQb(rawRow);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getUserTradesSummary('user-123');

      expect(result.totalTrades).toBe(10);
      expect(result.openTrades).toBe(2);
      expect(result.completedTrades).toBe(6);
      expect(result.failedTrades).toBe(2);
      expect(parseFloat(result.totalProfitLoss)).toBeCloseTo(50.5);
      // winRate = 4/6 * 100 ≈ 66.67
      expect(parseFloat(result.winRate)).toBeCloseTo(66.67, 1);
      expect(result.averageProfitLoss).toBeDefined();
    });

    it('returns zero winRate when no closed trades with P&L', async () => {
      const rawRow = {
        totalTrades: '3',
        openTrades: '3',
        completedTrades: '0',
        failedTrades: '0',
        totalProfitLoss: '0',
        winningTrades: '0',
        closedWithPnl: '0',
        averageProfitLoss: '0',
      };
      const qb = buildMockQb(rawRow);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getUserTradesSummary('user-123');

      expect(parseFloat(result.winRate)).toBe(0);
      expect(parseFloat(result.totalProfitLoss)).toBe(0);
    });

    it('issues a single DB query (no in-memory aggregation)', async () => {
      const qb = buildMockQb({
        totalTrades: '0', openTrades: '0', completedTrades: '0',
        failedTrades: '0', totalProfitLoss: '0', winningTrades: '0',
        closedWithPnl: '0', averageProfitLoss: '0',
      });
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getUserTradesSummary('user-123');

      // getRawOne = single aggregate query; getMany/find should NOT be called
      expect(qb.getRawOne).toHaveBeenCalledTimes(1);
      expect(qb.getMany).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getOpenPositions
  // -------------------------------------------------------------------------

  describe('getOpenPositions', () => {
    it('returns open positions for a user', async () => {
      const openTrade = tradeFactory({
        status: TradeStatus.COMPLETED,
        closedAt: undefined,
      });
      const qb = buildMockQb([openTrade]);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getOpenPositions('user-123');

      expect(result).toHaveLength(1);
    });

    it('filters closed_at IS NULL at the DB level', async () => {
      const qb = buildMockQb([]);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getOpenPositions('user-123');

      expect(qb.andWhere).toHaveBeenCalledWith('trade.closed_at IS NULL');
    });

    it('filters by COMPLETED status at the DB level', async () => {
      const qb = buildMockQb([]);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getOpenPositions('user-123');

      expect(qb.andWhere).toHaveBeenCalledWith(
        'trade.status = :status',
        { status: TradeStatus.COMPLETED },
      );
    });

    it('returns empty array when no open positions exist', async () => {
      const qb = buildMockQb([]);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getOpenPositions('user-123');

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getTradesBySignal
  // -------------------------------------------------------------------------

  describe('getTradesBySignal', () => {
    it('returns trades for a given signal ordered by created_at DESC', async () => {
      const t1 = tradeFactory({ id: 'trade-1', signalId: 'sig-1' });
      const t2 = tradeFactory({ id: 'trade-2', signalId: 'sig-1' });
      const qb = buildMockQb([t1, t2]);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getTradesBySignal('sig-1');

      expect(result).toHaveLength(2);
      expect(qb.where).toHaveBeenCalledWith(
        'trade.signal_id = :signalId',
        { signalId: 'sig-1' },
      );
      expect(qb.orderBy).toHaveBeenCalledWith('trade.created_at', 'DESC');
    });

    it('returns empty array when signal has no trades', async () => {
      const qb = buildMockQb([]);
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getTradesBySignal('sig-unknown');

      expect(result).toEqual([]);
    });
  });
});
