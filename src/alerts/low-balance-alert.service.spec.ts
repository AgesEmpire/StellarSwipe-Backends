import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  LowBalanceAlertService,
  BalanceAlertContext,
} from './low-balance-alert.service';
import { CacheService } from '../cache/cache.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationChannel } from '../notifications/entities/notification.entity';

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string, def: unknown) => {
    const map: Record<string, unknown> = {
      'trade.minimumBalanceThreshold': 10,
      'alerts.lowBalanceCooldownSeconds': 86400,
      'trade.baseFeePercentage': 0.1,
    };
    return map[key] ?? def;
  }),
};

const mockCacheService = {
  get: jest.fn(),
  setWithTTL: jest.fn().mockResolvedValue(undefined),
};

const mockNotificationService = {
  send: jest.fn().mockResolvedValue({ id: 'notif-001' }),
};

const buildCtx = (available: string, overrides: Partial<BalanceAlertContext> = {}): BalanceAlertContext => ({
  userId: 'user-abc',
  walletAddress: 'GTEST123',
  balance: { available, locked: '0', total: available },
  ...overrides,
});

describe('LowBalanceAlertService', () => {
  let service: LowBalanceAlertService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LowBalanceAlertService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get(LowBalanceAlertService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Threshold evaluation ────────────────────────────────────────────────────

  describe('balance evaluation', () => {
    it('returns balance_sufficient when balance is above threshold', async () => {
      const result = await service.checkAndAlert(buildCtx('100'));

      expect(result.alerted).toBe(false);
      expect(result.reason).toBe('balance_sufficient');
      expect(mockNotificationService.send).not.toHaveBeenCalled();
    });

    it('returns balance_sufficient when balance equals threshold exactly', async () => {
      const result = await service.checkAndAlert(buildCtx('10'));

      expect(result.alerted).toBe(false);
      expect(result.reason).toBe('balance_sufficient');
    });

    it('triggers alert when balance is below threshold', async () => {
      mockCacheService.get.mockResolvedValue(null); // no cooldown

      const result = await service.checkAndAlert(buildCtx('5'));

      expect(result.alerted).toBe(true);
      expect(result.reason).toBe('below_threshold');
    });

    it('includes currentBalance and minimumThreshold in result', async () => {
      mockCacheService.get.mockResolvedValue(null);

      const result = await service.checkAndAlert(buildCtx('3'));

      expect(result.currentBalance).toBe('3');
      expect(result.minimumThreshold).toBe('10');
    });
  });

  // ── Alert content ───────────────────────────────────────────────────────────

  describe('alert generation', () => {
    it('sends an IN_APP notification with correct userId', async () => {
      mockCacheService.get.mockResolvedValue(null);

      await service.checkAndAlert(buildCtx('2', { userId: 'user-xyz' }));

      expect(mockNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-xyz',
          channel: NotificationChannel.IN_APP,
          type: 'LOW_BALANCE',
        }),
      );
    });

    it('alert message includes top-up wallet address', async () => {
      mockCacheService.get.mockResolvedValue(null);

      await service.checkAndAlert(buildCtx('2', { walletAddress: 'GWALLET999' }));

      const call = mockNotificationService.send.mock.calls[0][0];
      expect(call.message).toContain('GWALLET999');
    });

    it('alert message mentions the shortfall amount', async () => {
      mockCacheService.get.mockResolvedValue(null);

      await service.checkAndAlert(buildCtx('5'));

      // shortfall = 10 - 5 = 5
      const call = mockNotificationService.send.mock.calls[0][0];
      expect(call.message).toContain('5.00000000');
    });

    it('includes estimatedTradeCapacity in result', async () => {
      mockCacheService.get.mockResolvedValue(null);

      const result = await service.checkAndAlert(buildCtx('5'));

      expect(result.estimatedTradeCapacity).toBeDefined();
    });

    it('includes trade capacity coverage percentage when requestedTradeAmount given', async () => {
      mockCacheService.get.mockResolvedValue(null);

      const result = await service.checkAndAlert(
        buildCtx('5', { requestedTradeAmount: 20 }),
      );

      expect(result.estimatedTradeCapacity).toMatch(/%.*requested/i);
    });

    it('alert metadata includes walletAddress and current balance', async () => {
      mockCacheService.get.mockResolvedValue(null);

      await service.checkAndAlert(buildCtx('3', { walletAddress: 'GMETA001' }));

      const call = mockNotificationService.send.mock.calls[0][0];
      expect(call.metadata).toMatchObject({
        walletAddress: 'GMETA001',
        currentBalance: '3',
      });
    });
  });

  // ── Cooldown ────────────────────────────────────────────────────────────────

  describe('cooldown window', () => {
    it('suppresses alert when cooldown is active', async () => {
      mockCacheService.get.mockResolvedValue('1'); // sentinel present

      const result = await service.checkAndAlert(buildCtx('2'));

      expect(result.alerted).toBe(false);
      expect(result.reason).toBe('cooldown_active');
      expect(mockNotificationService.send).not.toHaveBeenCalled();
    });

    it('sets cooldown key after sending alert', async () => {
      mockCacheService.get.mockResolvedValue(null);

      await service.checkAndAlert(buildCtx('2'));

      expect(mockCacheService.setWithTTL).toHaveBeenCalledWith(
        expect.stringContaining('user-abc'),
        '1',
        86400,
      );
    });

    it('does not set cooldown when balance is sufficient', async () => {
      await service.checkAndAlert(buildCtx('50'));

      expect(mockCacheService.setWithTTL).not.toHaveBeenCalled();
    });

    it('does not set cooldown when alert is suppressed by cooldown', async () => {
      mockCacheService.get.mockResolvedValue('1');

      await service.checkAndAlert(buildCtx('2'));

      expect(mockCacheService.setWithTTL).not.toHaveBeenCalled();
    });
  });

  // ── isInCooldown ────────────────────────────────────────────────────────────

  describe('isInCooldown', () => {
    it('returns true when cache key exists', async () => {
      mockCacheService.get.mockResolvedValue('1');

      expect(await service.isInCooldown('user-abc')).toBe(true);
    });

    it('returns false when cache key is absent', async () => {
      mockCacheService.get.mockResolvedValue(null);

      expect(await service.isInCooldown('user-abc')).toBe(false);
    });

    it('returns false when cache key is undefined', async () => {
      mockCacheService.get.mockResolvedValue(undefined);

      expect(await service.isInCooldown('user-abc')).toBe(false);
    });
  });
});
