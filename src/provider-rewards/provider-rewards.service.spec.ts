import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ProviderRewardsService,
  PROVIDER_FEE_RATE,
  MINIMUM_PAYOUT_THRESHOLD,
  RecordEarningInput,
} from './provider-rewards.service';
import { ProviderEarning } from './provider-earning.entity';
import { Payout, PayoutStatus } from './payout.entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockEarningRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const mockPayoutRepo = () => ({
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const buildQb = (rawResult: Record<string, string | null>) => ({
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getRawOne: jest.fn().mockResolvedValue(rawResult),
});

const makeEarning = (overrides: Partial<ProviderEarning> = {}): ProviderEarning =>
  ({
    id: 'earning-1',
    providerId: 'provider-1',
    signalId: 'signal-1',
    tradeId: 'trade-1',
    amount: 10,
    asset: 'USDC',
    tradedAmount: 10000,
    copierId: 'copier-1',
    createdAt: new Date('2024-01-01'),
    ...overrides,
  } as ProviderEarning);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProviderRewardsService', () => {
  let service: ProviderRewardsService;
  let earningRepo: jest.Mocked<Repository<ProviderEarning>>;
  let payoutRepo: jest.Mocked<Repository<Payout>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderRewardsService,
        { provide: getRepositoryToken(ProviderEarning), useFactory: mockEarningRepo },
        { provide: getRepositoryToken(Payout), useFactory: mockPayoutRepo },
      ],
    }).compile();

    service = module.get(ProviderRewardsService);
    earningRepo = module.get(getRepositoryToken(ProviderEarning));
    payoutRepo = module.get(getRepositoryToken(Payout));
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // recordEarning
  // -------------------------------------------------------------------------

  describe('recordEarning', () => {
    const input: RecordEarningInput = {
      providerId: 'provider-1',
      signalId: 'signal-1',
      tradeId: 'trade-1',
      tradedAmount: 10_000,
      asset: 'USDC',
      copierId: 'copier-1',
    };

    it('calculates earning as 0.1% of tradedAmount', async () => {
      earningRepo.findOne.mockResolvedValue(null);
      const built = makeEarning({ amount: 10 });
      earningRepo.create.mockReturnValue(built);
      earningRepo.save.mockResolvedValue(built);

      const result = await service.recordEarning(input);

      expect(earningRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: input.tradedAmount * PROVIDER_FEE_RATE,
        }),
      );
      expect(result.amount).toBe(10);
    });

    it('is idempotent: returns existing record without creating a duplicate', async () => {
      const existing = makeEarning();
      earningRepo.findOne.mockResolvedValue(existing);

      const result = await service.recordEarning(input);

      expect(earningRepo.create).not.toHaveBeenCalled();
      expect(earningRepo.save).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('persists all required fields on a new earning', async () => {
      earningRepo.findOne.mockResolvedValue(null);
      const built = makeEarning();
      earningRepo.create.mockReturnValue(built);
      earningRepo.save.mockResolvedValue(built);

      await service.recordEarning(input);

      expect(earningRepo.create).toHaveBeenCalledWith({
        providerId: input.providerId,
        signalId: input.signalId,
        tradeId: input.tradeId,
        tradedAmount: input.tradedAmount,
        amount: 10,
        asset: input.asset,
        copierId: input.copierId,
      });
    });

    it('rounds earning to 8 decimal places', async () => {
      const fractionalInput: RecordEarningInput = {
        ...input,
        tradedAmount: 0.123456789,
      };
      earningRepo.findOne.mockResolvedValue(null);
      const built = makeEarning({ amount: 0.00000012, tradedAmount: 0.123456789 });
      earningRepo.create.mockReturnValue(built);
      earningRepo.save.mockResolvedValue(built);

      await service.recordEarning(fractionalInput);

      const createCall = earningRepo.create.mock.calls[0][0];
      expect(createCall.amount).toBe(
        parseFloat((0.123456789 * PROVIDER_FEE_RATE).toFixed(8)),
      );
    });
  });

  // -------------------------------------------------------------------------
  // getEarningsSummary
  // -------------------------------------------------------------------------

  describe('getEarningsSummary', () => {
    const providerId = 'provider-1';

    const setupQueryBuilders = (
      totalEarnings: string | null,
      totalPaidOut: string | null,
    ) => {
      earningRepo.createQueryBuilder
        .mockReturnValueOnce(buildQb({ total: totalEarnings }) as any) // earnings sum
        .mockReturnValueOnce(buildQb({ total: null }) as any); // fallback (shouldn't be called)
      payoutRepo.createQueryBuilder
        .mockReturnValueOnce(buildQb({ total: totalPaidOut }) as any);
      earningRepo.find.mockResolvedValue([]);
      earningRepo.count.mockResolvedValue(5);
    };

    it('returns correct availableBalance = totalEarnings - totalPaidOut', async () => {
      earningRepo.createQueryBuilder.mockReturnValue(buildQb({ total: '100' }) as any);
      payoutRepo.createQueryBuilder.mockReturnValue(buildQb({ total: '40' }) as any);
      earningRepo.find.mockResolvedValue([]);
      earningRepo.count.mockResolvedValue(3);

      const summary = await service.getEarningsSummary(providerId);

      expect(summary.totalEarnings).toBe(100);
      expect(summary.totalPaidOut).toBe(40);
      expect(summary.availableBalance).toBe(60);
    });

    it('flags isEligibleForPayout = true when balance >= threshold', async () => {
      earningRepo.createQueryBuilder.mockReturnValue(buildQb({ total: '15' }) as any);
      payoutRepo.createQueryBuilder.mockReturnValue(buildQb({ total: '0' }) as any);
      earningRepo.find.mockResolvedValue([]);
      earningRepo.count.mockResolvedValue(1);

      const summary = await service.getEarningsSummary(providerId);

      expect(summary.isEligibleForPayout).toBe(true);
      expect(summary.minimumPayoutThreshold).toBe(MINIMUM_PAYOUT_THRESHOLD);
    });

    it('flags isEligibleForPayout = false when balance < threshold', async () => {
      earningRepo.createQueryBuilder.mockReturnValue(buildQb({ total: '5' }) as any);
      payoutRepo.createQueryBuilder.mockReturnValue(buildQb({ total: '0' }) as any);
      earningRepo.find.mockResolvedValue([]);
      earningRepo.count.mockResolvedValue(1);

      const summary = await service.getEarningsSummary(providerId);

      expect(summary.isEligibleForPayout).toBe(false);
    });

    it('handles providers with no earnings (null totals)', async () => {
      earningRepo.createQueryBuilder.mockReturnValue(buildQb({ total: null }) as any);
      payoutRepo.createQueryBuilder.mockReturnValue(buildQb({ total: null }) as any);
      earningRepo.find.mockResolvedValue([]);
      earningRepo.count.mockResolvedValue(0);

      const summary = await service.getEarningsSummary(providerId);

      expect(summary.totalEarnings).toBe(0);
      expect(summary.availableBalance).toBe(0);
      expect(summary.isEligibleForPayout).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getAvailableBalance
  // -------------------------------------------------------------------------

  describe('getAvailableBalance', () => {
    const providerId = 'provider-1';

    it('subtracts PENDING and PROCESSING payouts from earnings', async () => {
      earningRepo.createQueryBuilder.mockReturnValue(buildQb({ total: '200' }) as any);
      payoutRepo.createQueryBuilder.mockReturnValue(buildQb({ total: '50' }) as any);

      const balance = await service.getAvailableBalance(providerId);

      expect(balance).toBe(150);
    });

    it('returns 0 when all earnings are reserved', async () => {
      earningRepo.createQueryBuilder.mockReturnValue(buildQb({ total: '100' }) as any);
      payoutRepo.createQueryBuilder.mockReturnValue(buildQb({ total: '100' }) as any);

      const balance = await service.getAvailableBalance(providerId);

      expect(balance).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getPayoutHistory
  // -------------------------------------------------------------------------

  describe('getPayoutHistory', () => {
    it('returns mapped payout history sorted by createdAt DESC', async () => {
      const payouts: Payout[] = [
        {
          id: 'payout-1',
          providerId: 'provider-1',
          amount: 50 as any,
          asset: 'USDC',
          status: PayoutStatus.COMPLETED,
          destinationAddress: 'GABC',
          stellarTransactionId: 'tx-abc',
          failureReason: null,
          processedAt: new Date('2024-02-01'),
          createdAt: new Date('2024-02-01'),
          updatedAt: new Date('2024-02-01'),
        },
      ];
      payoutRepo.find.mockResolvedValue(payouts);

      const history = await service.getPayoutHistory('provider-1');

      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        id: 'payout-1',
        amount: 50,
        status: PayoutStatus.COMPLETED,
        stellarTransactionId: 'tx-abc',
      });
    });

    it('returns empty array when provider has no payouts', async () => {
      payoutRepo.find.mockResolvedValue([]);

      const history = await service.getPayoutHistory('unknown-provider');

      expect(history).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getEarnings (paginated)
  // -------------------------------------------------------------------------

  describe('getEarnings', () => {
    it('returns paginated earnings with total count', async () => {
      const earnings = [makeEarning(), makeEarning({ id: 'earning-2', tradeId: 'trade-2' })];
      earningRepo.findAndCount.mockResolvedValue([earnings, 2]);

      const result = await service.getEarnings('provider-1', 1, 20);

      expect(result.total).toBe(2);
      expect(result.data).toHaveLength(2);
      expect(earningRepo.findAndCount).toHaveBeenCalledWith({
        where: { providerId: 'provider-1' },
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 20,
      });
    });

    it('applies correct skip offset for page > 1', async () => {
      earningRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getEarnings('provider-1', 3, 10);

      expect(earningRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });
});
