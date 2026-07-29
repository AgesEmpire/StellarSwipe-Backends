import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { ExportsService, EXPORT_QUEUE } from './exports.service';
import { BulkExport, ExportFormat, ExportStatus, ExportType } from './entities/bulk-export.entity';

describe('ExportsService', () => {
  let service: ExportsService;
  let exportRepo: any;
  let exportQueue: any;

  const userId = 'user-123';

  beforeEach(async () => {
    exportRepo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    };

    exportQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportsService,
        { provide: getRepositoryToken(BulkExport), useValue: exportRepo },
        { provide: getQueueToken(EXPORT_QUEUE), useValue: exportQueue },
      ],
    }).compile();

    service = module.get<ExportsService>(ExportsService);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  describe('initiate', () => {
    it('creates export job and queues it', async () => {
      exportRepo.count.mockResolvedValue(0);
      const saved = { id: 'exp-1', userId, type: ExportType.TRANSACTIONS, status: ExportStatus.PENDING };
      exportRepo.create.mockReturnValue(saved);
      exportRepo.save.mockResolvedValue(saved);

      const result = await service.initiate(userId, {
        type: ExportType.TRANSACTIONS,
        format: ExportFormat.CSV,
      });

      expect(result.id).toBe('exp-1');
      expect(exportQueue.add).toHaveBeenCalledWith(
        'process-export',
        { exportId: 'exp-1' },
        expect.objectContaining({ attempts: 3 }),
      );
    });

    it('throws TooManyRequestsException when active exports exceed limit', async () => {
      exportRepo.count.mockResolvedValue(3);

      await expect(
        service.initiate(userId, { type: ExportType.TRANSACTIONS }),
      ).rejects.toThrow(HttpException);

      expect(exportQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns export for owner', async () => {
      const exportJob = { id: 'exp-1', userId };
      exportRepo.findOne.mockResolvedValue(exportJob);

      const result = await service.findOne(userId, 'exp-1');
      expect(result).toEqual(exportJob);
    });

    it('throws NotFoundException for missing export', async () => {
      exportRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne(userId, 'exp-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for wrong owner', async () => {
      exportRepo.findOne.mockResolvedValue({ id: 'exp-1', userId: 'other' });
      await expect(service.findOne(userId, 'exp-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('markCompleted', () => {
    it('sets status to COMPLETED with download URL and expiry', async () => {
      exportRepo.update.mockResolvedValue({});

      await service.markCompleted('exp-1', 500);

      expect(exportRepo.update).toHaveBeenCalledWith(
        'exp-1',
        expect.objectContaining({
          status: ExportStatus.COMPLETED,
          rowCount: 500,
          downloadUrl: expect.stringContaining('/api/v1/exports/exp-1/download?token='),
          urlExpiresAt: expect.any(Date),
        }),
      );
    });
  });

  describe('markFailed', () => {
    it('sets status to FAILED with error message', async () => {
      exportRepo.update.mockResolvedValue({});

      await service.markFailed('exp-1', 'DB connection error');

      expect(exportRepo.update).toHaveBeenCalledWith('exp-1', {
        status: ExportStatus.FAILED,
        errorMessage: 'DB connection error',
      });
    });
  });

  describe('validateDownload', () => {
    it('throws NotFoundException when export is not completed', async () => {
      exportRepo.findOne.mockResolvedValue({
        id: 'exp-1',
        userId,
        status: ExportStatus.PROCESSING,
      });

      await expect(service.validateDownload(userId, 'exp-1', 'token')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when URL is expired', async () => {
      exportRepo.findOne.mockResolvedValue({
        id: 'exp-1',
        userId,
        status: ExportStatus.COMPLETED,
        urlExpiresAt: new Date(Date.now() - 1000),
        downloadUrl: '/api/v1/exports/exp-1/download?token=abc',
      });

      await expect(service.validateDownload(userId, 'exp-1', 'abc')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
