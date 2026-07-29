import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TradeOutcomeService } from './trade-outcome.service';
import { Trade, TradeStatus, TradeSide } from './entities/trade.entity';

const mockTrade = (overrides: Partial<Trade> = {}): Trade => ({
  id: 'trade-1',
  userId: 'user-1',
  signalId: 'signal-1',
  status: TradeStatus.COMPLETED,
  side: TradeSide.BUY,
  baseAsset: 'XLM',
  counterAsset: 'USDC',
  entryPrice: '0.12',
  exitPrice: '0.15',
  amount: '100',
  totalValue: '12',
  feeAmount: '0.012',
  profitLoss: '3.00',
  profitLossPercentage: '25.00',
  transactionHash: 'abc123',
  sorobanContractId: null,
  errorMessage: undefined,
  executedAt: new Date(),
  closedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
} as Trade);

describe('TradeOutcomeService', () => {
  let service: TradeOutcomeService;
  const mockRepo = { findOne: jest.fn(), createQueryBuilder: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeOutcomeService,
        { provide: getRepositoryToken(Trade), useValue: mockRepo },
      ],
    }).compile();
    service = module.get(TradeOutcomeService);
    jest.clearAllMocks();
  });

  describe('getOutcome', () => {
    it('returns outcome for owner', async () => {
      mockRepo.findOne.mockResolvedValue(mockTrade());
      const result = await service.getOutcome('trade-1', 'user-1');
      expect(result.id).toBe('trade-1');
      expect(result.isFinal).toBe(true);
      expect(result.failureReason).toBeUndefined();
    });

    it('returns failure reason for failed trade', async () => {
      mockRepo.findOne.mockResolvedValue(
        mockTrade({ status: TradeStatus.FAILED, errorMessage: 'Insufficient liquidity' }),
      );
      const result = await service.getOutcome('trade-1', 'user-1');
      expect(result.status).toBe(TradeStatus.FAILED);
      expect(result.failureReason).toBe('Insufficient liquidity');
      expect(result.isFinal).toBe(true);
    });

    it('throws NotFoundException when trade not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.getOutcome('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for wrong user', async () => {
      mockRepo.findOne.mockResolvedValue(mockTrade());
      await expect(service.getOutcome('trade-1', 'other-user')).rejects.toThrow(ForbiddenException);
    });

    it('marks pending trade as non-final', async () => {
      mockRepo.findOne.mockResolvedValue(mockTrade({ status: TradeStatus.PENDING }));
      const result = await service.getOutcome('trade-1', 'user-1');
      expect(result.isFinal).toBe(false);
    });
  });

  describe('queryOutcomes', () => {
    const mockQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    };

    beforeEach(() => {
      mockRepo.createQueryBuilder.mockReturnValue(mockQb);
    });

    it('returns outcomes filtered by transactionId', async () => {
      mockQb.getMany.mockResolvedValue([mockTrade({ transactionHash: 'abc123' })]);
      const results = await service.queryOutcomes({ transactionId: 'abc123' }, 'user-1');
      expect(results).toHaveLength(1);
      expect(results[0].transactionHash).toBe('abc123');
    });

    it('throws ForbiddenException when querying another user', async () => {
      await expect(
        service.queryOutcomes({ userId: 'other-user' }, 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
