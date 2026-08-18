import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { TradeDlqService } from './trade-dlq.service';
import { Trade, TradeStatus, TradeSide } from '../entities/trade.entity';
import { DeadLetterService } from '../../jobs/dead-letter.service';
import { NotificationService } from '../../notifications/notification.service';
import { NotificationChannel } from '../../notifications/entities/notification.entity';
import { createMockRepository } from '../../../test/utils/test-helpers';

const mockTrade = (overrides: Partial<Trade> = {}): Trade =>
  ({
    id: 'trade-001',
    userId: 'user-001',
    signalId: 'signal-001',
    status: TradeStatus.FAILED,
    side: TradeSide.BUY,
    baseAsset: 'XLM',
    counterAsset: 'USDC',
    entryPrice: '0.10',
    amount: '1000',
    totalValue: '100',
    feeAmount: '0.01',
    errorMessage: 'Soroban contract call timed out',
    metadata: {
      dlq: {
        jobId: 'job-001',
        attemptsMade: 3,
        failedAt: '2024-06-01T12:00:00.000Z',
        failedReason: 'Soroban contract call timed out',
      },
    },
    createdAt: new Date('2024-06-01T10:00:00.000Z'),
    updatedAt: new Date('2024-06-01T12:00:00.000Z'),
    ...overrides,
  }) as any;

const mockJob = (overrides: Partial<any> = {}) => ({
  id: 'job-001',
  data: { tradeId: 'trade-001', userId: 'user-001' },
  attemptsMade: 3,
  opts: { attempts: 3 },
  queue: { name: 'transactions' },
  ...overrides,
});

