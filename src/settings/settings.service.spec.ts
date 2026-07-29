import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { NotFoundException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UserSettings } from './entities/user-settings.entity';
import { AuditService } from '../audit-log/audit.service';
import { AuditAction } from '../audit-log/entities/audit-log.entity';

const defaultSettings = {
  trading: { defaultOrderType: 'market', defaultSlippage: 1, confirmTrades: true },
  risk: { maxOpenPositions: 10, maxExposure: 50, requireStopLoss: true },
  display: { theme: 'dark', language: 'en', currency: 'USD' },
  notifications: { email: true, push: true, tradeFills: true, priceAlerts: true, systemUpdates: true },
};

const makeRecord = (userId = 'user-1'): UserSettings =>
  ({
    id: 'settings-id',
    userId,
    settings: { ...defaultSettings },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as UserSettings);

describe('SettingsService', () => {
  let service: SettingsService;
  let repo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock; delete: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let auditService: { log: jest.Mock };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((d) => d),
      save: jest.fn().mockImplementation((d) => Promise.resolve({ ...makeRecord(), ...d })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() };
    auditService = { log: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: getRepositoryToken(UserSettings), useValue: repo },
        { provide: CACHE_MANAGER, useValue: cache },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(SettingsService);
  });

  describe('getSettings', () => {
    it('should return cached settings when available', async () => {
      const cached = { userId: 'user-1', settings: defaultSettings, updatedAt: new Date() };
      cache.get.mockResolvedValue(cached);

      const result = await service.getSettings('user-1');
      expect(result).toEqual(cached);
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('should fetch from DB and cache when not cached', async () => {
      repo.findOne.mockResolvedValue(makeRecord());

      const result = await service.getSettings('user-1');
      expect(result.userId).toBe('user-1');
      expect(cache.set).toHaveBeenCalledWith('settings:user-1', expect.any(Object), 300000);
    });

    it('should create default settings for new user', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.getSettings('new-user');
      expect(repo.save).toHaveBeenCalled();
      expect(result.settings.display.theme).toBe('dark');
    });
  });

  describe('updateSettings', () => {
    it('should persist partial settings update', async () => {
      repo.findOne.mockResolvedValue(makeRecord());

      const result = await service.updateSettings('user-1', {
        display: { theme: 'light' },
      });

      expect(repo.save).toHaveBeenCalled();
      expect(cache.del).toHaveBeenCalledWith('settings:user-1');
    });

    it('should log the update to audit trail', async () => {
      repo.findOne.mockResolvedValue(makeRecord());

      await service.updateSettings('user-1', { notifications: { email: false } });

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          action: AuditAction.SETTINGS_UPDATED,
        }),
      );
    });

    it('should merge updates without overwriting unrelated fields', async () => {
      repo.findOne.mockResolvedValue(makeRecord());
      repo.save.mockImplementation((d) =>
        Promise.resolve({ ...makeRecord(), settings: d.settings }),
      );

      await service.updateSettings('user-1', { display: { theme: 'light' } });

      const savedArg = repo.save.mock.calls[0][0];
      expect(savedArg.settings.notifications.email).toBe(true);
    });
  });

  describe('resetSettings', () => {
    it('should reset to defaults and log audit', async () => {
      repo.findOne.mockResolvedValue(makeRecord());

      await service.resetSettings('user-1');

      expect(repo.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { reset: true } }),
      );
    });

    it('should throw NotFoundException when user settings not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.resetSettings('ghost-user')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteSettings', () => {
    it('should delete settings and invalidate cache', async () => {
      await service.deleteSettings('user-1');
      expect(repo.delete).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(cache.del).toHaveBeenCalledWith('settings:user-1');
    });

    it('should throw NotFoundException when nothing deleted', async () => {
      repo.delete.mockResolvedValue({ affected: 0 });
      await expect(service.deleteSettings('ghost-user')).rejects.toThrow(NotFoundException);
    });
  });
});
