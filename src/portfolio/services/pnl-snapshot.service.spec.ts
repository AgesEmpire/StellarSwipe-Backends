import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Trade, TradeStatus } from '../../trades/entities/trade.entity';
import { PnlHistory } from '../entities/pnl-history.entity';
import { PnlSnapshotService } from './pnl-snapshot.service';
import { PnlCalculatorService } from './pnl-calculator.service';
import { PriceService } from '../../shared/price.service';

const trade = (overrides: Partial<Trade> = {}): Trade => ({
  userId: 'user-1',
  baseAsset: 'XLM',
  counterAsset: 'USDC',
  amount: '100',
  entryPrice: '0.10',
  status: TradeStatus.PENDING,
  createdAt: new Date('2026-08-18T10:00:00.000Z'),
  ...overrides,
} as Trade);

describe('PnlSnapshotService', () => {
  const tradeRepository = { find: jest.fn() };
  const pnlHistoryRepository = {
    createQueryBuilder: jest.fn(),
    delete: jest.fn(),
  };
  const pnlCalculator = { calculatePortfolioPnl: jest.fn() };
  const priceService = { getMultiplePrices: jest.fn() };
  const configService = { get: jest.fn((_: string, fallback: unknown) => fallback) };
  let service: PnlSnapshotService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const insertQuery = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };
    pnlHistoryRepository.createQueryBuilder.mockReturnValue(insertQuery);
    pnlHistoryRepository.delete.mockResolvedValue({ affected: 2 });
    priceService.getMultiplePrices.mockResolvedValue({ 'XLM/USDC': 0.12 });
    pnlCalculator.calculatePortfolioPnl.mockReturnValue({
      realizedPnL: 1,
      unrealizedPnL: 2,
      totalFees: 0.1,
      byAsset: { 'XLM/USDC': { realizedPnL: 1, unrealizedPnL: 2, totalFees: 0.1 } },
    });

    const module = await Test.createTestingModule({
      providers: [
        PnlSnapshotService,
        { provide: getRepositoryToken(Trade), useValue: tradeRepository },
        { provide: getRepositoryToken(PnlHistory), useValue: pnlHistoryRepository },
        { provide: PnlCalculatorService, useValue: pnlCalculator },
        { provide: PriceService, useValue: priceService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
    service = module.get(PnlSnapshotService);
  });

  it('processes only users with open positions in batches', async () => {
    tradeRepository.find
      .mockResolvedValueOnce([trade({ userId: 'user-1' }), trade({ userId: 'user-1' }), trade({ userId: 'user-2' })])
      .mockResolvedValueOnce([trade({ userId: 'user-1' })])
      .mockResolvedValueOnce([trade({ userId: 'user-2' })]);

    const result = await service.runHourlySnapshot();

    expect(result.usersProcessed).toBe(2);
    expect(result.snapshotsWritten).toBe(2);
    expect(pnlHistoryRepository.createQueryBuilder).toHaveBeenCalled();
  });

  it('writes asset-level rows with the same timestamp for one run', async () => {
    tradeRepository.find
      .mockResolvedValueOnce([trade()])
      .mockResolvedValueOnce([trade()]);

    await service.runHourlySnapshot();

    const query = pnlHistoryRepository.createQueryBuilder.mock.results[0].value;
    const rows = query.values.mock.calls[0][0];
    expect(rows[0]).toMatchObject({ userId: 'user-1', assetSymbol: 'XLM/USDC' });
    expect(rows[0].snapshotDate).toBeInstanceOf(Date);
  });

  it('deletes rows older than the configured retention window', async () => {
    tradeRepository.find.mockResolvedValueOnce([]);
    await service.runHourlySnapshot();
    expect(pnlHistoryRepository.delete).toHaveBeenCalledWith(expect.objectContaining({ snapshotDate: expect.any(Object) }));
  });

  it('records a user-level error and continues the run', async () => {
    tradeRepository.find
      .mockResolvedValueOnce([trade({ userId: 'user-1' }), trade({ userId: 'user-2' })])
      .mockRejectedValueOnce(new Error('price provider unavailable'))
      .mockResolvedValueOnce([trade({ userId: 'user-2' })]);

    const result = await service.runHourlySnapshot();

    expect(result.usersProcessed).toBe(2);
    expect(result.lastError).toBeUndefined();
    expect(result.snapshotsWritten).toBe(1);
  });

  it('does not start a second run while one is active', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    tradeRepository.find.mockImplementationOnce(async () => {
      await gate;
      return [];
    });

    const first = service.runHourlySnapshot();
    const second = await service.runHourlySnapshot();
    expect(second.inProgress).toBe(true);
    release();
    await first;
  });

  it('exposes safe operational status without repository access', () => {
    expect(service.getStatus()).toEqual(expect.objectContaining({
      inProgress: false,
      usersProcessed: 0,
      snapshotsWritten: 0,
    }));
  });
});
