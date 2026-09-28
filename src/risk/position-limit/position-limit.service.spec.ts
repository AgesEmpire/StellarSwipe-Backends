import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnprocessableEntityException } from '@nestjs/common';
import { PositionLimitService, POSITION_LIMIT_EXCEEDED } from './position-limit.service';
import { Trade, TradeStatus } from '../../trades/entities/trade.entity';

describe('PositionLimitService', () => {
  let service: PositionLimitService;
  let mockTradeRepository: { find: jest.Mock };

  const openTrade = (amount: string, entryPrice: string) => ({
    amount,
    entryPrice,
    status: TradeStatus.PENDING,
  });

  beforeEach(async () => {
    mockTradeRepository = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionLimitService,
        { provide: getRepositoryToken(Trade), useValue: mockTradeRepository },
      ],
    }).compile();

    service = module.get<PositionLimitService>(PositionLimitService);

    // Reset env overrides between tests
    delete process.env.MAX_EXPOSURE_USD;
    delete process.env.PAIR_LIMITS;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getOpenExposureUSD', () => {
    it('returns 0 when no open trades exist', async () => {
      mockTradeRepository.find.mockResolvedValue([]);
      expect(await service.getOpenExposureUSD('user-1', 'XLM/USDC')).toBe(0);
    });

    it('sums amount × entryPrice across open trades', async () => {
      mockTradeRepository.find.mockResolvedValue([
        openTrade('100', '0.10'),
        openTrade('50', '0.20'),
      ]);
      expect(await service.getOpenExposureUSD('user-1', 'XLM/USDC')).toBe(20);
    });
  });

  describe('enforce', () => {
    it('passes when total exposure is under the limit', async () => {
      mockTradeRepository.find.mockResolvedValue([openTrade('100', '10')]); // $1000 existing
      process.env.MAX_EXPOSURE_USD = '5000';
      await expect(service.enforce('user-1', 'XLM/USDC', 500)).resolves.toBeUndefined();
    });

    it('passes when total exposure equals the limit exactly', async () => {
      mockTradeRepository.find.mockResolvedValue([openTrade('90', '100')]); // $9000
      process.env.MAX_EXPOSURE_USD = '10000';
      await expect(service.enforce('user-1', 'XLM/USDC', 1000)).resolves.toBeUndefined();
    });

    it('throws POSITION_LIMIT_EXCEEDED when limit is breached', async () => {
      mockTradeRepository.find.mockResolvedValue([openTrade('100', '100')]); // $10000
      process.env.MAX_EXPOSURE_USD = '10000';
      await expect(service.enforce('user-1', 'XLM/USDC', 1)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('attaches POSITION_LIMIT_EXCEEDED code to the error', async () => {
      mockTradeRepository.find.mockResolvedValue([openTrade('200', '100')]); // $20000
      process.env.MAX_EXPOSURE_USD = '10000';
      try {
        await service.enforce('user-1', 'XLM/USDC', 1);
        fail('expected error');
      } catch (err: any) {
        expect(err.code).toBe(POSITION_LIMIT_EXCEEDED);
      }
    });

    it('respects per-pair limit override when set', async () => {
      mockTradeRepository.find.mockResolvedValue([openTrade('100', '100')]); // $10000
      process.env.MAX_EXPOSURE_USD = '100000';
      process.env.PAIR_LIMITS = JSON.stringify({ 'XLM/USDC': 10000 });
      // New order of $1 puts us over the pair-specific $10000 cap
      await expect(service.enforce('user-1', 'XLM/USDC', 1)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('enforces correctly across repeated trade attempts', async () => {
      process.env.MAX_EXPOSURE_USD = '5000';
      // First call: $3000 existing, $1500 new → pass
      mockTradeRepository.find.mockResolvedValueOnce([openTrade('300', '10')]); // $3000
      await expect(service.enforce('user-1', 'XLM/USDC', 1500)).resolves.toBeUndefined();
      // Second call: same existing, $2001 new → breach
      mockTradeRepository.find.mockResolvedValueOnce([openTrade('300', '10')]); // $3000
      await expect(service.enforce('user-1', 'XLM/USDC', 2001)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });
});
