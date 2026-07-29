import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TradeEligibilityService } from './trade-eligibility.service';
import { User, KycStatus, UserTier } from '../users/entities/user.entity';
import { ComplianceLog } from './entities/compliance-log.entity';

const mockUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-1',
    kycStatus: KycStatus.VERIFIED,
    tier: UserTier.GOLD,
    ...overrides,
  } as User);

describe('TradeEligibilityService', () => {
  let service: TradeEligibilityService;
  let userRepo: { findOne: jest.Mock };
  let logRepo: { create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    userRepo = { findOne: jest.fn() };
    logRepo = {
      create: jest.fn().mockImplementation((d) => d),
      save: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeEligibilityService,
        {
          provide: getRepositoryToken(User),
          useValue: userRepo,
        },
        {
          provide: getRepositoryToken(ComplianceLog),
          useValue: logRepo,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def: any) => {
              const map: Record<string, any> = {
                RESTRICTED_COUNTRIES: 'CU,IR,KP,SY',
                RESTRICTED_ASSETS: 'SCAM',
                AML_THRESHOLD: 100000,
              };
              return map[key] ?? def;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(TradeEligibilityService);
  });

  it('should approve a compliant trade', async () => {
    userRepo.findOne.mockResolvedValue(mockUser());

    const result = await service.checkEligibility({
      userId: 'user-1',
      baseAsset: 'XLM',
      counterAsset: 'USDC',
      amount: 500,
      countryCode: 'US',
    });

    expect(result.eligible).toBe(true);
    expect(result.reasons).toHaveLength(0);
    expect(result.checkedRules).toContain('geo_restriction');
    expect(result.checkedRules).toContain('kyc_aml_status');
    expect(logRepo.save).toHaveBeenCalled();
  });

  it('should reject trade from restricted country', async () => {
    userRepo.findOne.mockResolvedValue(mockUser());

    const result = await service.checkEligibility({
      userId: 'user-1',
      baseAsset: 'XLM',
      counterAsset: 'USDC',
      amount: 100,
      countryCode: 'IR',
    });

    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes('IR'))).toBe(true);
  });

  it('should reject trade when KYC is not verified', async () => {
    userRepo.findOne.mockResolvedValue(mockUser({ kycStatus: KycStatus.PENDING }));

    const result = await service.checkEligibility({
      userId: 'user-1',
      baseAsset: 'XLM',
      counterAsset: 'USDC',
      amount: 100,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes('KYC'))).toBe(true);
  });

  it('should reject trade involving restricted asset', async () => {
    userRepo.findOne.mockResolvedValue(mockUser());

    const result = await service.checkEligibility({
      userId: 'user-1',
      baseAsset: 'SCAM',
      counterAsset: 'USDC',
      amount: 100,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes('SCAM'))).toBe(true);
  });

  it('should reject trade exceeding AML threshold', async () => {
    userRepo.findOne.mockResolvedValue(mockUser());

    const result = await service.checkEligibility({
      userId: 'user-1',
      baseAsset: 'XLM',
      counterAsset: 'USDC',
      amount: 200000,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes('AML threshold'))).toBe(true);
  });

  it('should accumulate multiple violations', async () => {
    userRepo.findOne.mockResolvedValue(mockUser({ kycStatus: KycStatus.NONE }));

    const result = await service.checkEligibility({
      userId: 'user-1',
      baseAsset: 'XLM',
      counterAsset: 'USDC',
      amount: 200000,
      countryCode: 'KP',
    });

    expect(result.eligible).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });
});
