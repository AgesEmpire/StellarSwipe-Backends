import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ComplianceService } from './compliance.service';
import { UserDataExporterService } from './exporters/user-data-exporter.service';
import { TradeReportExporterService } from './exporters/trade-report-exporter.service';
import { AuditTrailExporterService } from './exporters/audit-trail-exporter.service';
import { GdprReportGenerator } from './reports/gdpr-report.generator';
import { FinancialReportGenerator } from './reports/financial-report.generator';
import { ExportFormat } from './dto/export-request.dto';

describe('ComplianceService', () => {
  let service: ComplianceService;
  let userDataExporter: UserDataExporterService;
  let tradeReportExporter: TradeReportExporterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplianceService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => defaultValue),
          },
        },
        {
          provide: UserDataExporterService,
          useValue: {
            exportUserData: jest.fn(),
          },
        },
        {
          provide: TradeReportExporterService,
          useValue: {
            generateTradeVolumeReport: jest.fn(),
            generateFinancialSummary: jest.fn(),
          },
        },
        {
          provide: AuditTrailExporterService,
          useValue: {
            generateAuditReport: jest.fn(),
          },
        },
        {
          provide: GdprReportGenerator,
          useValue: {},
        },
        {
          provide: FinancialReportGenerator,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<ComplianceService>(ComplianceService);
    userDataExporter = module.get<UserDataExporterService>(UserDataExporterService);
    tradeReportExporter = module.get<TradeReportExporterService>(TradeReportExporterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('exportUserData', () => {
    it('should export user data in JSON format', async () => {
      const userId = 'test-user-id';
      const mockData = { user: {}, trades: [], signals: [] };

      jest.spyOn(userDataExporter, 'exportUserData').mockResolvedValue(mockData);

      const result = await service.exportUserData(userId, ExportFormat.JSON);

      expect(result).toContain('user_export_');
      expect(userDataExporter.exportUserData).toHaveBeenCalledWith(userId);
    });
  });

  describe('generateComplianceReport', () => {
    it('should generate trade volume report', async () => {
      const startDate = new Date('2026-01-01');
      const endDate = new Date('2026-01-31');
      const mockReport = { totalTrades: 100, totalVolume: 50000 };

      jest.spyOn(tradeReportExporter, 'generateTradeVolumeReport').mockResolvedValue(mockReport);

      const result = await service.generateComplianceReport('trade_volume', startDate, endDate);

      expect(result).toEqual(mockReport);
      expect(tradeReportExporter.generateTradeVolumeReport).toHaveBeenCalledWith(startDate, endDate);
    });
  });
});
