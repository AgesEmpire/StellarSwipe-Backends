import { Test, TestingModule } from '@nestjs/testing';
import {
  CacheInvalidationService,
  UserCacheKeys,
} from './cache-invalidation.service';
import { CacheService, CachePrefix } from './cache.service';

const mockCacheService = {
  del: jest.fn(),
};

describe('CacheInvalidationService', () => {
  let service: CacheInvalidationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheInvalidationService,
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get<CacheInvalidationService>(CacheInvalidationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('UserCacheKeys', () => {
    it('profile key includes userId', () => {
      expect(UserCacheKeys.profile('u1')).toContain('u1');
    });

    it('preferences key includes userId', () => {
      expect(UserCacheKeys.preferences('u1')).toContain('u1');
    });

    it('sessions key includes userId', () => {
      expect(UserCacheKeys.sessions('u1')).toContain('u1');
    });

    it('portfolio key uses PORTFOLIO prefix', () => {
      expect(UserCacheKeys.portfolio('u1')).toContain(CachePrefix.PORTFOLIO);
    });
  });

  describe('invalidateUser', () => {
    it('deletes all four user cache keys', async () => {
      mockCacheService.del.mockResolvedValue(undefined);

      await service.invalidateUser('user-1');

      expect(mockCacheService.del).toHaveBeenCalledTimes(4);
      expect(mockCacheService.del).toHaveBeenCalledWith(
        UserCacheKeys.profile('user-1'),
      );
      expect(mockCacheService.del).toHaveBeenCalledWith(
        UserCacheKeys.preferences('user-1'),
      );
      expect(mockCacheService.del).toHaveBeenCalledWith(
        UserCacheKeys.sessions('user-1'),
      );
      expect(mockCacheService.del).toHaveBeenCalledWith(
        UserCacheKeys.portfolio('user-1'),
      );
    });

    it('does not throw when cache.del rejects', async () => {
      mockCacheService.del.mockRejectedValue(new Error('redis down'));
      await expect(service.invalidateUser('user-1')).rejects.toThrow();
    });
  });

  describe('invalidateUserProfile', () => {
    it('deletes only the profile key', async () => {
      mockCacheService.del.mockResolvedValue(undefined);

      await service.invalidateUserProfile('user-2');

      expect(mockCacheService.del).toHaveBeenCalledTimes(1);
      expect(mockCacheService.del).toHaveBeenCalledWith(
        UserCacheKeys.profile('user-2'),
      );
    });
  });

  describe('invalidateUserPreferences', () => {
    it('deletes only the preferences key', async () => {
      mockCacheService.del.mockResolvedValue(undefined);

      await service.invalidateUserPreferences('user-3');

      expect(mockCacheService.del).toHaveBeenCalledTimes(1);
      expect(mockCacheService.del).toHaveBeenCalledWith(
        UserCacheKeys.preferences('user-3'),
      );
    });
  });

  describe('invalidateUserSessions', () => {
    it('deletes only the sessions key', async () => {
      mockCacheService.del.mockResolvedValue(undefined);

      await service.invalidateUserSessions('user-4');

      expect(mockCacheService.del).toHaveBeenCalledTimes(1);
      expect(mockCacheService.del).toHaveBeenCalledWith(
        UserCacheKeys.sessions('user-4'),
      );
    });
  });

  describe('invalidateUsers', () => {
    it('invalidates all four keys for each user', async () => {
      mockCacheService.del.mockResolvedValue(undefined);

      await service.invalidateUsers(['u1', 'u2']);

      // 4 keys × 2 users = 8 deletions
      expect(mockCacheService.del).toHaveBeenCalledTimes(8);
    });

    it('handles an empty array without error', async () => {
      await expect(service.invalidateUsers([])).resolves.toBeUndefined();
      expect(mockCacheService.del).not.toHaveBeenCalled();
    });
  });
});
