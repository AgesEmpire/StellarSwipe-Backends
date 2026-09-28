import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsReportsProcessor } from './analytics-reports.processor';
import { AnalyticsService } from '../analytics.service';
import { DeadLetterService } from '../../jobs/dead-letter.service';
import { MetricPeriod } from '../entities/metric-snapshot.entity';

const makeJob = (overrides: Partial<{ data: unknown; attemptsMade: number; opts: { attempts?: number } }> = {}) => ({
  id: 'job-1',
  data:
    overrides.data ?? {
      period: MetricPeriod.DAILY,
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: '2024-01-31T00:00:00.000Z',
      timezone: 'UTC',
    },
  attemptsMade: overrides.attemptsMade ?? 1,
  opts: overrides.opts ?? { attempts: 3 },
});

describe('AnalyticsReportsProcessor', () => {
  let processor: AnalyticsReportsProcessor;
  let analyticsService: any;
  let deadLetterService: any;

  beforeEach(async () => {
    analyticsService = {
      exportMetrics: jest.fn().mockResolvedValue('period,active_users\ndaily,10\n'),
    };
    deadLetterService = {
      capture: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsReportsProcessor,
        { provide: AnalyticsService, useValue: analyticsService },
        { provide: DeadLetterService, useValue: deadLetterService },
      ],
    }).compile();

    processor = module.get(AnalyticsReportsProcessor);
    jest.spyOn((processor as any).logger, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  describe('handleGenerateExport', () => {
    it('delegates to AnalyticsService.exportMetrics with parsed dates and returns the CSV', async () => {
      const result = await processor.handleGenerateExport(makeJob() as any);

      expect(analyticsService.exportMetrics).toHaveBeenCalledWith({
        period: MetricPeriod.DAILY,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-31T00:00:00.000Z'),
        timezone: 'UTC',
      });
      expect(result).toBe('period,active_users\ndaily,10\n');
    });
  });

  describe('onFailed', () => {
    it('captures to the dead-letter queue once retry attempts are exhausted', async () => {
      const job = makeJob({ attemptsMade: 3, opts: { attempts: 3 } });
      await processor.onFailed(job as any, new Error('query timeout'));

      expect(deadLetterService.capture).toHaveBeenCalledWith(job, expect.any(Error));
    });

    it('does not capture to the dead-letter queue while retries remain', async () => {
      const job = makeJob({ attemptsMade: 1, opts: { attempts: 3 } });
      await processor.onFailed(job as any, new Error('transient'));

      expect(deadLetterService.capture).not.toHaveBeenCalled();
    });
  });
});