describe('TradeDlqService', () => {
  let service: TradeDlqService;
  let mockRepository: any;
  let mockQueue: any;
  let mockDeadLetterService: any;
  let mockNotificationService: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockRepository = createMockRepository();
    mockRepository.createQueryBuilder = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      select: jest.fn().mockReturnThis(),
    }));

    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'new-job-001' }),
    };

    mockDeadLetterService = {
      capture: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
      discard: jest.fn().mockResolvedValue(undefined),
    };

    mockNotificationService = {
      send: jest.fn().mockResolvedValue({ id: 'notif-001' }),
    };

    mockConfigService = {
      get: jest.fn((key: string, def: unknown) => {
        const map: Record<string, unknown> = {
          'dlq.maxRetryAttempts': 5,
          'dlq.retryCooldownMs': 60000,
        };
        return map[key] ?? def;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeDlqService,
        { provide: getRepositoryToken(Trade), useValue: mockRepository },
        { provide: 'BullQueue_transactions', useValue: mockQueue },
        { provide: DeadLetterService, useValue: mockDeadLetterService },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(TradeDlqService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── handleFailedJob ────────────────────────────────────────────────────────

  describe('handleFailedJob', () => {
    it('should update trade to FAILED status and store error details', async () => {
      const trade = mockTrade({ status: TradeStatus.EXECUTING });
      mockRepository.findOne.mockResolvedValue(trade);
      mockRepository.save.mockResolvedValue(trade);

      const job = mockJob();
      const error = new Error('Network timeout');

      await service.handleFailedJob(job, error);

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'trade-001' },
      });
      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TradeStatus.FAILED,
          errorMessage: 'Network timeout',
        }),
      );
    });

    it('should store DLQ metadata including jobId, attemptsMade, and failedAt', async () => {
      const trade = mockTrade({ status: TradeStatus.EXECUTING, metadata: {} });
      mockRepository.findOne.mockResolvedValue(trade);
      mockRepository.save.mockResolvedValue(trade);

      const job = mockJob({ attemptsMade: 5 });
      const error = new Error('Contract call failed');

      await service.handleFailedJob(job, error);

      const savedTrade = mockRepository.save.mock.calls[0][0];
      expect(savedTrade.metadata.dlq).toBeDefined();
      expect(savedTrade.metadata.dlq.jobId).toBe('job-001');
      expect(savedTrade.metadata.dlq.attemptsMade).toBe(5);
      expect(savedTrade.metadata.dlq.failedReason).toBe('Contract call failed');
      expect(savedTrade.metadata.dlq.failedAt).toBeDefined();
    });

    it('should capture the job to the dead letter queue', async () => {
      const trade = mockTrade({ status: TradeStatus.EXECUTING });
      mockRepository.findOne.mockResolvedValue(trade);
      mockRepository.save.mockResolvedValue(trade);

      const job = mockJob();
      const error = new Error('Test error');

      await service.handleFailedJob(job, error);

      expect(mockDeadLetterService.capture).toHaveBeenCalledWith(job, error);
    });

    it('should send failure notification to the trade owner', async () => {
      const trade = mockTrade({
        status: TradeStatus.EXECUTING,
        userId: 'user-xyz',
        baseAsset: 'BTC',
        counterAsset: 'USDC',
        amount: '0.5',
        side: TradeSide.SELL,
      });
      mockRepository.findOne.mockResolvedValue(trade);
      mockRepository.save.mockResolvedValue(trade);

      const job = mockJob({ attemptsMade: 3 });
      const error = new Error('Insufficient balance');

      await service.handleFailedJob(job, error);

      expect(mockNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-xyz',
          type: 'TRADE_EXECUTED',
          title: 'Trade Failed',
          channel: NotificationChannel.IN_APP,
        }),
      );

      const notification = mockNotificationService.send.mock.calls[0][0];
      expect(notification.message).toContain('SELL');
      expect(notification.message).toContain('BTC/USDC');
      expect(notification.message).toContain('Insufficient balance');
      expect(notification.metadata.tradeId).toBe(trade.id);
    });

    it('should skip trade update when job has no tradeId', async () => {
      const job = mockJob({ data: {} });
      const error = new Error('No trade ID');

      await service.handleFailedJob(job, error);

      expect(mockRepository.findOne).not.toHaveBeenCalled();
      expect(mockDeadLetterService.capture).toHaveBeenCalledWith(job, error);
    });

    it('should capture to DLQ when trade is not found in database', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const job = mockJob();
      const error = new Error('Test error');

      await service.handleFailedJob(job, error);

      expect(mockDeadLetterService.capture).toHaveBeenCalledWith(job, error);
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('should not throw when notification sending fails', async () => {
      const trade = mockTrade({ status: TradeStatus.EXECUTING });
      mockRepository.findOne.mockResolvedValue(trade);
      mockRepository.save.mockResolvedValue(trade);
      mockNotificationService.send.mockRejectedValue(
        new Error('Notification service unavailable'),
      );

      const job = mockJob();
      const error = new Error('Test error');

      await expect(
        service.handleFailedJob(job, error),
      ).resolves.not.toThrow();
    });
  });

  // ── retryTrade ─────────────────────────────────────────────────────────────

  describe('retryTrade', () => {
    it('should re-enqueue the trade and transition to PENDING', async () => {
      const trade = mockTrade({ metadata: { dlq: { failedReason: 'timeout' } } });
      mockRepository.findOne.mockResolvedValue(trade);
      mockRepository.save.mockResolvedValue(trade);

      const result = await service.retryTrade('trade-001', 'user-001');

      expect(result.tradeId).toBe('trade-001');
      expect(result.newJobId).toBe('new-job-001');
      expect(result.status).toBe(TradeStatus.PENDING);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'execute-trade',
        expect.objectContaining({ tradeId: 'trade-001', isRetry: true }),
        expect.objectContaining({ priority: 100, attempts: 3 }),
      );
    });

    it('should record retry in trade metadata history', async () => {
      const trade = mockTrade({ metadata: { dlq: { failedReason: 'timeout' } } });
      mockRepository.findOne.mockResolvedValue(trade);
      mockRepository.save.mockResolvedValue(trade);

      await service.retryTrade('trade-001', 'user-001');

      const savedTrade = mockRepository.save.mock.calls[0][0];
      expect(savedTrade.metadata.retryHistory).toBeDefined();
      expect(savedTrade.metadata.retryHistory.length).toBe(1);
      expect(savedTrade.metadata.retryHistory[0].previousError).toBe('timeout');
      expect(savedTrade.metadata.retryHistory[0].newJobId).toBe('new-job-001');
    });

    it('should clear error message and DLQ metadata after retry', async () => {
      const trade = mockTrade();
      mockRepository.findOne.mockResolvedValue(trade);
      mockRepository.save.mockResolvedValue(trade);

      await service.retryTrade('trade-001', 'user-001');

      const savedTrade = mockRepository.save.mock.calls[0][0];
      expect(savedTrade.errorMessage).toBeUndefined();
      expect(savedTrade.metadata.dlq).toBeUndefined();
    });

    it('should throw NotFoundException when trade does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.retryTrade('nonexistent', 'user-001'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user does not own the trade', async () => {
      const trade = mockTrade({ userId: 'other-user' });
      mockRepository.findOne.mockResolvedValue(trade);

      await expect(
        service.retryTrade('trade-001', 'user-001'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when trade is not in FAILED status', async () => {
      const trade = mockTrade({ status: TradeStatus.PENDING });
      mockRepository.findOne.mockResolvedValue(trade);

      await expect(
        service.retryTrade('trade-001', 'user-001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when max retries exceeded', async () => {
      const retryHistory = Array.from({ length: 5 }, (_, i) => ({
        retriedAt: new Date(Date.now() - (5 - i) * 120000).toISOString(),
        newJobId: `job-${i}`,
      }));
      const trade = mockTrade({ metadata: { retryHistory } });
      mockRepository.findOne.mockResolvedValue(trade);

      await expect(
        service.retryTrade('trade-001', 'user-001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should include original trade data in retry job', async () => {
      const trade = mockTrade({
        signalId: 'sig-999',
        side: TradeSide.SELL,
        baseAsset: 'ETH',
        counterAsset: 'USDC',
        entryPrice: '3500.00',
        amount: '2.5',
        totalValue: '8750.00',
        stopLossPrice: '3200.00',
        takeProfitPrice: '4000.00',
        metadata: { dlq: { failedReason: 'test' } },
      });
      mockRepository.findOne.mockResolvedValue(trade);
      mockRepository.save.mockResolvedValue(trade);

      await service.retryTrade('trade-001', 'user-001');

      const jobData = mockQueue.add.mock.calls[0][1];
      expect(jobData.signalId).toBe('sig-999');
      expect(jobData.side).toBe(TradeSide.SELL);
      expect(jobData.baseAsset).toBe('ETH');
      expect(jobData.counterAsset).toBe('USDC');
      expect(jobData.amount).toBe('2.5');
      expect(jobData.stopLossPrice).toBe('3200.00');
      expect(jobData.takeProfitPrice).toBe('4000.00');
    });
  });

  // ── bulkRetry ──────────────────────────────────────────────────────────────

  describe('bulkRetry', () => {
    it('should retry multiple trades and return combined results', async () => {
      const trade1 = mockTrade({ id: 'trade-001', metadata: { dlq: { failedReason: 'err1' } } });
      const trade2 = mockTrade({ id: 'trade-002', metadata: { dlq: { failedReason: 'err2' } } });
      mockRepository.findOne
        .mockResolvedValueOnce(trade1)
        .mockResolvedValueOnce(trade1) // canRetry check
        .mockResolvedValueOnce(trade2)
        .mockResolvedValueOnce(trade2); // canRetry check
      mockRepository.save.mockResolvedValue({});

      const result = await service.bulkRetry(
        ['trade-001', 'trade-002'],
        'user-001',
      );

      expect(result.totalRequested).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(result.results).toHaveLength(2);
    });

    it('should handle partial failures in bulk retry', async () => {
      const trade1 = mockTrade({ id: 'trade-001', metadata: { dlq: { failedReason: 'err1' } } });
      mockRepository.findOne
        .mockResolvedValueOnce(trade1) // retryTrade findOne
        .mockResolvedValueOnce(trade1) // canRetry findOne
        .mockResolvedValueOnce(null);  // second trade not found
      mockRepository.save.mockResolvedValue({});

      const result = await service.bulkRetry(
        ['trade-001', 'nonexistent'],
        'user-001',
      );

      expect(result.totalRequested).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
    });

    it('should handle empty trade IDs array gracefully', async () => {
      const result = await service.bulkRetry([], 'user-001');

      expect(result.totalRequested).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
    });
  });

  // ── getFailedJobs ──────────────────────────────────────────────────────────

  describe('getFailedJobs', () => {
    it('should return a summary of failed trade jobs from DLQ', async () => {
      mockDeadLetterService.list.mockResolvedValue([
        {
          id: 'dlq-1',
          data: {
            queue: 'transactions',
            jobId: 'job-1',
            data: { tradeId: 'trade-1', userId: 'user-1' },
            failedReason: 'timeout',
            attemptsMade: 3,
            failedAt: '2024-06-01T12:00:00.000Z',
          },
        },
        {
          id: 'dlq-2',
          data: {
            queue: 'transactions',
            jobId: 'job-2',
            data: { tradeId: 'trade-2', userId: 'user-2' },
            failedReason: 'balance insufficient',
            attemptsMade: 3,
            failedAt: '2024-06-01T13:00:00.000Z',
          },
        },
      ]);

      const result = await service.getFailedJobs(10);

      expect(result.totalFailed).toBe(2);
      expect(result.recentJobs).toHaveLength(2);
      // Should be sorted by failedAt descending
      expect(result.recentJobs[0].tradeId).toBe('trade-2');
      expect(result.recentJobs[1].tradeId).toBe('trade-1');
    });

    it('should filter out non-transaction queue jobs', async () => {
      mockDeadLetterService.list.mockResolvedValue([
        {
          id: 'dlq-1',
          data: { queue: 'transactions', failedReason: 'err' },
        },
        {
          id: 'dlq-2',
          data: { queue: 'notifications', failedReason: 'err' },
        },
      ]);

      const result = await service.getFailedJobs(10);

      expect(result.totalFailed).toBe(1);
    });

    it('should respect the limit parameter', async () => {
      const jobs = Array.from({ length: 20 }, (_, i) => ({
        id: `dlq-${i}`,
        data: {
          queue: 'transactions',
          data: { tradeId: `t-${i}` },
          failedAt: new Date(Date.now() - i * 60000).toISOString(),
        },
      }));
      mockDeadLetterService.list.mockResolvedValue(jobs);

      const result = await service.getFailedJobs(5);

      expect(result.totalFailed).toBe(20);
      expect(result.recentJobs).toHaveLength(5);
    });

    it('should return empty summary when no failed jobs exist', async () => {
      mockDeadLetterService.list.mockResolvedValue([]);

      const result = await service.getFailedJobs(10);

      expect(result.totalFailed).toBe(0);
      expect(result.recentJobs).toHaveLength(0);
    });
  });

  // ── getFailedJobsCount ─────────────────────────────────────────────────────

  describe('getFailedJobsCount', () => {
    it('should return the count of transaction-queue DLQ entries', async () => {
      mockDeadLetterService.list.mockResolvedValue([
        { id: '1', data: { queue: 'transactions' } },
        { id: '2', data: { queue: 'transactions' } },
        { id: '3', data: { queue: 'notifications' } },
      ]);

      const count = await service.getFailedJobsCount();

      expect(count).toBe(2);
    });
  });

  // ── getFailedTradesByUser ──────────────────────────────────────────────────

  describe('getFailedTradesByUser', () => {
    it('should return failed trades for a specific user', async () => {
      const trades = [
        mockTrade({ id: 'trade-1' }),
        mockTrade({ id: 'trade-2' }),
      ];
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([trades, 2]),
      };
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getFailedTradesByUser('user-001');

      expect(result.userId).toBe('user-001');
      expect(result.totalFailed).toBe(2);
      expect(result.trades).toHaveLength(2);
    });

    it('should return empty list when user has no failed trades', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getFailedTradesByUser('user-002');

      expect(result.totalFailed).toBe(0);
      expect(result.trades).toHaveLength(0);
    });

    it('should apply baseAsset filter when provided', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getFailedTradesByUser(
        'user-001', 1, 20, 'updatedAt', 'DESC', 'XLM',
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'trade.baseAsset = :baseAsset',
        { baseAsset: 'XLM' },
      );
    });

    it('should apply error filter when provided', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getFailedTradesByUser(
        'user-001', 1, 20, 'updatedAt', 'DESC', undefined, 'timeout',
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'trade.errorMessage ILIKE :errorFilter',
        { errorFilter: '%timeout%' },
      );
    });

    it('should include retry count and canRetry flag per trade', async () => {
      const trade = mockTrade({
        metadata: {
          dlq: { failedAt: '2024-01-01T00:00:00Z', failedReason: 'err' },
          retryHistory: [
            { retriedAt: '2024-01-01T01:00:00Z', newJobId: 'j1' },
            { retriedAt: '2024-01-01T02:00:00Z', newJobId: 'j2' },
          ],
        },
      });
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[trade], 1]),
      };
      mockRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getFailedTradesByUser('user-001');

      expect(result.trades[0].retryCount).toBe(2);
      expect(result.trades[0].canRetry).toBe(true);
    });
  });

  // ── getFailedTradeStats ────────────────────────────────────────────────────

  describe('getFailedTradeStats', () => {
    it('should return aggregate failure statistics', async () => {
      mockRepository.find.mockResolvedValue([
        mockTrade({ errorMessage: 'Network timeout', updatedAt: new Date() }),
        mockTrade({ errorMessage: 'Insufficient balance', updatedAt: new Date() }),
        mockTrade({
          errorMessage: 'Network error',
          updatedAt: new Date(),
          metadata: { retryHistory: [{ retriedAt: new Date().toISOString() }] },
        }),
      ]);
      mockDeadLetterService.list.mockResolvedValue([
        { data: { queue: 'transactions' } },
      ]);

      const result = await service.getFailedTradeStats();

      expect(result.totalFailed).toBe(3);
      expect(result.totalRetried).toBe(1);
      expect(result.byErrorType.length).toBeGreaterThan(0);
      expect(result.byTimePeriod.length).toBe(4);
      expect(result.currentDlqDepth).toBe(1);
    });

    it('should categorize errors correctly', async () => {
      mockRepository.find.mockResolvedValue([
        mockTrade({ errorMessage: 'Soroban contract reverted', updatedAt: new Date() }),
        mockTrade({ errorMessage: 'RPC endpoint unavailable', updatedAt: new Date() }),
        mockTrade({ errorMessage: 'Something unexpected', updatedAt: new Date() }),
      ]);
      mockDeadLetterService.list.mockResolvedValue([]);

      const result = await service.getFailedTradeStats();

      const categories = result.byErrorType.map((e) => e.errorType);
      expect(categories).toContain('Smart Contract Error');
      expect(categories).toContain('RPC/Horizon Error');
      expect(categories).toContain('Other');
    });

    it('should handle empty results', async () => {
      mockRepository.find.mockResolvedValue([]);
      mockDeadLetterService.list.mockResolvedValue([]);

      const result = await service.getFailedTradeStats();

      expect(result.totalFailed).toBe(0);
      expect(result.totalRetried).toBe(0);
      expect(result.byErrorType).toHaveLength(0);
    });
  });

  // ── discardFailedJob ───────────────────────────────────────────────────────

  describe('discardFailedJob', () => {
    it('should mark trade as discarded and remove DLQ entry', async () => {
      const trade = mockTrade();
      mockRepository.findOne.mockResolvedValue(trade);
      mockRepository.save.mockResolvedValue(trade);
      mockDeadLetterService.list.mockResolvedValue([
        {
          id: 'dlq-1',
          data: { data: { tradeId: 'trade-001' }, queue: 'transactions' },
        },
      ]);

      const result = await service.discardFailedJob('trade-001', 'admin-001');

      expect(result.tradeId).toBe('trade-001');
      expect(result.discardedBy).toBe('admin-001');
      expect(mockDeadLetterService.discard).toHaveBeenCalledWith('dlq-1');
      const savedTrade = mockRepository.save.mock.calls[0][0];
      expect(savedTrade.metadata.discarded).toBeDefined();
      expect(savedTrade.metadata.discarded.discardedBy).toBe('admin-001');
    });

    it('should throw NotFoundException when trade does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.discardFailedJob('nonexistent', 'admin-001'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when trade is not FAILED', async () => {
      const trade = mockTrade({ status: TradeStatus.COMPLETED });
      mockRepository.findOne.mockResolvedValue(trade);

      await expect(
        service.discardFailedJob('trade-001', 'admin-001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed even when no matching DLQ entry exists', async () => {
      const trade = mockTrade();
      mockRepository.findOne.mockResolvedValue(trade);
      mockRepository.save.mockResolvedValue(trade);
      mockDeadLetterService.list.mockResolvedValue([]);

      const result = await service.discardFailedJob('trade-001', 'admin-001');

      expect(result.tradeId).toBe('trade-001');
      expect(mockDeadLetterService.discard).not.toHaveBeenCalled();
    });
  });

  // ── getRetryHistory ────────────────────────────────────────────────────────

  describe('getRetryHistory', () => {
    it('should return retry history entries from trade metadata', async () => {
      const trade = mockTrade({
        metadata: {
          retryHistory: [
            { retriedAt: '2024-01-01T01:00:00Z', previousError: 'timeout', newJobId: 'j1' },
            { retriedAt: '2024-01-01T02:00:00Z', previousError: 'network', newJobId: 'j2' },
          ],
        },
      });
      mockRepository.findOne.mockResolvedValue(trade);

      const result = await service.getRetryHistory('trade-001', 'user-001');

      expect(result.tradeId).toBe('trade-001');
      expect(result.totalRetries).toBe(2);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].previousError).toBe('timeout');
      expect(result.entries[1].newJobId).toBe('j2');
    });

    it('should return empty history when no retries exist', async () => {
      const trade = mockTrade({ metadata: {} });
      mockRepository.findOne.mockResolvedValue(trade);

      const result = await service.getRetryHistory('trade-001', 'user-001');

      expect(result.totalRetries).toBe(0);
      expect(result.entries).toHaveLength(0);
    });

    it('should throw NotFoundException when trade not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getRetryHistory('nonexistent', 'user-001'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user does not own trade', async () => {
      const trade = mockTrade({ userId: 'other-user' });
      mockRepository.findOne.mockResolvedValue(trade);

      await expect(
        service.getRetryHistory('trade-001', 'user-001'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── canRetry ───────────────────────────────────────────────────────────────

  describe('canRetry', () => {
    it('should return canRetry=true for a retryable FAILED trade', async () => {
      const trade = mockTrade({ metadata: {} });
      mockRepository.findOne.mockResolvedValue(trade);

      const result = await service.canRetry('trade-001', 'user-001');

      expect(result.canRetry).toBe(true);
    });

    it('should return canRetry=false when trade not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.canRetry('nonexistent', 'user-001');

      expect(result.canRetry).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('should return canRetry=false when user does not own trade', async () => {
      const trade = mockTrade({ userId: 'other-user' });
      mockRepository.findOne.mockResolvedValue(trade);

      const result = await service.canRetry('trade-001', 'user-001');

      expect(result.canRetry).toBe(false);
      expect(result.reason).toContain('do not own');
    });

    it('should return canRetry=false when trade is not FAILED', async () => {
      const trade = mockTrade({ status: TradeStatus.PENDING });
      mockRepository.findOne.mockResolvedValue(trade);

      const result = await service.canRetry('trade-001', 'user-001');

      expect(result.canRetry).toBe(false);
      expect(result.reason).toContain('not FAILED');
    });

    it('should return canRetry=false when max retries exceeded', async () => {
      const retryHistory = Array.from({ length: 5 }, (_, i) => ({
        retriedAt: new Date(Date.now() - (5 - i) * 120000).toISOString(),
        newJobId: `job-${i}`,
      }));
      const trade = mockTrade({ metadata: { retryHistory } });
      mockRepository.findOne.mockResolvedValue(trade);

      const result = await service.canRetry('trade-001', 'user-001');

      expect(result.canRetry).toBe(false);
      expect(result.reason).toContain('Maximum retry attempts');
    });

    it('should return canRetry=false during cooldown period', async () => {
      const trade = mockTrade({
        metadata: {
          retryHistory: [
            { retriedAt: new Date().toISOString(), newJobId: 'j1' },
          ],
        },
      });
      mockRepository.findOne.mockResolvedValue(trade);

      const result = await service.canRetry('trade-001', 'user-001');

      expect(result.canRetry).toBe(false);
      expect(result.reason).toContain('wait');
    });

    it('should return canRetry=false when trade is discarded', async () => {
      const trade = mockTrade({
        metadata: { discarded: { discardedBy: 'admin', discardedAt: new Date().toISOString() } },
      });
      mockRepository.findOne.mockResolvedValue(trade);

      const result = await service.canRetry('trade-001', 'user-001');

      expect(result.canRetry).toBe(false);
      expect(result.reason).toContain('discarded');
    });
  });
});
