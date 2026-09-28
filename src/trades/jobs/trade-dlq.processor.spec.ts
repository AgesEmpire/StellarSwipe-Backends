import { Test, TestingModule } from '@nestjs/testing';
import { TradeDlqProcessor } from './trade-dlq.processor';
import { TradeDlqService } from '../services/trade-dlq.service';
import { TradeDlqMetricsService } from '../services/trade-dlq-metrics.service';

const mockJob = (overrides: Partial<any> = {}) => ({
  id: 'job-100',
  data: { tradeId: 'trade-100', userId: 'user-100' },
  attemptsMade: 3,
  opts: { attempts: 3 },
  queue: { name: 'transactions' },
  ...overrides,
});

describe('TradeDlqProcessor', () => {
  let processor: TradeDlqProcessor;
  let mockDlqService: any;
  let mockMetricsService: any;

  beforeEach(async () => {
    mockDlqService = {
      handleFailedJob: jest.fn().mockResolvedValue(undefined),
    };

    mockMetricsService = {
      recordFailure: jest.fn(),
      recordRetry: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeDlqProcessor,
        { provide: TradeDlqService, useValue: mockDlqService },
        { provide: TradeDlqMetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    processor = module.get(TradeDlqProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  // ── onFailed ───────────────────────────────────────────────────────────────

  describe('onFailed', () => {
    it('should skip DLQ processing when attempts remain', async () => {
      const job = mockJob({ attemptsMade: 1, opts: { attempts: 3 } });
      const error = new Error('Temporary error');

      await processor.onFailed(job, error);

      expect(mockDlqService.handleFailedJob).not.toHaveBeenCalled();
      expect(mockMetricsService.recordFailure).not.toHaveBeenCalled();
    });

    it('should delegate to DLQ service when all attempts exhausted', async () => {
      const job = mockJob({ attemptsMade: 3, opts: { attempts: 3 } });
      const error = new Error('Permanent failure');

      await processor.onFailed(job, error);

      expect(mockDlqService.handleFailedJob).toHaveBeenCalledWith(job, error);
      expect(mockMetricsService.recordFailure).toHaveBeenCalledWith(
        'trade-100',
        'Permanent failure',
      );
    });

    it('should handle DLQ service errors gracefully', async () => {
      const job = mockJob({ attemptsMade: 3, opts: { attempts: 3 } });
      const error = new Error('Test error');
      mockDlqService.handleFailedJob.mockRejectedValue(
        new Error('DLQ service crashed'),
      );

      await expect(processor.onFailed(job, error)).resolves.not.toThrow();
    });

    it('should handle jobs with no tradeId in data', async () => {
      const job = mockJob({
        data: {},
        attemptsMade: 1,
        opts: { attempts: 1 },
      });
      const error = new Error('Test');

      await processor.onFailed(job, error);

      expect(mockMetricsService.recordFailure).toHaveBeenCalledWith(
        'unknown',
        'Test',
      );
    });

    it('should handle jobs with default attempts=1 when opts.attempts missing', async () => {
      const job = mockJob({
        attemptsMade: 1,
        opts: {},
      });
      const error = new Error('Test');

      await processor.onFailed(job, error);

      expect(mockDlqService.handleFailedJob).toHaveBeenCalled();
    });

    it('should not record metrics when job will be retried', async () => {
      const job = mockJob({ attemptsMade: 1, opts: { attempts: 5 } });
      const error = new Error('Retry me');

      await processor.onFailed(job, error);

      expect(mockMetricsService.recordFailure).not.toHaveBeenCalled();
    });
  });

  // ── onCompleted ────────────────────────────────────────────────────────────

  describe('onCompleted', () => {
    it('should record successful retry in metrics for retry jobs', () => {
      const job = mockJob({ data: { tradeId: 'trade-200', isRetry: true } });

      processor.onCompleted(job);

      expect(mockMetricsService.recordRetry).toHaveBeenCalledWith(
        'trade-200',
        true,
      );
    });

    it('should not record retry metrics for non-retry jobs', () => {
      const job = mockJob({ data: { tradeId: 'trade-200', isRetry: false } });

      processor.onCompleted(job);

      expect(mockMetricsService.recordRetry).not.toHaveBeenCalled();
    });

    it('should handle jobs with missing data gracefully', () => {
      const job = mockJob({ data: {} });

      expect(() => processor.onCompleted(job)).not.toThrow();
    });
  });

  // ── onStalled ──────────────────────────────────────────────────────────────

  describe('onStalled', () => {
    it('should log stalled job without throwing', () => {
      const job = mockJob();

      expect(() => processor.onStalled(job)).not.toThrow();
    });

    it('should handle missing tradeId in stalled job data', () => {
      const job = mockJob({ data: {} });

      expect(() => processor.onStalled(job)).not.toThrow();
    });
  });
});
