import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AuditExportController } from './audit-export.controller';
import { AuditExportService } from './audit-export.service';

describe('AuditExportController', () => {
  let controller: AuditExportController;
  let exportService: Partial<AuditExportService>;

  beforeEach(async () => {
    exportService = {
      requestExport: jest.fn().mockResolvedValue({ status: 'PENDING', jobId: 'job-123' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditExportController],
      providers: [
        {
          provide: AuditExportService,
          useValue: exportService,
        },
      ],
    }).compile();

    controller = module.get<AuditExportController>(AuditExportController);
  });

  describe('downloadExport', () => {
    it('throws NotFoundException when export file is incomplete or does not exist', async () => {
      const mockRes = {
        download: jest.fn(),
      } as unknown as Response;

      await expect(controller.downloadExport('non-existent-job', mockRes)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockRes.download).not.toHaveBeenCalled();
    });

    it('rejects path traversal and staging file attempts', async () => {
      const mockRes = { download: jest.fn() } as unknown as Response;

      await expect(controller.downloadExport('../secret', mockRes)).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.downloadExport('.staging/partial', mockRes)).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.downloadExport('job.tmp', mockRes)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
