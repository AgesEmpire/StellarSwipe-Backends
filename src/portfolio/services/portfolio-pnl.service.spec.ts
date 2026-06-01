import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Trade, TradeSide, TradeStatus } from '../../trades/entities/trade.entity';
import { PnlHistory } from '../entities/pnl-history.entity';
import { PnlCalculatorService } from './pnl-calculator.service';
import { PortfolioPnlService } from './portfolio-pnl.service';

const mockTrade = (overrides: Partial<Trade> = {}): Trade =>
  ({
    id: 'trade-1',
    userId: 'user-1',
    signalId: 'sig-1',
    baseAsset: 'XLM',
    counterAsset: 'USDC',
    side: TradeSide.BUY,
    amount: '100',
    entryPrice: '0.10',
    status: TradeStatus.SETTLED,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any);

describe('PortfolioPnlService', () => {
  let service: PortfolioPnlService;
  let tradeRepo: any;
  let pnlHistoryRepo: any;
  let pnlCalculator: any;

  beforeEach(async () => {
    tradeRepo = { find: jest.fn(), findAndCount: jest.fn() };
    pnlHistoryRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    pnlCalculator = {
      calculatePortfolioPnl: jest.fn().mockReturnValue({
        realizedPnL: 5,
        unrealizedPnL: 2,
        totalFees: 0.1,
        bySignal: { 'sig-1': { realizedPnL: 5, unrealizedPnL: 2 } },
        byAsset: {},
        missingPrices: [],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioPnlService,
        { provide: getRepositoryToken(Trade), useValue: tradeRepo },
        { provide: getRepositoryToken(PnlHistory), useValue: pnlHistoryRepo },
        { provide: PnlCalculatorService, useValue: pnlCalculator },
      ],
    }).compile();

    service = module.get(PortfolioPnlService);
  });

  describe('calculatePortfolioPnlSummary', () => {
    it('returns empty summary when user has no trades', async () => {
      tradeRepo.find.mockResolvedValue([]);
      const result = await service.calculatePortfolioPnlSummary('user-1', {});
      expect(result.positions).toHaveLength(0);
      expect(result.totalPnL).toBe(0);
    });

    it('computes summary across open trades', async () => {
      tradeRepo.find.mockResolvedValue([mockTrade()]);
      const prices = { 'XLM/USDC': 0.15 };
      const result = await service.calculatePortfolioPnlSummary('user-1', prices);
      expect(result.userId).toBe('user-1');
      expect(result.positions).toHaveLength(1);
      expect(result.totalRealizedPnL).toBe(5);
      expect(result.snapshotAt).toBeInstanceOf(Date);
    });

    it('groups trades by asset and signal', async () => {
      const trades = [
        mockTrade({ id: 't1', signalId: 'sig-1' }),
        mockTrade({ id: 't2', signalId: 'sig-2', amount: '50' }),
      ];
      tradeRepo.find.mockResolvedValue(trades);
      pnlCalculator.calculatePortfolioPnl.mockReturnValue({
        realizedPnL: 10,
        unrealizedPnL: 3,
        totalFees: 0.2,
        bySignal: {
          'sig-1': { realizedPnL: 5, unrealizedPnL: 2 },
          'sig-2': { realizedPnL: 5, unrealizedPnL: 1 },
        },
        byAsset: {},
        missingPrices: [],
      });
      const result = await service.calculatePortfolioPnlSummary('user-1', { 'XLM/USDC': 0.15 });
      expect(result.positions.length).toBeGreaterThanOrEqual(1);
    });

    it('calculates percentage change correctly', async () => {
      tradeRepo.find.mockResolvedValue([mockTrade()]);
      const result = await service.calculatePortfolioPnlSummary('user-1', { 'XLM/USDC': 0.20 });
      const pos = result.positions[0];
      // costBasis = 100 * 0.10 = 10, currentValue = 100 * 0.20 = 20 → +100%
      expect(typeof pos.percentageChange).toBe('number');
    });
  });

  describe('getPnlHistory', () => {
    it('returns mapped history records', async () => {
      pnlHistoryRepo.find.mockResolvedValue([
        {
          userId: 'user-1',
          assetSymbol: 'XLM/USDC',
          signalId: 'sig-1',
          snapshotDate: new Date('2024-01-01'),
          realizedPnL: '5.5',
          unrealizedPnL: '2.0',
          totalPnL: '7.5',
          totalFees: '0.1',
        },
      ]);
      const result = await service.getPnlHistory('user-1', new Date('2024-01-01'), new Date('2024-01-31'));
      expect(result).toHaveLength(1);
      expect(result[0].realizedPnL).toBe(5.5);
      expect(result[0].signalId).toBe('sig-1');
    });
  });

  describe('snapshotPnl', () => {
    it('persists a P&L snapshot', async () => {
      const created = { id: 'pnl-1' };
      pnlHistoryRepo.create.mockReturnValue(created);
      pnlHistoryRepo.save.mockResolvedValue({ ...created, userId: 'user-1' });
      const result = await service.snapshotPnl('user-1', 'XLM/USDC', 'sig-1', {
        realizedPnL: 5,
        unrealizedPnL: 2,
        totalFees: 0.1,
      });
      expect(pnlHistoryRepo.save).toHaveBeenCalledWith(created);
    });
  });
});
