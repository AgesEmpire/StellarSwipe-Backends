import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PremiumSignalService } from './premium-signal.service';
import { Signal, SignalStatus, SignalType, SignalOutcome } from './entities/signal.entity';
import { PremiumSubscription, SubscriptionStatus } from './entities/premium-subscription.entity';

const mockSignal = (overrides: Partial<Signal> = {}): Signal => ({
  id: 'signal-1',
  providerId: 'provider-1',
  baseAsset: 'XLM',
  counterAsset: 'USDC',
  type: SignalType.BUY,
  status: SignalStatus.ACTIVE,
  outcome: SignalOutcome.PENDING,
  entryPrice: '0.12',
  targetPrice: '0.15',
  stopLossPrice: '0.10',
  isPremium: true,
  premiumPrice: '9.99',
  premiumCurrency: 'USD',
  confidenceScore: 80,
  copiersCount: 0,
  totalCopiedVolume: '0',
  expiresAt: new Date(Date.now() + 86400000),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
} as Signal);

describe('PremiumSignalService', () => {
  let service: PremiumSignalService;
  const signalRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
  const subRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn((v) => v), save: jest.fn((v) => Promise.resolve(v)) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PremiumSignalService,
        { provide: getRepositoryToken(Signal), useValue: signalRepo },
        { provide: getRepositoryToken(PremiumSubscription), useValue: subRepo },
      ],
    }).compile();
    service = module.get(PremiumSignalService);
    jest.clearAllMocks();
  });

  describe('getSignalForUser', () => {
    it('returns full signal to subscribed user', async () => {
      signalRepo.findOne.mockResolvedValue(mockSignal());
      subRepo.findOne.mockResolvedValue({ status: SubscriptionStatus.ACTIVE, expiresAt: null });

      const result = await service.getSignalForUser('signal-1', 'user-1');
      expect((result as Signal).entryPrice).toBe('0.12');
    });

    it('strips restricted fields for non-subscriber', async () => {
      signalRepo.findOne.mockResolvedValue(mockSignal());
      subRepo.findOne.mockResolvedValue(null);

      const result = await service.getSignalForUser('signal-1', 'user-1');
      expect((result as any).entryPrice).toBeUndefined();
      expect((result as any).metadata?.premiumLocked).toBe(true);
    });

    it('returns full signal for non-premium signal without subscription check', async () => {
      signalRepo.findOne.mockResolvedValue(mockSignal({ isPremium: false }));

      const result = await service.getSignalForUser('signal-1', 'user-1');
      expect((result as Signal).entryPrice).toBe('0.12');
      expect(subRepo.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for missing signal', async () => {
      signalRepo.findOne.mockResolvedValue(null);
      await expect(service.getSignalForUser('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateSignalPremiumStatus', () => {
    it('allows provider to update premium status', async () => {
      signalRepo.findOne.mockResolvedValue(mockSignal({ isPremium: false }));
      signalRepo.save.mockImplementation((s) => Promise.resolve(s));

      const result = await service.updateSignalPremiumStatus('signal-1', 'provider-1', { isPremium: true, premiumPrice: 9.99 });
      expect(result.isPremium).toBe(true);
    });

    it('throws ForbiddenException for non-provider', async () => {
      signalRepo.findOne.mockResolvedValue(mockSignal());
      await expect(
        service.updateSignalPremiumStatus('signal-1', 'other-user', { isPremium: false }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('isSubscribed', () => {
    it('returns false for expired subscription', async () => {
      subRepo.findOne.mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
        expiresAt: new Date(Date.now() - 1000),
      });
      subRepo.save.mockResolvedValue({});
      const result = await service.isSubscribed('user-1', 'provider-1');
      expect(result).toBe(false);
    });
  });
});
