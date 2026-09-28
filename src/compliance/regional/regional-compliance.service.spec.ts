import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RegionalComplianceService } from './regional-compliance.service';
import { ComplianceCheck } from './entities/compliance-check.entity';
import { RegionalRule } from './entities/regional-rule.entity';
import { EuGdprFramework } from './frameworks/eu-gdpr.framework';
import { UsFinraFramework } from './frameworks/us-finra.framework';
import { NigeriaSecFramework } from './frameworks/nigeria-sec.framework';
import { RegionDetector } from './utils/region-detector';
import { ComplianceRegion } from './interfaces/compliance-framework.interface';

const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn((dto) => dto),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  })),
});

describe('RegionalComplianceService', () => {
  let service: RegionalComplianceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionalComplianceService,
        EuGdprFramework,
        UsFinraFramework,
        NigeriaSecFramework,
        RegionDetector,
        { provide: getRepositoryToken(ComplianceCheck), useFactory: mockRepo },
        { provide: getRepositoryToken(RegionalRule), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get<RegionalComplianceService>(RegionalComplianceService);
    jest.spyOn(service['checkRepo'], 'save').mockResolvedValue({} as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should pass EU GDPR check when consent is provided', async () => {
    const result = await service.runCheck({
      userId: 'user-1',
      region: ComplianceRegion.EU,
      action: 'data_processing',
      payload: { hasConsent: true },
    });
    expect(result.passed).toBe(true);
    expect(result.region).toBe(ComplianceRegion.EU);
  });

  it('should fail EU GDPR check when consent is missing', async () => {
    const result = await service.runCheck({
      userId: 'user-1',
      region: ComplianceRegion.EU,
      action: 'data_processing',
      payload: { hasConsent: false },
    });
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('should detect US region from country code', () => {
    expect(service.detectRegion('US')).toBe(ComplianceRegion.US);
  });

  it('should detect EU region from German country code', () => {
    expect(service.detectRegion('DE')).toBe(ComplianceRegion.EU);
  });

  it('should detect NG region', () => {
    expect(service.detectRegion('NG')).toBe(ComplianceRegion.NG);
  });

  it('should return required documents for EU', () => {
    const docs = service.getRequiredDocuments(ComplianceRegion.EU);
    expect(docs).toContain('gdpr_consent_form');
  });

  it('should flag large FINRA trades', async () => {
    const result = await service.runCheck({
      userId: 'user-2',
      region: ComplianceRegion.US,
      action: 'trade',
      payload: { tradeValue: 100000 },
    });
    expect(result.violations.some((v) => v.ruleId === 'FINRA-006')).toBe(true);
  });

  it('should flag missing BVN for Nigeria', async () => {
    const result = await service.runCheck({
      userId: 'user-3',
      region: ComplianceRegion.NG,
      action: 'kyc',
      payload: { bvnVerified: false },
    });
    expect(result.violations.some((v) => v.ruleId === 'NSEC-001')).toBe(true);
  });
});
