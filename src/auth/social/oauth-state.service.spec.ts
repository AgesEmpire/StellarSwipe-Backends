import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { UnauthorizedException } from '@nestjs/common';
import { OAuthStateService } from './oauth-state.service';
import { DistributedLockService } from '../../common/services/distributed-lock.service';

describe('OAuthStateService', () => {
  let service: OAuthStateService;
  let cacheStore: Map<string, string>;
  let mockLockService: { withLock: jest.Mock };

  beforeEach(async () => {
    cacheStore = new Map();

    const mockCache = {
      get: jest.fn(async (key: string) => cacheStore.get(key) ?? null),
      set: jest.fn(async (key: string, value: string, ttl: number) => {
        cacheStore.set(key, value);
      }),
      del: jest.fn(async (key: string) => {
        cacheStore.delete(key);
      }),
    };

    mockLockService = {
      withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<any>) => {
        const result = await fn();
        return { ran: true, result };
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthStateService,
        { provide: CACHE_MANAGER, useValue: mockCache },
        { provide: DistributedLockService, useValue: mockLockService },
      ],
    }).compile();

    service = module.get<OAuthStateService>(OAuthStateService);
  });

  describe('generateState', () => {
    it('generates a secure 64-char hex state and stores it with expiration', async () => {
      const state = await service.generateState({
        provider: 'twitter',
        redirectUri: '/callback',
        ttlMs: 60000,
      });

      expect(state).toBeDefined();
      expect(state).toHaveLength(64);
      expect(cacheStore.has(`auth:oauth:state:${state}`)).toBe(true);

      const record = JSON.parse(cacheStore.get(`auth:oauth:state:${state}`)!);
      expect(record.provider).toBe('twitter');
      expect(record.redirectUri).toBe('/callback');
      expect(record.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe('consumeState', () => {
    it('atomically consumes state on first call and deletes it', async () => {
      const state = await service.generateState({
        provider: 'twitter',
        userId: 'user-123',
      });

      const consumed = await service.consumeState({
        state,
        provider: 'twitter',
        userId: 'user-123',
      });

      expect(consumed.state).toBe(state);
      expect(consumed.provider).toBe('twitter');
      expect(consumed.userId).toBe('user-123');

      // Subsequent consumption of the same state MUST fail (single-use)
      await expect(
        service.consumeState({ state, provider: 'twitter' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects expired state values', async () => {
      const state = await service.generateState({
        provider: 'twitter',
        ttlMs: -1000, // expired in the past
      });

      await expect(
        service.consumeState({ state, provider: 'twitter' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects missing or mismatched provider', async () => {
      const state = await service.generateState({
        provider: 'google',
      });

      await expect(
        service.consumeState({ state, provider: 'twitter' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects state belonging to another user', async () => {
      const state = await service.generateState({
        provider: 'twitter',
        userId: 'legit-user',
      });

      await expect(
        service.consumeState({ state, userId: 'attacker-user' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects concurrent consumption when lock cannot be acquired', async () => {
      mockLockService.withLock.mockResolvedValueOnce({ ran: false, result: null });

      await expect(
        service.consumeState({ state: 'concurrent-state' }),
      ).rejects.toThrow('OAuth state is currently being verified by another request');
    });
  });
});
