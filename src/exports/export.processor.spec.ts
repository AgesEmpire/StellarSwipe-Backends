import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExportProcessor } from './export.processor';
import { ExportsService } from './exports.service';
import { BulkExport, ExportFormat, ExportType } from './entities/bulk-export.entity';
import { DeadLetterService } from '../jobs/dead-letter.service';

const makeJob = (overrides: Partial<{ data: unknown; attemptsMade: number; opts: { attempts?: number } }> = {}) => ({
  id: 'job-1',
  data: overrides.data ?? { exportId: 'exp-1' },
  attemptsMade: overrides.attemptsMade ?? 1,
  opts: overrides.opts ?? { attempts: 3 },
});

describe('ExportProcessor', () => {
  let processor: ExportProcessor;
  let exportsService: any;
  let exportRepo: any;
  let deadLetterService: any;

  beforeEach(async () => {
    exportsService = {
      markProcessing: jest.fn().mockResolvedValue(undefined),
      markCompleted: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    exportRepo = {
      findOne: jest.fn(),
    };
    deadLetterService = {
      capture: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportProcessor,
        { provide: ExportsService, useValue: exportsService },
        { provide: getRepositoryToken(BulkExport), useValue: exportRepo },
        { provide: DeadLetterService, useValue: deadLetterService },
      ],
    }).compile();

    processor = module.get(ExportProcessor);
    jest.spyOn((processor as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((processor as any).logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  describe('handleExport', () => {
    it('marks processing then completed with the generated row count', async () => {
      exportRepo.findOne.mockResolvedValue({
        id: 'exp-1',
        type: ExportType.TRANSACTIONS,
        format: ExportFormat.CSV,
        filters: {},
      });

      await processor.handleExport(makeJob() as any);

      expect(exportsService.markProcessing).toHaveBeenCalledWith('exp-1');
      expect(exportsService.markCompleted).toHaveBeenCalledWith('exp-1', 500);
    });

    it('marks failed and rethrows when the export record is missing', async () => {
      exportRepo.findOne.mockResolvedValue(null);

      await expect(processor.handleExport(makeJob() as any)).rejects.toThrow('Export exp-1 not found');
      expect(exportsService.markFailed).toHaveBeenCalledWith('exp-1', 'Export exp-1 not found');
    });
  });

  describe('onFailed', () => {
    it('captures to the dead-letter queue once retry attempts are exhausted', async () => {
      const job = makeJob({ attemptsMade: 3, opts: { attempts: 3 } });
      await processor.onFailed(job as any, new Error('disk full'));

      expect(deadLetterService.capture).toHaveBeenCalledWith(job, expect.any(Error));
    });

    it('does not capture to the dead-letter queue while retries remain', async () => {
      const job = makeJob({ attemptsMade: 1, opts: { attempts: 3 } });
      await processor.onFailed(job as any, new Error('transient'));

      expect(deadLetterService.capture).not.toHaveBeenCalled();
    });
  });
});
