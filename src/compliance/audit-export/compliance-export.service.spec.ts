import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ComplianceExportService } from './compliance-export.service';
import { AuditLog, AuditAction, AuditStatus } from '../../audit-log/entities/audit-log.entity';
import { AuditExportRequestDto, AuditExportFormat } from './dto/export-request.dto';
import { ForbiddenException, BadRequestException } from '@nestjs/common';

describe('ComplianceExportService', () => {
  let service: ComplianceExportService;
  let repo: jest.Mocked<Repository<AuditLog>>;

  const mockUser = {
    id: 'user-1',
    role: 'compliance_officer',
  };

  const nonComplianceUser = {
    id: 'user-2',
    role: 'trader',
  };

  const mockAuditLogs: AuditLog[] = [
    {
      id: 'log-1',
      userId: 'user-1',
      action: AuditAction.TRADE_EXECUTED,
      resource: 'trade',
      resourceId: 'trade-1',
      status: AuditStatus.SUCCESS,
      ipAddress: '192.168.1.1',
      userAgent: 'test-agent',
      createdAt: new Date(),
    } as AuditLog,
    {
      id: 'log-2',
      userId: 'user-1',
      action: AuditAction.LOGIN,
      resource: 'auth',
      status: AuditStatus.SUCCESS,
      ipAddress: '192.168.1.1',
      createdAt: new Date(),
    } as AuditLog,
  ];

  beforeEach(async () => {
    const mockRepo = {
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplianceExportService,
        { provide: getRepositoryToken(AuditLog), useValue: mockRepo },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('/tmp/exports') },
        },
      ],
    }).compile();

    service = module.get<ComplianceExportService>(ComplianceExportService);
    repo = module.get(getRepositoryToken(AuditLog));
  });

  describe('assertComplianceRole', () => {
    it('should allow compliance_officer role', () => {
      expect(() => service.assertComplianceRole(mockUser)).not.toThrow();
    });

    it('should allow admin role', () => {
      expect(() =>
        service.assertComplianceRole({ id: 'admin-1', role: 'admin' }),
      ).not.toThrow();
    });

    it('should allow auditor role', () => {
      expect(() =>
        service.assertComplianceRole({ id: 'auditor-1', role: 'auditor' }),
      ).not.toThrow();
    });

    it('should reject trader role', () => {
      expect(() =>
        service.assertComplianceRole(nonComplianceUser),
      ).toThrow(ForbiddenException);
    });

    it('should reject user without role', () => {
      expect(() =>
        service.assertComplianceRole({ id: 'user-3' }),
      ).toThrow(ForbiddenException);
    });
  });

  describe('export', () => {
    it('should generate a CSV export', async () => {
      repo.find.mockResolvedValue(mockAuditLogs);
      const dto: AuditExportRequestDto = {
        format: AuditExportFormat.CSV,
      };
      const result = await service.export(mockUser, dto);
      expect(result.format).toBe('csv');
      expect(result.recordCount).toBe(2);
      expect(result.downloadUrl).toContain('/compliance/audit-exports/download/');
      expect(result.id).toBeDefined();
    });

    it('should generate a JSON export', async () => {
      repo.find.mockResolvedValue(mockAuditLogs);
      const dto: AuditExportRequestDto = {
        format: AuditExportFormat.JSON,
      };
      const result = await service.export(mockUser, dto);
      expect(result.format).toBe('json');
      expect(result.recordCount).toBe(2);
    });

    it('should apply date filters', async () => {
      repo.find.mockResolvedValue(mockAuditLogs);
      const dto: AuditExportRequestDto = {
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        action: AuditAction.TRADE_EXECUTED,
      };
      const result = await service.export(mockUser, dto);
      expect(result.recordCount).toBe(2);
      expect(repo.find).toHaveBeenCalled();
    });

    it('should reject non-compliance roles', async () => {
      await expect(
        service.export(nonComplianceUser, { format: AuditExportFormat.CSV }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw error when no records found', async () => {
      repo.find.mockResolvedValue([]);
      await expect(
        service.export(mockUser, { format: AuditExportFormat.CSV }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should filter by user ID', async () => {
      repo.find.mockResolvedValue([mockAuditLogs[0]]);
      const dto: AuditExportRequestDto = {
        userId: 'user-1',
        format: AuditExportFormat.CSV,
      };
      const result = await service.export(mockUser, dto);
      expect(result.recordCount).toBe(1);
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1' }),
        }),
      );
    });
  });
});
