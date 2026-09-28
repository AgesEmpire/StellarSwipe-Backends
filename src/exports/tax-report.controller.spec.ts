import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { ExportFormat, ExportStatus, ExportType } from './entities/bulk-export.entity';
import { TaxReportDto } from './dto/tax-report.dto';

const mockExportsService = {
  initiate: jest.fn(),
  listForUser: jest.fn(),
  findOne: jest.fn(),
  validateDownload: jest.fn(),
};

const mockReq = { user: { id: 'user-123' } };

describe('ExportsController — tax-report (issue #484)', () => {
  let controller: ExportsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExportsController],
      providers: [{ provide: ExportsService, useValue: mockExportsService }],
    })
      .overrideGuard(require('../auth/guards/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ExportsController>(ExportsController);
  });

  it('initiates a tax report export with date range', async () => {
    const dto: TaxReportDto = {
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      format: ExportFormat.CSV,
    };

    const expected = {
      id: 'exp-tax-1',
      userId: 'user-123',
      type: ExportType.TAX_REPORT,
      format: ExportFormat.CSV,
      status: ExportStatus.PENDING,
    };

    mockExportsService.initiate.mockResolvedValue(expected);

    const result = await controller.initiateTaxReport(mockReq, dto);

    expect(mockExportsService.initiate).toHaveBeenCalledWith('user-123', {
      type: ExportType.TAX_REPORT,
      format: ExportFormat.CSV,
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    });
    expect(result).toEqual(expected);
  });

  it('defaults to CSV format when format is not specified', async () => {
    const dto: TaxReportDto = {
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    };

    mockExportsService.initiate.mockResolvedValue({ id: 'exp-tax-2', status: ExportStatus.PENDING });

    await controller.initiateTaxReport(mockReq, dto);

    expect(mockExportsService.initiate).toHaveBeenCalledWith('user-123', {
      type: ExportType.TAX_REPORT,
      format: undefined,
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    });
  });

  it('passes through service errors (e.g. too many active exports)', async () => {
    const dto: TaxReportDto = { startDate: '2025-01-01', endDate: '2025-12-31' };
    mockExportsService.initiate.mockRejectedValue(new Error('Too many active exports'));

    await expect(controller.initiateTaxReport(mockReq, dto)).rejects.toThrow(
      'Too many active exports',
    );
  });
});
