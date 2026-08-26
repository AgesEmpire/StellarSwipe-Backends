import { Test, TestingModule } from '@nestjs/testing';
import { TradeDlqController } from './trade-dlq.controller';
import { TradeDlqService } from './services/trade-dlq.service';
import { TradeDlqMetricsService } from './services/trade-dlq-metrics.service';
import { TradeDlqCleanupService } from './services/trade-dlq-cleanup.service';
import { TradeStatus } from './entities/trade.entity';

describe('TradeDlqController', () => {
  let controller: TradeDlqController;
  let mockDlqService: any;
  let mockMetricsService: any;
  let mockCleanupService: any;

  const mockReq = { user: { id: 'user-001' } };

  beforeEach(async () => {
    mockDlqService = {
      getFailedTradesByUser: jest.fn().mockResolvedValue({
        userId: 'user-001',
        totalFailed: 2,
        trades: [
          { tradeId: 't1', canRetry: true },
          { tradeId: 't2', canRetry: false },
        ],
      }),
      retryTrade: jest.fn().mockResolvedValue({
        tradeId: 'trade-001',
        newJobId: 'job-001',
        status: TradeStatus.PENDING,
        message: 'Trade re-enqueued',
      }),
      bulkRetry: jest.fn().mockResolvedValue({
        totalRequested: 2,
        successCount: 2,
        failureCount: 0,
        results: [],
      }),
      getRetryHistory: jest.fn().mockResolvedValue({
        tradeId: 'trade-001',
        totalRetries: 1,
        entries: [{ retriedAt: '2024-01-01T00:00:00Z', newJobId: 'j1' }],
      }),
      canRetry: jest.fn().mockResolvedValue({
        tradeId: 'trade-001',
        canRetry: true,
      }),
      getFailedJobs: jest.fn().mockResolvedValue({
        totalFailed: 5,
        recentJobs: [],
      }),
      getFailedTradeStats: jest.fn().mockResolvedValue({
        totalFailed: 10,
        totalRetried: 3,
        totalDiscarded: 1,
        byErrorType: [],
        byTimePeriod: [],
        currentDlqDepth: 6,
      }),
      discardFailedJob: jest.fn().mockResolvedValue({
        tradeId: 'trade-001',
        discardedBy: 'admin-001',
        discardedAt: '2024-01-01T00:00:00Z',
        message: 'Discarded',
      }),
    };

    mockMetricsService = {
      getMetrics: jest.fn().mockReturnValue({
        totalFailures: 100,
        totalRetries: 20,
        totalDiscards: 5,
        retrySuccessRate: 75,
        failureReasonDistribution: {},
        currentDlqDepth: 15,
        lastUpdated: '2024-01-01T00:00:00Z',
        uptimeMs: 3600000,
      }),
    };

    mockCleanupService = {
      getLastCleanupResult: jest.fn().mockReturnValue({
        result: {
          archivedCount: 10,
          dlqEntriesRemoved: 5,
          errors: [],
          durationMs: 1500,
        },
        runAt: '2024-01-01T03:00:00Z',
      }),
      getRetentionConfig: jest.fn().mockReturnValue({
        retentionDays: 90,
        cronExpression: '0 3 * * *',
      }),
      cleanupOldEntries: jest.fn().mockResolvedValue({
        archivedCount: 3,
        dlqEntriesRemoved: 2,
        errors: [],
        durationMs: 800,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TradeDlqController],
      providers: [
        { provide: TradeDlqService, useValue: mockDlqService },
        { provide: TradeDlqMetricsService, useValue: mockMetricsService },
        { provide: TradeDlqCleanupService, useValue: mockCleanupService },
      ],
    }).compile();

    controller = module.get(TradeDlqController);
  });

  afterEach(() => jest.clearAllMocks());

  // ── User endpoints ─────────────────────────────────────────────────────────

  describe('getUserFailedTrades', () => {
    it('should return user failed trades with default pagination', async () => {
      const result = await controller.getUserFailedTrades(mockReq, {});

      expect(mockDlqService.getFailedTradesByUser).toHaveBeenCalledWith(
        'user-001', 1, 20, 'updatedAt', 'DESC', undefined, undefined,
      );
      expect(result.userId).toBe('user-001');
      expect(result.totalFailed).toBe(2);
    });

    it('should pass query parameters through to service', async () => {
      await controller.getUserFailedTrades(mockReq, {
        page: 2,
        limit: 10,
        sortBy: 'amount',
        sortOrder: 'ASC',
        baseAsset: 'XLM',
        errorFilter: 'timeout',
      });

      expect(mockDlqService.getFailedTradesByUser).toHaveBeenCalledWith(
        'user-001', 2, 10, 'amount', 'ASC', 'XLM', 'timeout',
      );
    });

    it('should cap limit at 100', async () => {
      await controller.getUserFailedTrades(mockReq, { limit: 500 });

      expect(mockDlqService.getFailedTradesByUser).toHaveBeenCalledWith(
        'user-001', 1, 100, 'updatedAt', 'DESC', undefined, undefined,
      );
    });
  });

  describe('retryFailedTrade', () => {
    it('should delegate retry to service and return result', async () => {
      const result = await controller.retryFailedTrade('trade-001', mockReq);

      expect(mockDlqService.retryTrade).toHaveBeenCalledWith(
        'trade-001',
        'user-001',
      );
      expect(result.tradeId).toBe('trade-001');
      expect(result.status).toBe(TradeStatus.PENDING);
    });
  });

  describe('bulkRetryTrades', () => {
    it('should delegate bulk retry to service', async () => {
      const dto = { tradeIds: ['t1', 't2'] };

      const result = await controller.bulkRetryTrades(dto, mockReq);

      expect(mockDlqService.bulkRetry).toHaveBeenCalledWith(
        ['t1', 't2'],
        'user-001',
      );
      expect(result.totalRequested).toBe(2);
    });
  });

  describe('getRetryHistory', () => {
    it('should return retry history for a trade', async () => {
      const result = await controller.getRetryHistory('trade-001', mockReq);

      expect(mockDlqService.getRetryHistory).toHaveBeenCalledWith(
        'trade-001',
        'user-001',
      );
      expect(result.totalRetries).toBe(1);
    });
  });

  describe('checkCanRetry', () => {
    it('should return can-retry result', async () => {
      const result = await controller.checkCanRetry('trade-001', mockReq);

      expect(mockDlqService.canRetry).toHaveBeenCalledWith(
        'trade-001',
        'user-001',
      );
      expect(result.canRetry).toBe(true);
    });
  });

  // ── Admin endpoints ────────────────────────────────────────────────────────

  describe('getFailedJobs', () => {
    it('should return failed jobs summary with default limit', async () => {
      const result = await controller.getFailedJobs({});

      expect(mockDlqService.getFailedJobs).toHaveBeenCalledWith(10);
      expect(result.totalFailed).toBe(5);
    });

    it('should pass custom limit to service', async () => {
      await controller.getFailedJobs({ limit: 25 });

      expect(mockDlqService.getFailedJobs).toHaveBeenCalledWith(25);
    });
  });

  describe('getFailedJobStats', () => {
    it('should return aggregate failure statistics', async () => {
      const result = await controller.getFailedJobStats();

      expect(mockDlqService.getFailedTradeStats).toHaveBeenCalled();
      expect(result.totalFailed).toBe(10);
      expect(result.currentDlqDepth).toBe(6);
    });
  });

  describe('discardFailedJob', () => {
    it('should delegate discard to service', async () => {
      const result = await controller.discardFailedJob('trade-001', mockReq);

      expect(mockDlqService.discardFailedJob).toHaveBeenCalledWith(
        'trade-001',
        'user-001',
      );
      expect(result.tradeId).toBe('trade-001');
    });
  });

  describe('getDlqMetrics', () => {
    it('should return metrics snapshot', async () => {
      const result = await controller.getDlqMetrics();

      expect(mockMetricsService.getMetrics).toHaveBeenCalled();
      expect(result.totalFailures).toBe(100);
      expect(result.retrySuccessRate).toBe(75);
    });
  });

  describe('getCleanupStatus', () => {
    it('should return last cleanup result with config', async () => {
      const result = await controller.getCleanupStatus();

      expect(result.result).toBeDefined();
      expect(result.config.retentionDays).toBe(90);
    });
  });

  describe('triggerCleanup', () => {
    it('should trigger manual cleanup with given retention', async () => {
      const result = await controller.triggerCleanup(60);

      expect(mockCleanupService.cleanupOldEntries).toHaveBeenCalledWith(60);
      expect(result.archivedCount).toBe(3);
    });
  });
});
