import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResidencyManagerService } from './residency-manager.service';
import { DataRegion, RegionCode, RegionStatus } from './entities/data-region.entity';
import { ResidencyPolicy, PolicyStatus, PolicyType } from './entities/residency-policy.entity';
import { RegionRouterService } from './services/region-router.service';
import { DataMigratorService, MigrationStatus } from './services/data-migrator.service';
import { ComplianceValidatorService } from './services/compliance-validator.service';
import { RegionDetector } from './utils/region-detector';
import { ComplianceStatus } from './dto/residency-compliance.dto';

describe('ResidencyManagerService', () => {
  let service: ResidencyManagerService;
  let regionRepo: jest.Mocked<Repository<DataRegion>>;
  let policyRepo: jest.Mocked<Repository<ResidencyPolicy>>;
  let regionRouter: jest.Mocked<RegionRouterService>;
  let dataMigrator: jest.Mocked<DataMigratorService>;
  let complianceValidator: jest.Mocked<ComplianceValidatorService>;
  let regionDetector: jest.Mocked<RegionDetector>;

  const mockRegion: DataRegion = {
    id: 'region-1',
    code: RegionCode.EU,
    name: 'European Union',
    storageEndpoint: 'https://eu-storage.internal',
    countryCodes: ['DE', 'FR', 'IT'],
    status: RegionStatus.ACTIVE,
    complianceFrameworks: ['GDPR'],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPolicy: ResidencyPolicy = {
    id: 'policy-1',
    name: 'EU GDPR Policy',
    policyType: PolicyType.GDPR,
    status: PolicyStatus.ACTIVE,
    region: mockRegion,
    regionId: 'region-1',
    dataLocalizationRequired: true,
    crossBorderTransferAllowed: false,
    allowedTransferDestinations: [],
    retentionDays: 730,
    encryptionRequired: true,
    additionalRequirements: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResidencyManagerService,
        {
          provide: getRepositoryToken(DataRegion),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ResidencyPolicy),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: RegionRouterService,
          useValue: {
            routeUser: jest.fn(),
            getAllActiveRegions: jest.fn(),
            getStorageEndpoint: jest.fn(),
          },
        },
        {
          provide: DataMigratorService,
          useValue: {
            scheduleMigration: jest.fn(),
            getJob: jest.fn(),
          },
        },
        {
          provide: ComplianceValidatorService,
          useValue: {
            validateCompliance: jest.fn(),
          },
        },
        {
          provide: RegionDetector,
          useValue: {
            detectRegionByCountry: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ResidencyManagerService);
    regionRepo = module.get(getRepositoryToken(DataRegion));
    policyRepo = module.get(getRepositoryToken(ResidencyPolicy));
    regionRouter = module.get(RegionRouterService);
    dataMigrator = module.get(DataMigratorService);
    complianceValidator = module.get(ComplianceValidatorService);
    regionDetector = module.get(RegionDetector);
  });

  describe('assignUserRegion', () => {
    it('assigns EU region for a German user', async () => {
      regionRouter.routeUser.mockResolvedValue({
        userId: 'user-1',
        assignedRegion: RegionCode.EU,
        storageEndpoint: 'https://eu-storage.internal',
        rationale: 'country_mapping:DE',
      });
      policyRepo.find.mockResolvedValue([mockPolicy]);

      const result = await service.assignUserRegion({
        userId: 'user-1',
        currentRegion: RegionCode.EU,
        countryCode: 'DE',
      });

      expect(result.assignedRegion).toBe(RegionCode.EU);
      expect(result.storageEndpoint).toBe('https://eu-storage.internal');
      expect(result.applicablePolicies).toContain(PolicyType.GDPR);
    });

    it('marks migration as required when current and assigned regions differ', async () => {
      regionRouter.routeUser.mockResolvedValue({
        userId: 'user-2',
        assignedRegion: RegionCode.EU,
        storageEndpoint: 'https://eu-storage.internal',
        rationale: 'country_mapping:DE',
      });
      policyRepo.find.mockResolvedValue([]);

      const result = await service.assignUserRegion({
        userId: 'user-2',
        currentRegion: RegionCode.US,
        countryCode: 'DE',
        forceMigration: true,
      });

      expect(result.migrationRequired).toBe(true);
    });
  });

  describe('migrateUserData', () => {
    it('delegates to DataMigratorService', async () => {
      const mockJob = {
        jobId: 'job-1',
        userId: 'user-1',
        sourceRegion: RegionCode.US,
        targetRegion: RegionCode.EU,
        status: MigrationStatus.QUEUED,
        startedAt: new Date(),
      };
      dataMigrator.scheduleMigration.mockResolvedValue(mockJob);

      const result = await service.migrateUserData({
        userId: 'user-1',
        sourceRegion: RegionCode.US,
        targetRegion: RegionCode.EU,
        reason: 'GDPR compliance',
      });

      expect(result.status).toBe(MigrationStatus.QUEUED);
      expect(dataMigrator.scheduleMigration).toHaveBeenCalledWith(
        'user-1',
        RegionCode.US,
        RegionCode.EU,
        'GDPR compliance',
      );
    });
  });

  describe('checkCompliance', () => {
    it('returns compliant result for valid EU user', async () => {
      const mockResult = {
        userId: 'user-1',
        region: RegionCode.EU,
        status: ComplianceStatus.COMPLIANT,
        applicableFrameworks: ['GDPR'],
        dataLocalized: true,
        encryptionEnabled: true,
        violations: [],
      };
      complianceValidator.validateCompliance.mockResolvedValue(mockResult);

      const result = await service.checkCompliance({
        userId: 'user-1',
        region: RegionCode.EU,
        countryCode: 'DE',
      });

      expect(result.status).toBe(ComplianceStatus.COMPLIANT);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('generateComplianceReport', () => {
    it('produces a summary with correct counts', async () => {
      regionRepo.findOne.mockResolvedValue(mockRegion);
      complianceValidator.validateCompliance
        .mockResolvedValueOnce({
          userId: 'u1', region: RegionCode.EU, status: ComplianceStatus.COMPLIANT,
          applicableFrameworks: [], dataLocalized: true, encryptionEnabled: true, violations: [],
        })
        .mockResolvedValueOnce({
          userId: 'u2', region: RegionCode.EU, status: ComplianceStatus.NON_COMPLIANT,
          applicableFrameworks: [], dataLocalized: false, encryptionEnabled: true,
          violations: [{ code: 'DATA_NOT_LOCALIZED', description: 'test', severity: 'critical' }],
        });

      const report = await service.generateComplianceReport(RegionCode.EU, ['u1', 'u2']);

      expect(report.summary.totalUsers).toBe(2);
      expect(report.summary.compliant).toBe(1);
      expect(report.summary.nonCompliant).toBe(1);
      expect(report.overallStatus).toBe(ComplianceStatus.NON_COMPLIANT);
    });
  });

  describe('getRegionForCountry', () => {
    it('delegates to RegionDetector', () => {
      regionDetector.detectRegionByCountry.mockReturnValue(RegionCode.ASIA);

      const region = service.getRegionForCountry('JP');

      expect(region).toBe(RegionCode.ASIA);
      expect(regionDetector.detectRegionByCountry).toHaveBeenCalledWith('JP');
    });
  });
});
