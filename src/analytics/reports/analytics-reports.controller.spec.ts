import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AnalyticsReportsController } from './analytics-reports.controller';
import { AnalyticsReportsService } from './analytics-reports.service';
import { MetricPeriod } from '../entities/metric-snapshot.entity';

const mockAnalyticsReportsService = {
  enqueueExport: jest.fn(),
  getJobStatus: jest.fn(),
};

describe('AnalyticsReportsController', () => {
  let controller: AnalyticsReportsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsReportsController],
      providers: [{ provide: AnalyticsReportsService, useValue: mockAnalyticsReportsService }],
    })
      .overrideGuard(require('../../auth/guards/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AnalyticsReportsController);
  });

  describe('queueExport', () => {
    it('queues the export and returns the job id', async () => {
      mockAnalyticsReportsService.enqueueExport.mockResolvedValue({ jobId: 'job-1' });

      const result = await controller.queueExport({
        period: MetricPeriod.DAILY,
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-31T00:00:00.000Z',
        timezone: 'UTC',
      });

      expect(result).toEqual({ jobId: 'job-1' });
      expect(mockAnalyticsReportsService.enqueueExport).toHaveBeenCalledWith({
        period: MetricPeriod.DAILY,
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-31T00:00:00.000Z',
        timezone: 'UTC',
      });
    });

    it('defaults period to DAILY and timezone to UTC when omitted', async () => {
      mockAnalyticsReportsService.enqueueExport.mockResolvedValue({ jobId: 'job-2' });

      await controller.queueExport({
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-31T00:00:00.000Z',
      } as any);

      expect(mockAnalyticsReportsService.enqueueExport).toHaveBeenCalledWith(
        expect.objectContaining({ period: MetricPeriod.DAILY, timezone: 'UTC' }),
      );
    });

    it('rejects an invalid date range', async () => {
      await expect(
        controller.queueExport({
          startDate: '2024-02-01T00:00:00.000Z',
          endDate: '2024-01-01T00:00:00.000Z',
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(mockAnalyticsReportsService.enqueueExport).not.toHaveBeenCalled();
    });

    it('rejects unparsable dates', async () => {
      await expect(
        controller.queueExport({ startDate: 'not-a-date', endDate: '2024-01-31T00:00:00.000Z' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getStatus', () => {
    it('delegates to the service', async () => {
      const status = { jobId: 'job-1', state: 'completed', attemptsMade: 1, result: 'csv-data' };
      mockAnalyticsReportsService.getJobStatus.mockResolvedValue(status);

      const result = await controller.getStatus('job-1');

      expect(result).toEqual(status);
      expect(mockAnalyticsReportsService.getJobStatus).toHaveBeenCalledWith('job-1');
    });
  });
});
