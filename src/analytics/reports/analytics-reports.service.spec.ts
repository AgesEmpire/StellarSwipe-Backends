import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { NotFoundException } from '@nestjs/common';
import { AnalyticsReportsService, ANALYTICS_REPORTS_QUEUE, GENERATE_EXPORT_JOB } from './analytics-reports.service';
import { MetricPeriod } from '../entities/metric-snapshot.entity';

describe('AnalyticsReportsService', () => {
  let service: AnalyticsReportsService;
  let queue: any;

  beforeEach(async () => {
    queue = {
      add: jest.fn(),
      getJob: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsReportsService,
        { provide: getQueueToken(ANALYTICS_REPORTS_QUEUE), useValue: queue },
      ],
    }).compile();

    service = module.get(AnalyticsReportsService);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  describe('enqueueExport', () => {
    it('adds a job with retry/backoff options and returns its id', async () => {
      queue.add.mockResolvedValue({ id: 'job-42' });

      const result = await service.enqueueExport({
        period: MetricPeriod.DAILY,
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-31T00:00:00.000Z',
        timezone: 'UTC',
      });

      expect(result).toEqual({ jobId: 'job-42' });
      expect(queue.add).toHaveBeenCalledWith(
        GENERATE_EXPORT_JOB,
        expect.objectContaining({ period: MetricPeriod.DAILY }),
        expect.objectContaining({ attempts: 3, backoff: { type: 'exponential', delay: 5_000 } }),
      );
    });
  });

  describe('getJobStatus', () => {
    it('throws NotFoundException when the job does not exist', async () => {
      queue.getJob.mockResolvedValue(null);
      await expect(service.getJobStatus('missing')).rejects.toThrow(NotFoundException);
    });

    it('maps a completed job to state=completed with its result', async () => {
      queue.getJob.mockResolvedValue({
        id: 'job-42',
        attemptsMade: 1,
        failedReason: undefined,
        returnvalue: 'period,active_users\ndaily,10\n',
        getState: jest.fn().mockResolvedValue('completed'),
      });

      const result = await service.getJobStatus('job-42');

      expect(result).toEqual({
        jobId: 'job-42',
        state: 'completed',
        attemptsMade: 1,
        failedReason: undefined,
        result: 'period,active_users\ndaily,10\n',
      });
    });

    it('maps a failed job to state=failed without a result', async () => {
      queue.getJob.mockResolvedValue({
        id: 'job-42',
        attemptsMade: 3,
        failedReason: 'DB timeout',
        returnvalue: undefined,
        getState: jest.fn().mockResolvedValue('failed'),
      });

      const result = await service.getJobStatus('job-42');

      expect(result.state).toBe('failed');
      expect(result.failedReason).toBe('DB timeout');
      expect(result.result).toBeUndefined();
    });

    it.each([
      ['waiting', 'queued'],
      ['paused', 'queued'],
      ['active', 'active'],
      ['delayed', 'delayed'],
    ])('maps bull state "%s" to "%s"', async (bullState, expected) => {
      queue.getJob.mockResolvedValue({
        id: 'job-1',
        attemptsMade: 0,
        getState: jest.fn().mockResolvedValue(bullState),
      });

      const result = await service.getJobStatus('job-1');
      expect(result.state).toBe(expected);
    });
  });
});
