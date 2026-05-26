import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { SignalQuotaService } from './signal-quota.service';

const makeCacheMock = () => {
  const store = new Map<string, any>();
  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: any) => { store.set(key, value); }),
    del: jest.fn(async (key: string) => { store.delete(key); }),
    _store: store,
  };
};

describe('SignalQuotaService', () => {
  let service: SignalQuotaService;
  let cache: ReturnType<typeof makeCacheMock>;

  beforeEach(async () => {
    cache = makeCacheMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalQuotaService,
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();

    service = module.get(SignalQuotaService);
  });

  describe('checkAndConsume', () => {
    it('allows submission within quota', async () => {
      const status = await service.checkAndConsume('provider-1', 'basic');
      expect(status.used).toBe(1);
      expect(status.remaining).toBe(9);
    });

    it('tracks quota across multiple submissions', async () => {
      for (let i = 0; i < 5; i++) {
        await service.checkAndConsume('provider-2', 'basic');
      }
      const status = await service.getStatus('provider-2', 'basic');
      expect(status.used).toBe(5);
      expect(status.remaining).toBe(5);
    });

    it('rejects submission when quota is exceeded', async () => {
      // Exhaust the basic quota (limit=10)
      for (let i = 0; i < 10; i++) {
        await service.checkAndConsume('provider-3', 'basic');
      }
      await expect(service.checkAndConsume('provider-3', 'basic')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejection message contains resetAt', async () => {
      for (let i = 0; i < 10; i++) {
        await service.checkAndConsume('provider-4', 'basic');
      }
      try {
        await service.checkAndConsume('provider-4', 'basic');
      } catch (e: any) {
        expect(e.response.resetAt).toBeDefined();
        expect(e.response.message).toBe('errors.QUOTA_EXCEEDED');
      }
    });

    it('applies higher limit for premium tier', async () => {
      const status = await service.checkAndConsume('provider-5', 'premium');
      expect(status.limit).toBe(500);
    });

    it('applies staked provider quota when stake exceeds tier limit', async () => {
      // basic limit=10, staked limit=100 → staked wins
      const status = await service.checkAndConsume('provider-6', 'basic', true);
      expect(status.limit).toBe(100);
    });

    it('uses tier limit when it exceeds staked limit', async () => {
      // platinum limit=1000 > staked limit=100 → platinum wins
      const status = await service.checkAndConsume('provider-7', 'platinum', true);
      expect(status.limit).toBe(1000);
    });
  });

  describe('resetQuota', () => {
    it('resets used count so submissions are allowed again', async () => {
      for (let i = 0; i < 10; i++) {
        await service.checkAndConsume('provider-8', 'basic');
      }
      await service.resetQuota('provider-8', 'basic');
      const status = await service.getStatus('provider-8', 'basic');
      expect(status.used).toBe(0);
      expect(status.remaining).toBe(10);
    });

    it('allows new submissions after reset', async () => {
      for (let i = 0; i < 10; i++) {
        await service.checkAndConsume('provider-9', 'basic');
      }
      await service.resetQuota('provider-9', 'basic');
      await expect(service.checkAndConsume('provider-9', 'basic')).resolves.toBeDefined();
    });
  });

  describe('getStatus', () => {
    it('returns zero usage for a new provider', async () => {
      const status = await service.getStatus('provider-new', 'basic');
      expect(status.used).toBe(0);
      expect(status.remaining).toBe(10);
    });

    it('returns correct status after partial usage', async () => {
      await service.checkAndConsume('provider-partial', 'silver');
      await service.checkAndConsume('provider-partial', 'silver');
      const status = await service.getStatus('provider-partial', 'silver');
      expect(status.used).toBe(2);
      expect(status.limit).toBe(50);
      expect(status.remaining).toBe(48);
    });
  });
});
