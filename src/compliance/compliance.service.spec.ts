import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ComplianceService } from './compliance.service';
import { UserDataExporterService } from './exporters/user-data-exporter.service';
import { TradeReportExporterService } from './exporters/trade-report-exporter.service';
import { AuditTrailExporterService } from './exporters/audit-trail-exporter.service';
import { GdprReportGenerator } from './reports/gdpr-report.generator';
import { FinancialReportGenerator } from './reports/financial-report.generator';
import { ExportFormat } from './dto/export-request.dto';
import { User, UserTier, KycStatus } from '../users/entities/user.entity';
import { ComplianceLog } from './entities/compliance-log.entity';
import { ForbiddenException } from '@nestjs/common';

describe('ComplianceService', () => {
  let service: ComplianceService;
  let userDataExporter: UserDataExporterService;
  let tradeReportExporter: TradeReportExporterService;
  let userRepository: any;
  let complianceLogRepository: any;

  beforeEach(async () => {
    userRepository = {
      findOne: jest.fn(),
    };
    complianceLogRepository = {
      create: jest.fn().mockImplementation(dto => dto),
      save: jest.fn(),
    };

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
          provide: getRepositoryToken(User),
          useValue: userRepository,
        },
        {
          provide: getRepositoryToken(ComplianceLog),
          useValue: complianceLogRepository,
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

  describe('validateTransaction', () => {
    it('should pass if all checks are valid', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-id',
        kycStatus: KycStatus.VERIFIED,
        tier: UserTier.GOLD,
      });

      await expect(service.validateTransaction('user-id', 1000, 'XLM')).resolves.not.toThrow();
      expect(complianceLogRepository.save).toHaveBeenCalledWith(expect.objectContaining({ type: 'transaction_allowed' }));
    });

    it('should throw ForbiddenException if KYC is not verified', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-id',
        kycStatus: KycStatus.PENDING,
        tier: UserTier.GOLD,
      });

      await expect(service.validateTransaction('user-id', 1000, 'XLM')).rejects.toThrow(ForbiddenException);
      expect(complianceLogRepository.save).toHaveBeenCalledWith(expect.objectContaining({ type: 'transaction_blocked' }));
    });

    it('should throw ForbiddenException if amount exceeds limit', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-id',
        kycStatus: KycStatus.VERIFIED,
        tier: UserTier.BASIC, // limit 1000
      });

      await expect(service.validateTransaction('user-id', 2000, 'XLM')).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if AML screening flags it', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-id',
        kycStatus: KycStatus.VERIFIED,
        tier: UserTier.PLATINUM,
      });

      await expect(service.validateTransaction('user-id', 2000000, 'XLM')).rejects.toThrow(ForbiddenException);
    });
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
