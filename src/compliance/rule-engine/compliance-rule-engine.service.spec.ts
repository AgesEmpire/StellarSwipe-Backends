import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

import { ComplianceRuleEngineService } from './compliance-rule-engine.service';
import { KycStatusRule } from './rules/kyc-status.rule';
import { GeographicRestrictionRule } from './rules/geographic-restriction.rule';
import { AmlStatusRule } from './rules/aml-status.rule';
import { AssetClassRestrictionRule } from './rules/asset-class-restriction.rule';
import { TransactionLimitRule } from './rules/transaction-limit.rule';
import {
  TradeEligibilityDecision,
  EligibilityDecisionOutcome,
} from './entities/trade-eligibility-decision.entity';
import { User, KycStatus, UserTier } from '../../users/entities/user.entity';
import { AmlMonitoringService } from '../aml/aml-monitoring.service';
import { GeoBlockService } from '../geo-blocking/geo-block.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-001',
    username: 'trader',
    kycStatus: KycStatus.VERIFIED,
    tier: UserTier.GOLD,
    isActive: true,
    reputationScore: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    signals: [],
    trades: [],
    sessions: [],
    ...overrides,
  } as User;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('ComplianceRuleEngineService', () => {
  let service: ComplianceRuleEngineService;
  let userRepository: { findOne: jest.Mock };
  let decisionRepository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let amlMonitoringService: { getUserRiskScore: jest.Mock };
  let geoBlockService: { getGeoLocation: jest.Mock };

  const baseInput = {
    userId: 'user-001',
    amount: 1000,
    asset: 'XLM',
    counterAsset: 'USDC',
    ipAddress: '192.168.1.1',
  };

  beforeEach(async () => {
    userRepository = { findOne: jest.fn() };
    decisionRepository = {
      create: jest
        .fn()
        .mockImplementation((dto) => ({ ...dto, id: 'decision-uuid' })),
      save: jest
        .fn()
        .mockImplementation((entity) =>
          Promise.resolve({ ...entity, id: 'decision-uuid' }),
        ),
      find: jest.fn().mockResolvedValue([]),
    };
    amlMonitoringService = { getUserRiskScore: jest.fn().mockResolvedValue(0) };
    geoBlockService = {
      getGeoLocation: jest.fn().mockResolvedValue({
        country: 'Local',
        countryCode: 'XX',
        isVPN: false,
        isProxy: false,
        isTor: false,
        ip: '192.168.1.1',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplianceRuleEngineService,
        KycStatusRule,
        AmlStatusRule,
        TransactionLimitRule,
        {
          provide: GeographicRestrictionRule,
          useFactory: (cfg: ConfigService) =>
            new GeographicRestrictionRule(cfg),
          inject: [ConfigService],
        },
        {
          provide: AssetClassRestrictionRule,
          useFactory: (cfg: ConfigService) =>
            new AssetClassRestrictionRule(cfg),
          inject: [ConfigService],
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === 'BLOCKED_COUNTRIES') return 'CU,IR,KP,SY';
              if (key === 'RESTRICTED_ASSETS') return 'SCAM,FAKE';
              return defaultValue;
            }),
          },
        },
        { provide: getRepositoryToken(User), useValue: userRepository },
        {
          provide: getRepositoryToken(TradeEligibilityDecision),
          useValue: decisionRepository,
        },
        { provide: AmlMonitoringService, useValue: amlMonitoringService },
        { provide: GeoBlockService, useValue: geoBlockService },
      ],
    }).compile();

    service = module.get<ComplianceRuleEngineService>(
      ComplianceRuleEngineService,
    );
  });

  // ── Compliant scenarios ────────────────────────────────────────────────────

  describe('compliant trade scenarios', () => {
    it('approves a fully compliant trade', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());

      const result = await service.evaluateTrade(baseInput);

      expect(result.eligible).toBe(true);
      expect(result.outcome).toBe('approved');
      expect(result.reasons).toHaveLength(0);
      expect(result.ruleResults.every((r) => r.passed)).toBe(true);
      expect(result.decisionId).toBe('decision-uuid');
    });

    it('persists an APPROVED decision record', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());

      await service.evaluateTrade(baseInput);

      expect(decisionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: EligibilityDecisionOutcome.APPROVED,
        }),
      );
    });

    it('approves a PLATINUM user trading at the tier limit', async () => {
      userRepository.findOne.mockResolvedValue(
        makeUser({ tier: UserTier.PLATINUM }),
      );

      const result = await service.evaluateTrade({
        ...baseInput,
        amount: 100_000,
      });

      expect(result.eligible).toBe(true);
    });

    it('approves when no country code is available (geo rule skips)', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());
      geoBlockService.getGeoLocation.mockRejectedValue(new Error('timeout'));

      const result = await service.evaluateTrade(baseInput);

      expect(result.eligible).toBe(true);
    });

    it('approves when AML service is unavailable (falls back to amount check)', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());
      amlMonitoringService.getUserRiskScore.mockRejectedValue(
        new Error('AML down'),
      );

      const result = await service.evaluateTrade(baseInput);

      expect(result.eligible).toBe(true);
    });
  });

  // ── Non-compliant scenarios ────────────────────────────────────────────────

  describe('non-compliant trade scenarios', () => {
    it('rejects a trade when KYC is PENDING', async () => {
      userRepository.findOne.mockResolvedValue(
        makeUser({ kycStatus: KycStatus.PENDING }),
      );

      await expect(service.evaluateTrade(baseInput)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a trade when KYC is NONE', async () => {
      userRepository.findOne.mockResolvedValue(
        makeUser({ kycStatus: KycStatus.NONE }),
      );

      await expect(service.evaluateTrade(baseInput)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a trade when KYC is REJECTED', async () => {
      userRepository.findOne.mockResolvedValue(
        makeUser({ kycStatus: KycStatus.REJECTED }),
      );

      await expect(service.evaluateTrade(baseInput)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a trade from a blocked country (IR)', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());
      geoBlockService.getGeoLocation.mockResolvedValue({
        country: 'Iran',
        countryCode: 'IR',
        isVPN: false,
        isProxy: false,
        isTor: false,
        ip: '1.2.3.4',
      });

      await expect(service.evaluateTrade(baseInput)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a trade from a blocked country (KP)', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());
      geoBlockService.getGeoLocation.mockResolvedValue({
        country: 'North Korea',
        countryCode: 'KP',
        isVPN: false,
        isProxy: false,
        isTor: false,
        ip: '5.6.7.8',
      });

      await expect(service.evaluateTrade(baseInput)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a trade when the user has open AML flags', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());
      amlMonitoringService.getUserRiskScore.mockResolvedValue(75);

      await expect(service.evaluateTrade(baseInput)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a trade that exceeds the AML hard threshold', async () => {
      userRepository.findOne.mockResolvedValue(
        makeUser({ tier: UserTier.PLATINUM }),
      );

      await expect(
        service.evaluateTrade({ ...baseInput, amount: 1_500_000 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a trade involving a restricted asset', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());

      await expect(
        service.evaluateTrade({ ...baseInput, asset: 'SCAM' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a trade involving a restricted counter asset', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());

      await expect(
        service.evaluateTrade({ ...baseInput, counterAsset: 'FAKE' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a BASIC-tier trade that exceeds the 1000 limit', async () => {
      userRepository.findOne.mockResolvedValue(
        makeUser({ tier: UserTier.BASIC }),
      );

      await expect(
        service.evaluateTrade({ ...baseInput, amount: 1_500 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a SILVER-tier trade that exceeds the 5000 limit', async () => {
      userRepository.findOne.mockResolvedValue(
        makeUser({ tier: UserTier.SILVER }),
      );

      await expect(
        service.evaluateTrade({ ...baseInput, amount: 6_000 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('includes rejection reasons in the ForbiddenException body', async () => {
      userRepository.findOne.mockResolvedValue(
        makeUser({ kycStatus: KycStatus.PENDING }),
      );

      try {
        await service.evaluateTrade(baseInput);
        fail('Expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const body = (err as ForbiddenException).getResponse() as Record<
          string,
          unknown
        >;
        expect(body.reasons).toBeInstanceOf(Array);
        expect((body.reasons as string[]).length).toBeGreaterThan(0);
        expect(body.decisionId).toBeDefined();
      }
    });

    it('persists a REJECTED decision record', async () => {
      userRepository.findOne.mockResolvedValue(
        makeUser({ kycStatus: KycStatus.PENDING }),
      );

      await expect(service.evaluateTrade(baseInput)).rejects.toThrow();

      expect(decisionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: EligibilityDecisionOutcome.REJECTED,
        }),
      );
    });
  });

  // ── Preview (non-throwing) ─────────────────────────────────────────────────

  describe('previewTradeEligibility', () => {
    it('returns eligible=true for a compliant trade', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());

      const result = await service.previewTradeEligibility(baseInput);

      expect(result.eligible).toBe(true);
      expect(result.outcome).toBe('approved');
    });

    it('returns eligible=false without throwing for a non-compliant trade', async () => {
      userRepository.findOne.mockResolvedValue(
        makeUser({ kycStatus: KycStatus.PENDING }),
      );

      const result = await service.previewTradeEligibility(baseInput);

      expect(result.eligible).toBe(false);
      expect(result.outcome).toBe('rejected');
      expect(result.reasons.length).toBeGreaterThan(0);
    });
  });

  // ── User not found ─────────────────────────────────────────────────────────

  describe('user not found', () => {
    it('throws BadRequestException when user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.evaluateTrade(baseInput)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── Audit log retrieval ────────────────────────────────────────────────────

  describe('getDecisionsForUser', () => {
    it('returns decisions for a user', async () => {
      const mockDecisions = [
        {
          id: 'd1',
          userId: 'user-001',
          outcome: EligibilityDecisionOutcome.APPROVED,
        },
      ];
      decisionRepository.find.mockResolvedValue(mockDecisions);

      const result = await service.getDecisionsForUser('user-001');

      expect(result).toEqual(mockDecisions);
      expect(decisionRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-001' } }),
      );
    });
  });
});

// ─── Individual rule unit tests ───────────────────────────────────────────────

describe('KycStatusRule', () => {
  const rule = new KycStatusRule();

  it('passes for VERIFIED status', async () => {
    const result = await rule.evaluate({
      userId: 'u1',
      amount: 100,
      asset: 'XLM',
      kycStatus: KycStatus.VERIFIED,
    });
    expect(result.passed).toBe(true);
  });

  it('fails for PENDING status', async () => {
    const result = await rule.evaluate({
      userId: 'u1',
      amount: 100,
      asset: 'XLM',
      kycStatus: KycStatus.PENDING,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('KYC status');
  });

  it('fails when kycStatus is undefined', async () => {
    const result = await rule.evaluate({
      userId: 'u1',
      amount: 100,
      asset: 'XLM',
    });
    expect(result.passed).toBe(false);
  });
});

describe('AmlStatusRule', () => {
  const rule = new AmlStatusRule();

  it('passes when no AML flags and amount is below threshold', async () => {
    const result = await rule.evaluate({
      userId: 'u1',
      amount: 500,
      asset: 'XLM',
      hasAmlFlags: false,
    });
    expect(result.passed).toBe(true);
  });

  it('fails when user has open AML flags', async () => {
    const result = await rule.evaluate({
      userId: 'u1',
      amount: 500,
      asset: 'XLM',
      hasAmlFlags: true,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('AML');
  });

  it('fails when amount exceeds hard threshold', async () => {
    const result = await rule.evaluate({
      userId: 'u1',
      amount: 2_000_000,
      asset: 'XLM',
      hasAmlFlags: false,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('threshold');
  });
});

describe('TransactionLimitRule', () => {
  const rule = new TransactionLimitRule();

  it.each([
    [UserTier.BASIC, 1000, true],
    [UserTier.BASIC, 1001, false],
    [UserTier.SILVER, 5000, true],
    [UserTier.SILVER, 5001, false],
    [UserTier.GOLD, 20000, true],
    [UserTier.GOLD, 20001, false],
    [UserTier.PLATINUM, 100000, true],
    [UserTier.PLATINUM, 100001, false],
  ])('%s tier: amount=%d → passed=%s', async (tier, amount, expected) => {
    const result = await rule.evaluate({
      userId: 'u1',
      amount,
      asset: 'XLM',
      userTier: tier,
    });
    expect(result.passed).toBe(expected);
  });
});

describe('GeographicRestrictionRule', () => {
  const configService = {
    get: (key: string, def: string) =>
      key === 'BLOCKED_COUNTRIES' ? 'CU,IR,KP' : def,
  } as unknown as ConfigService;

  const rule = new GeographicRestrictionRule(configService);

  it('passes for an allowed country', async () => {
    const result = await rule.evaluate({
      userId: 'u1',
      amount: 100,
      asset: 'XLM',
      countryCode: 'US',
    });
    expect(result.passed).toBe(true);
  });

  it('fails for a blocked country', async () => {
    const result = await rule.evaluate({
      userId: 'u1',
      amount: 100,
      asset: 'XLM',
      countryCode: 'IR',
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('IR');
  });

  it('passes when no country code is provided', async () => {
    const result = await rule.evaluate({
      userId: 'u1',
      amount: 100,
      asset: 'XLM',
    });
    expect(result.passed).toBe(true);
  });

  it('is case-insensitive for country codes', async () => {
    const result = await rule.evaluate({
      userId: 'u1',
      amount: 100,
      asset: 'XLM',
      countryCode: 'ir',
    });
    expect(result.passed).toBe(false);
  });
});

describe('AssetClassRestrictionRule', () => {
  const configService = {
    get: (key: string, def: string) =>
      key === 'RESTRICTED_ASSETS' ? 'SCAM,FAKE' : def,
  } as unknown as ConfigService;

  const rule = new AssetClassRestrictionRule(configService);

  it('passes for unrestricted assets', async () => {
    const result = await rule.evaluate({
      userId: 'u1',
      amount: 100,
      asset: 'XLM',
      counterAsset: 'USDC',
    });
    expect(result.passed).toBe(true);
  });

  it('fails when base asset is restricted', async () => {
    const result = await rule.evaluate({
      userId: 'u1',
      amount: 100,
      asset: 'SCAM',
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('SCAM');
  });

  it('fails when counter asset is restricted', async () => {
    const result = await rule.evaluate({
      userId: 'u1',
      amount: 100,
      asset: 'XLM',
      counterAsset: 'FAKE',
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('FAKE');
  });

  it('passes when RESTRICTED_ASSETS is empty', async () => {
    const emptyCfg = {
      get: (_k: string, d: string) => d,
    } as unknown as ConfigService;
    const emptyRule = new AssetClassRestrictionRule(emptyCfg);
    const result = await emptyRule.evaluate({
      userId: 'u1',
      amount: 100,
      asset: 'ANYTHING',
    });
    expect(result.passed).toBe(true);
  });
});
