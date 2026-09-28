import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { TradeDlqCleanupService } from './trade-dlq-cleanup.service';
import { Trade, TradeStatus } from '../entities/trade.entity';
import { DeadLetterService } from '../../jobs/dead-letter.service';
import { TradeDlqMetricsService } from './trade-dlq-metrics.service';

const mockTrade = (overrides: Partial<any> = {}) => ({
  id: 'trade-old-001',
  status: TradeStatus.FAILED,
  metadata: { discarded: { discardedBy: 'admin', discardedAt: '2024-01-01T00:00:00Z' } },
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

describe('TradeDlqCleanupService', () => {
  let service: TradeDlqCleanupService;
  let mockTradeRepository: any;
  let mockDeadLetterService: any;
  let mockMetricsService: any;

  beforeEach(async () => {
    mockTradeRepository = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn(),
    };

    mockDeadLetterService = {
      list: jest.fn().mockResolvedValue([]),
      discard: jest.fn().mockResolvedValue(undefined),
    };

    mockMetricsService = {
      setDlqDepth: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string, def: unknown) => {
        if (key === 'dlq.retentionDays') return 90;
        return def;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeDlqCleanupService,
        { provide: getRepositoryToken(Trade), useValue: mockTradeRepository },
        { provide: DeadLetterService, useValue: mockDeadLetterService },
        { provide: TradeDlqMetricsService, useValue: mockMetricsService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(TradeDlqCleanupService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── cleanupOldEntries ──────────────────────────────────────────────────────

  describe('cleanupOldEntries', () => {
    it('should soft-delete old discarded trades past retention', async () => {
      const oldTrade = mockTrade();
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([oldTrade]),
      };
      mockTradeRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.cleanupOldEntries(90);

      expect(result.archivedCount).toBe(1);
      expect(mockTradeRepository.softDelete).toHaveBeenCalledWith('trade-old-001');
    });

    it('should remove stale DLQ entries past retention', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockTradeRepository.createQueryBuilder.mockReturnValue(qb);

      mockDeadLetterService.list.mockResolvedValue([
        {
          id: 'dlq-old',
          data: { failedAt: '2023-01-01T00:00:00Z', queue: 'transactions' },
        },
        {
          id: 'dlq-recent',
          data: { failedAt: new Date().toISOString(), queue: 'transactions' },
        },
      ]);

      const result = await service.cleanupOldEntries(90);

      expect(result.dlqEntriesRemoved).toBe(1);
      expect(mockDeadLetterService.discard).toHaveBeenCalledWith('dlq-old');
      expect(mockDeadLetterService.discard).not.toHaveBeenCalledWith('dlq-recent');
    });

    it('should preserve recent entries within retention period', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockTradeRepository.createQueryBuilder.mockReturnValue(qb);

      mockDeadLetterService.list.mockResolvedValue([
        {
          id: 'dlq-recent',
          data: { failedAt: new Date().toISOString(), queue: 'transactions' },
        },
      ]);

      const result = await service.cleanupOldEntries(90);

      expect(result.dlqEntriesRemoved).toBe(0);
    });

    it('should handle individual trade archive errors gracefully', async () => {
      const trade1 = mockTrade({ id: 'trade-fail' });
      const trade2 = mockTrade({ id: 'trade-ok' });
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([trade1, trade2]),
      };
      mockTradeRepository.createQueryBuilder.mockReturnValue(qb);
      mockTradeRepository.softDelete
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({ affected: 1 });

      const result = await service.cleanupOldEntries(90);

      expect(result.archivedCount).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('trade-fail');
    });

    it('should handle DLQ list failure gracefully', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockTradeRepository.createQueryBuilder.mockReturnValue(qb);
      mockDeadLetterService.list.mockRejectedValue(new Error('Redis down'));

      const result = await service.cleanupOldEntries(90);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Redis down');
    });

    it('should return duration in milliseconds', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockTradeRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.cleanupOldEntries(90);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle no entries to clean up', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockTradeRepository.createQueryBuilder.mockReturnValue(qb);
      mockDeadLetterService.list.mockResolvedValue([]);

      const result = await service.cleanupOldEntries(90);

      expect(result.archivedCount).toBe(0);
      expect(result.dlqEntriesRemoved).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ── syncDlqDepth ───────────────────────────────────────────────────────────

  describe('syncDlqDepth', () => {
    it('should sync DLQ depth with actual queue state', async () => {
      mockDeadLetterService.list.mockResolvedValue([
        { data: { queue: 'transactions' } },
        { data: { queue: 'transactions' } },
        { data: { queue: 'notifications' } },
      ]);

      await service.syncDlqDepth();

      expect(mockMetricsService.setDlqDepth).toHaveBeenCalledWith(2);
    });

    it('should handle sync failure gracefully', async () => {
      mockDeadLetterService.list.mockRejectedValue(new Error('Redis error'));

      await expect(service.syncDlqDepth()).resolves.not.toThrow();
    });

    it('should set depth to 0 when no DLQ entries', async () => {
      mockDeadLetterService.list.mockResolvedValue([]);

      await service.syncDlqDepth();

      expect(mockMetricsService.setDlqDepth).toHaveBeenCalledWith(0);
    });
  });

  // ── getLastCleanupResult ───────────────────────────────────────────────────

  describe('getLastCleanupResult', () => {
    it('should return null before first cleanup', () => {
      const result = service.getLastCleanupResult();

      expect(result.result).toBeNull();
      expect(result.runAt).toBeNull();
    });
  });

  // ── getRetentionConfig ─────────────────────────────────────────────────────

  describe('getRetentionConfig', () => {
    it('should return retention configuration', () => {
      const config = service.getRetentionConfig();

      expect(config.retentionDays).toBe(90);
      expect(config.cronExpression).toBeDefined();
    });
  });
});
