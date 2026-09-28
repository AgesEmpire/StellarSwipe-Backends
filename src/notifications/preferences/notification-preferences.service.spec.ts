import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationPreference } from './entities/notification-preference.entity';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

const mockPreference = (): NotificationPreference => ({
  id: 'pref-uuid-1',
  userId: 'user-uuid-1',
  tradeUpdatesEmail: true,
  tradeUpdatesPush: true,
  signalPerformanceEmail: true,
  signalPerformancePush: true,
  systemAlertsEmail: true,
  systemAlertsPush: true,
  marketingEmail: false,
  marketingPush: false,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
});

describe('NotificationPreferencesService', () => {
  let service: NotificationPreferencesService;
  let repo: jest.Mocked<Repository<NotificationPreference>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPreferencesService,
        {
          provide: getRepositoryToken(NotificationPreference),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<NotificationPreferencesService>(NotificationPreferencesService);
    repo = module.get(getRepositoryToken(NotificationPreference));
  });

  afterEach(() => jest.clearAllMocks());

  // ─── getPreferences ───────────────────────────────────────────────────────

  describe('getPreferences', () => {
    it('returns existing preferences for a user', async () => {
      const pref = mockPreference();
      repo.findOne.mockResolvedValue(pref);

      const result = await service.getPreferences('user-uuid-1');

      expect(repo.findOne).toHaveBeenCalledWith({ where: { userId: 'user-uuid-1' } });
      expect(result.userId).toBe('user-uuid-1');
      expect(result.tradeUpdates).toEqual({ email: true, push: true });
      expect(result.marketing).toEqual({ email: false, push: false });
    });

    it('creates default preferences when none exist', async () => {
      const pref = mockPreference();
      repo.findOne.mockResolvedValue(null);
      repo.create.mockReturnValue(pref);
      repo.save.mockResolvedValue(pref);

      const result = await service.getPreferences('user-uuid-1');

      expect(repo.create).toHaveBeenCalledWith({ userId: 'user-uuid-1' });
      expect(repo.save).toHaveBeenCalled();
      expect(result.userId).toBe('user-uuid-1');
    });
  });

  // ─── updatePreferences ────────────────────────────────────────────────────

  describe('updatePreferences', () => {
    it('updates only the provided fields', async () => {
      const pref = mockPreference();
      repo.findOne.mockResolvedValue(pref);
      repo.save.mockImplementation(async (p) => p as NotificationPreference);

      const dto: UpdatePreferencesDto = {
        marketing: { email: true, push: true },
      };

      const result = await service.updatePreferences('user-uuid-1', dto);

      expect(result.marketing).toEqual({ email: true, push: true });
      // Other fields should remain unchanged
      expect(result.tradeUpdates).toEqual({ email: true, push: true });
    });

    it('updates email-only channel preference', async () => {
      const pref = mockPreference();
      repo.findOne.mockResolvedValue(pref);
      repo.save.mockImplementation(async (p) => p as NotificationPreference);

      const dto: UpdatePreferencesDto = {
        tradeUpdates: { email: false },
      };

      const result = await service.updatePreferences('user-uuid-1', dto);

      expect(result.tradeUpdates.email).toBe(false);
      expect(result.tradeUpdates.push).toBe(true); // unchanged
    });

    it('updates multiple notification types at once', async () => {
      const pref = mockPreference();
      repo.findOne.mockResolvedValue(pref);
      repo.save.mockImplementation(async (p) => p as NotificationPreference);

      const dto: UpdatePreferencesDto = {
        signalPerformance: { email: false, push: false },
        systemAlerts: { push: false },
      };

      const result = await service.updatePreferences('user-uuid-1', dto);

      expect(result.signalPerformance).toEqual({ email: false, push: false });
      expect(result.systemAlerts.push).toBe(false);
      expect(result.systemAlerts.email).toBe(true); // unchanged
    });
  });

  // ─── isEnabled ────────────────────────────────────────────────────────────

  describe('isEnabled', () => {
    it('returns true when the channel is enabled', async () => {
      repo.findOne.mockResolvedValue(mockPreference());

      const result = await service.isEnabled('user-uuid-1', 'tradeUpdates', 'email');

      expect(result).toBe(true);
    });

    it('returns false when the channel is disabled', async () => {
      repo.findOne.mockResolvedValue(mockPreference());

      const result = await service.isEnabled('user-uuid-1', 'marketing', 'email');

      expect(result).toBe(false);
    });

    it('creates default preferences and returns default value when user has no record', async () => {
      const pref = mockPreference();
      repo.findOne.mockResolvedValue(null);
      repo.create.mockReturnValue(pref);
      repo.save.mockResolvedValue(pref);

      const result = await service.isEnabled('new-user', 'systemAlerts', 'push');

      expect(result).toBe(true); // default is true for systemAlerts
    });
  });

  // ─── unsubscribe ──────────────────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('disables the specified channel for the given type', async () => {
      const pref = mockPreference();
      repo.findOne.mockResolvedValue(pref);
      repo.save.mockImplementation(async (p) => p as NotificationPreference);

      const result = await service.unsubscribe('user-uuid-1', 'marketing', 'push');

      expect(result.marketing.push).toBe(false);
    });

    it('only disables the targeted channel, leaving others intact', async () => {
      const pref = mockPreference();
      repo.findOne.mockResolvedValue(pref);
      repo.save.mockImplementation(async (p) => p as NotificationPreference);

      const result = await service.unsubscribe('user-uuid-1', 'tradeUpdates', 'email');

      expect(result.tradeUpdates.email).toBe(false);
      expect(result.tradeUpdates.push).toBe(true); // push remains enabled
    });
  });

  // ─── Preference persistence ───────────────────────────────────────────────

  describe('preference persistence', () => {
    it('persists updated preferences to the repository', async () => {
      const pref = mockPreference();
      repo.findOne.mockResolvedValue(pref);
      repo.save.mockImplementation(async (p) => p as NotificationPreference);

      await service.updatePreferences('user-uuid-1', {
        marketing: { email: true },
      });

      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('returns a well-formed PreferenceDto with all channels', async () => {
      repo.findOne.mockResolvedValue(mockPreference());

      const result = await service.getPreferences('user-uuid-1');

      expect(result).toMatchObject({
        userId: 'user-uuid-1',
        tradeUpdates: expect.objectContaining({ email: expect.any(Boolean), push: expect.any(Boolean) }),
        signalPerformance: expect.objectContaining({ email: expect.any(Boolean), push: expect.any(Boolean) }),
        systemAlerts: expect.objectContaining({ email: expect.any(Boolean), push: expect.any(Boolean) }),
        marketing: expect.objectContaining({ email: expect.any(Boolean), push: expect.any(Boolean) }),
        updatedAt: expect.any(Date),
      });
    });
  });
});
