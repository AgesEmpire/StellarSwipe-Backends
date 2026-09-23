import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { RecoveryCodeService } from './recovery-code.service';
import { TwoFactor } from './entities/two-factor.entity';
import { AuditService } from '../../../audit-log/audit.service';
import { AuditAction, AuditStatus } from '../../../audit-log/entities/audit-log.entity';

jest.mock('bcrypt');

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('RecoveryCodeService', () => {
  let service: RecoveryCodeService;
  let twoFactorRepoSpec: any;
  let cacheManagerSpec: any;
  let auditServiceSpec: any;

  const userId = 'user-uuid';
  const recordId = 'record-uuid';

  const mockCacheStore = new Map<string, number>();

  const baseRecord: Partial<TwoFactor> = {
    id: recordId,
    userId,
    enabled: true,
    backupCodes: ['HASHED_CODE_1', 'HASHED_CODE_2', 'HASHED_CODE_3'],
    recoveryCodesGeneratedAt: new Date('2025-01-01T00:00:00Z'),
    recoveryCodesUsedCount: 0,
  };

  beforeEach(async () => {
    mockCacheStore.clear();
    jest.clearAllMocks();

    mockedBcrypt.hash.mockImplementation(
      (code: string) => Promise.resolve(`hashed:${code}`),
    );
    mockedBcrypt.compare.mockImplementation(
      (provided: string, hashed: string) =>
        Promise.resolve(hashed === `hashed:${provided}`),
    );

    twoFactorRepoSpec = {
      findOne: jest.fn().mockResolvedValue({ ...baseRecord }),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    cacheManagerSpec = {
      set: jest.fn().mockImplementation((key, value) => {
        mockCacheStore.set(key, value);
      }),
      get: jest.fn().mockImplementation((key) => mockCacheStore.get(key)),
      del: jest.fn().mockImplementation((key) => mockCacheStore.delete(key)),
    };

    auditServiceSpec = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecoveryCodeService,
        {
          provide: getRepositoryToken(TwoFactor),
          useValue: twoFactorRepoSpec,
        },
        { provide: CACHE_MANAGER, useValue: cacheManagerSpec },
        { provide: AuditService, useValue: auditServiceSpec },
      ],
    }).compile();

    service = module.get<RecoveryCodeService>(RecoveryCodeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generate', () => {
    it('generates 10 codes, stores hashed versions, and returns plaintext once', async () => {
      const result = await service.generate(userId);

      expect(result).toHaveLength(10);
      result.forEach((code) => {
        expect(code).toMatch(/^[0-9A-F]{10}$/);
      });
      expect(bcrypt.hash).toHaveBeenCalledTimes(10);
      expect(twoFactorRepoSpec.save).toHaveBeenCalled();
    });

    it('sets generatedAt timestamp and resets used count', async () => {
      await service.generate(userId);
      const saved = (twoFactorRepoSpec.save as jest.Mock).mock.calls[0][0];
      expect(saved.recoveryCodesGeneratedAt).toBeInstanceOf(Date);
      expect(saved.recoveryCodesUsedCount).toBe(0);
    });

    it('audits RECOVERY_CODES_GENERATED', async () => {
      await service.generate(userId);
      expect(auditServiceSpec.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.RECOVERY_CODES_GENERATED,
          status: AuditStatus.SUCCESS,
        }),
      );
    });

    it('throws if 2FA is not enabled', async () => {
      twoFactorRepoSpec.findOne.mockResolvedValue({
        ...baseRecord,
        enabled: false,
      });
      await expect(service.generate(userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('consume', () => {
    it('consumes a valid recovery code and returns remaining count', async () => {
      const result = await service.consume(userId, 'CODE_1');

      expect(result.remainingCodes).toBe(2);
      expect(bcrypt.compare).toHaveBeenCalled();
      expect(twoFactorRepoSpec.save).toHaveBeenCalled();
    });

    it('removes only the matched hash (one-time use)', async () => {
      await service.consume(userId, 'CODE_1');
      const saved = (twoFactorRepoSpec.save as jest.Mock).mock.calls[0][0];
      expect(saved.backupCodes).toHaveLength(2);
      expect(saved.backupCodes).not.toContain('hashed:CODE_1');
    });

    it('increments used count', async () => {
      await service.consume(userId, 'CODE_1');
      const saved = (twoFactorRepoSpec.save as jest.Mock).mock.calls[0][0];
      expect(saved.recoveryCodesUsedCount).toBe(1);
    });

    it('audits RECOVERY_CODE_USED on success', async () => {
      await service.consume(userId, 'CODE_1');
      expect(auditServiceSpec.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.RECOVERY_CODE_USED,
          status: AuditStatus.SUCCESS,
        }),
      );
    });

    it('throws UnauthorizedException for an invalid code', async () => {
      mockedBcrypt.compare.mockResolvedValue(false);

      await expect(service.consume(userId, 'BAD_CODE')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('audits RECOVERY_CODE_FAILED on invalid code', async () => {
      mockedBcrypt.compare.mockResolvedValue(false);

      await expect(service.consume(userId, 'BAD_CODE')).rejects.toThrow();
      expect(auditServiceSpec.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.RECOVERY_CODE_FAILED,
          status: AuditStatus.FAILURE,
        }),
      );
    });

    it('throws BadRequestException if 2FA is not enabled', async () => {
      twoFactorRepoSpec.findOne.mockResolvedValue({
        ...baseRecord,
        enabled: false,
      });
      await expect(service.consume(userId, 'CODE_1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rate-limits after 5 failed attempts', async () => {
      mockedBcrypt.compare.mockResolvedValue(false);

      for (let i = 0; i < 5; i++) {
        try {
          await service.consume(userId, `BAD_${i}`);
        } catch {
          // expected
        }
      }

      await expect(service.consume(userId, 'BAD_6')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('clears user rate limit on successful consumption', async () => {
      mockCacheStore.set(`recovery_consume:${userId}`, 3);
      await service.consume(userId, 'CODE_1');
      expect(mockCacheStore.has(`recovery_consume:${userId}`)).toBe(false);
    });
  });

  describe('regenerate', () => {
    it('invalidates old codes and issues a fresh set', async () => {
      const result = await service.regenerate(userId);

      expect(result).toHaveLength(10);
      result.forEach((code) => {
        expect(code).toMatch(/^[0-9A-F]{10}$/);
      });
    });

    it('resets used count and updates generatedAt', async () => {
      const saved = (twoFactorRepoSpec.save as jest.Mock).mock.calls[0][0];
      expect(saved.recoveryCodesUsedCount).toBe(0);
      expect(saved.recoveryCodesGeneratedAt).toBeInstanceOf(Date);
    });

    it('audits RECOVERY_CODES_REGENERATED', async () => {
      await service.regenerate(userId);
      expect(auditServiceSpec.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.RECOVERY_CODES_REGENERATED,
          status: AuditStatus.SUCCESS,
        }),
      );
    });

    it('rate-limits regeneration to 3 per hour', async () => {
      for (let i = 0; i < 3; i++) {
        await service.regenerate(userId);
      }

      await expect(service.regenerate(userId)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getStatus', () => {
    it('returns remaining count, generatedAt, and totalUsed', async () => {
      const status = await service.getStatus(userId);

      expect(status).toEqual({
        remainingCodes: 3,
        generatedAt: expect.any(Date),
        totalUsed: 0,
      });
    });

    it('throws if 2FA is not enabled', async () => {
      twoFactorRepoSpec.findOne.mockResolvedValue({
        ...baseRecord,
        enabled: false,
      });
      await expect(service.getStatus(userId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
