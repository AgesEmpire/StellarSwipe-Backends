import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Trade, TradeSide, TradeStatus } from '../../trades/entities/trade.entity';
import { PortfolioSnapshotService } from './portfolio-snapshot.service';
import { PortfolioSnapshot } from '../entities/portfolio-snapshot.entity';
import { PnlCalculatorService } from './pnl-calculator.service';
import { PriceService } from '../../shared/price.service';

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
    status: TradeStatus.PENDING,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }) as any;

describe('PortfolioSnapshotService', () => {
  let service: PortfolioSnapshotService;
  let tradeRepository: any;
  let snapshotRepository: any;
  let priceService: any;
  let pnlCalculator: any;
  let cacheManager: any;

  beforeEach(async () => {
    tradeRepository = { find: jest.fn() };
    snapshotRepository = {
      create: jest.fn((input) => input),
      save: jest.fn(async (input) => input),
      findOne: jest.fn(),
    };
    priceService = { getMultiplePrices: jest.fn() };
    pnlCalculator = {
      calculatePortfolioPnl: jest.fn(),
      calculateUnrealizedPnL: jest.fn(),
    };
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioSnapshotService,
        { provide: getRepositoryToken(Trade), useValue: tradeRepository },
        { provide: getRepositoryToken(PortfolioSnapshot), useValue: snapshotRepository },
        { provide: PnlCalculatorService, useValue: pnlCalculator },
        { provide: PriceService, useValue: priceService },
        { provide: CACHE_MANAGER, useValue: cacheManager },
      ],
    }).compile();

    service = module.get(PortfolioSnapshotService);
  });

  it('computes unrealized pnl for open positions', async () => {
    tradeRepository.find.mockResolvedValue([mockTrade({ status: TradeStatus.PENDING })]);
    priceService.getMultiplePrices.mockResolvedValue({ 'XLM/USDC': 0.15 });
    pnlCalculator.calculatePortfolioPnl.mockReturnValue({
      realizedPnL: 0,
      unrealizedPnL: 5,
      totalFees: 0,
      bySignal: {},
      byAsset: {},
      missingPrices: [],
    });

    const snapshot = await service.computeSnapshotForUser('user-1');

    expect(snapshot.realizedPnl).toBe('0.00000000');
    expect(snapshot.unrealizedPnl).toBe('5.00000000');
    expect(snapshot.portfolioValue).toBe('15.00000000');
    expect(snapshotRepository.save).toHaveBeenCalled();
  });

  it('computes realized pnl for closed positions', async () => {
    tradeRepository.find.mockResolvedValue([
      mockTrade({
        status: TradeStatus.COMPLETED,
        exitPrice: '0.20',
        profitLoss: '10',
        closedAt: new Date('2024-01-02T00:00:00.000Z'),
      }),
    ]);
    priceService.getMultiplePrices.mockResolvedValue({});
    pnlCalculator.calculatePortfolioPnl.mockReturnValue({
      realizedPnL: 10,
      unrealizedPnL: 0,
      totalFees: 0,
      bySignal: {},
      byAsset: {},
      missingPrices: [],
    });

    const snapshot = await service.computeSnapshotForUser('user-1');

    expect(snapshot.realizedPnl).toBe('10.00000000');
    expect(snapshot.unrealizedPnl).toBe('0.00000000');
    expect(snapshot.portfolioValue).toBe('0.00000000');
  });

  it('aggregates mixed assets and open/closed positions', async () => {
    tradeRepository.find.mockResolvedValue([
      mockTrade({ id: 't1', status: TradeStatus.COMPLETED, exitPrice: '0.20', profitLoss: '10' }),
      mockTrade({ id: 't2', status: TradeStatus.PENDING, baseAsset: 'BTC', counterAsset: 'USDC', amount: '1', entryPrice: '10000' }),
    ]);
    priceService.getMultiplePrices.mockResolvedValue({ 'BTC/USDC': 10500 });
    pnlCalculator.calculatePortfolioPnl.mockReturnValue({
      realizedPnL: 10,
      unrealizedPnL: 500,
      totalFees: 0,
      bySignal: {},
      byAsset: {},
      missingPrices: [],
    });

    const snapshot = await service.computeSnapshotForUser('user-1');

    expect(snapshot.realizedPnl).toBe('10.00000000');
    expect(snapshot.unrealizedPnl).toBe('500.00000000');
    expect(snapshot.totalPnl).toBe('510.00000000');
    expect(snapshot.portfolioValue).toBe('10500.00000000');
  });
});
