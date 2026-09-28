import { ConfigService } from '@nestjs/config';
import { DistributedLockService } from './distributed-lock.service';

// Mock ioredis so no real Redis connection is needed
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    del: jest.fn(),
    eval: jest.fn(),
    disconnect: jest.fn(),
  }));
});

import Redis from 'ioredis';

const LOCK_PREFIX = 'stellarswipe:lock:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeLockService(): { service: DistributedLockService; redis: jest.Mocked<any> } {
  const configService = {
    get: jest.fn((key: string, defaultValue?: any) => defaultValue),
  } as unknown as ConfigService;

  const service = new DistributedLockService(configService);
  // Pull the mocked Redis instance that was created in the constructor
  const redis = (Redis as jest.MockedClass<typeof Redis>).mock.instances[
    (Redis as jest.MockedClass<typeof Redis>).mock.instances.length - 1
  ] as jest.Mocked<any>;

  return { service, redis };
}

describe('DistributedLockService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('acquire', () => {
    it('returns an ownership token when Redis SET NX succeeds (lock acquired)', async () => {
      const { service, redis } = makeLockService();
      redis.set.mockResolvedValue('OK');

      const token = await service.acquire('test-job', 5000);

      expect(token).toEqual(expect.any(String));
      expect(token).toMatch(UUID_RE);
      expect(redis.set).toHaveBeenCalledWith(
        `${LOCK_PREFIX}test-job`,
        token,
        'PX',
        5000,
        'NX',
      );
    });

    it('returns null when lock is already held (SET NX returns null)', async () => {
      const { service, redis } = makeLockService();
      redis.set.mockResolvedValue(null);

      const result = await service.acquire('test-job', 5000);
      expect(result).toBeNull();
    });

    it('issues a different token on each acquisition', async () => {
      const { service, redis } = makeLockService();
      redis.set.mockResolvedValue('OK');

      const token1 = await service.acquire('test-job', 5000);
      const token2 = await service.acquire('test-job', 5000);

      expect(token1).not.toEqual(token2);
    });
  });

  describe('release (ownership-safe)', () => {
    it('deletes the lock key via CAS script when the token matches', async () => {
      const { service, redis } = makeLockService();
      redis.eval.mockResolvedValue(1);

      const released = await service.release('test-job', 'token-abc');

      expect(released).toBe(true);
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("del"'),
        1,
        `${LOCK_PREFIX}test-job`,
        'token-abc',
      );
    });

    it('is a no-op when the token does not match the current holder', async () => {
      const { service, redis } = makeLockService();
      // Lua script returns 0 when GET != ARGV[1] (wrong token / lost ownership)
      redis.eval.mockResolvedValue(0);

      const released = await service.release('test-job', 'wrong-token');

      expect(released).toBe(false);
    });

    it('does not throw and returns false when the script call fails', async () => {
      const { service, redis } = makeLockService();
      redis.eval.mockRejectedValue(new Error('Connection lost'));

      await expect(service.release('test-job', 'token-abc')).resolves.toBe(false);
    });
  });

  describe('renew (lease renewal)', () => {
    it('extends the TTL via CAS script when the token matches', async () => {
      const { service, redis } = makeLockService();
      redis.eval.mockResolvedValue(1);

      const renewed = await service.renew('test-job', 'token-abc', 10000);

      expect(renewed).toBe(true);
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('pexpire'),
        1,
        `${LOCK_PREFIX}test-job`,
        'token-abc',
        10000,
      );
    });

    it('fails when called with the wrong ownership token', async () => {
      const { service, redis } = makeLockService();
      // Lua script returns 0 when GET != ARGV[1]
      redis.eval.mockResolvedValue(0);

      const renewed = await service.renew('test-job', 'wrong-token', 10000);

      expect(renewed).toBe(false);
    });

    it('does not throw and returns false when the script call fails', async () => {
      const { service, redis } = makeLockService();
      redis.eval.mockRejectedValue(new Error('Connection lost'));

      await expect(service.renew('test-job', 'token-abc', 10000)).resolves.toBe(false);
    });
  });

  describe('expiry (crashed worker recovery)', () => {
    it('becomes acquirable again once the TTL has elapsed, even if never released', async () => {
      const { service, redis } = makeLockService();

      // First worker acquires the lock and then "crashes" — never calls release().
      redis.set.mockResolvedValueOnce('OK');
      const firstToken = await service.acquire('crash-job', 1000);
      expect(firstToken).not.toBeNull();

      // A second acquire attempt while the key is still alive in Redis is blocked by NX.
      redis.set.mockResolvedValueOnce(null);
      const blocked = await service.acquire('crash-job', 1000);
      expect(blocked).toBeNull();

      // Once Redis expires the key (TTL elapsed), NX succeeds again for a new worker —
      // the crashed holder never permanently blocks the lock.
      redis.set.mockResolvedValueOnce('OK');
      const secondToken = await service.acquire('crash-job', 1000);
      expect(secondToken).not.toBeNull();
      expect(secondToken).not.toEqual(firstToken);
    });
  });

  describe('withLock', () => {
    it('runs the function and returns result when lock is acquired', async () => {
      const { service, redis } = makeLockService();
      redis.set.mockResolvedValue('OK');
      redis.eval.mockResolvedValue(1);

      const fn = jest.fn().mockResolvedValue('done');
      const { ran, result } = await service.withLock('my-job', 5000, fn);

      expect(ran).toBe(true);
      expect(result).toBe('done');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('releases using the same token it acquired with', async () => {
      const { service, redis } = makeLockService();
      redis.set.mockResolvedValue('OK');
      redis.eval.mockResolvedValue(1);

      await service.withLock('my-job', 5000, async () => 'done');

      const [, , keyArg, tokenArg] = redis.eval.mock.calls[0];
      expect(keyArg).toBe(`${LOCK_PREFIX}my-job`);
      expect(tokenArg).toMatch(UUID_RE);
    });

    it('skips execution and returns ran=false when lock is already held', async () => {
      const { service, redis } = makeLockService();
      redis.set.mockResolvedValue(null); // lock held by another replica

      const fn = jest.fn();
      const { ran } = await service.withLock('my-job', 5000, fn);

      expect(ran).toBe(false);
      expect(fn).not.toHaveBeenCalled();
    });

    it('releases the lock even when the function throws', async () => {
      const { service, redis } = makeLockService();
      redis.set.mockResolvedValue('OK');
      redis.eval.mockResolvedValue(1);

      const fn = jest.fn().mockRejectedValue(new Error('Job crashed'));

      await expect(service.withLock('my-job', 5000, fn)).rejects.toThrow('Job crashed');
      expect(redis.eval).toHaveBeenCalled();
    });

    it('simulates two concurrent instances: only one runs the job (contention)', async () => {
      const { service: instance1, redis: redis1 } = makeLockService();
      const { service: instance2, redis: redis2 } = makeLockService();

      // Instance 1 acquires the lock
      redis1.set.mockResolvedValue('OK');
      redis1.eval.mockResolvedValue(1);

      // Instance 2 finds the lock already held
      redis2.set.mockResolvedValue(null);

      const job = jest.fn().mockResolvedValue('completed');

      const [res1, res2] = await Promise.all([
        instance1.withLock('shared-job', 5000, job),
        instance2.withLock('shared-job', 5000, job),
      ]);

      expect(res1.ran).toBe(true);
      expect(res2.ran).toBe(false);
      expect(job).toHaveBeenCalledTimes(1);
    });

    it('periodically renews the lease while the guarded function runs', async () => {
      jest.useFakeTimers();
      try {
        const { service, redis } = makeLockService();
        redis.set.mockResolvedValue('OK');
        redis.eval.mockResolvedValue(1);

        let resolveFn: () => void;
        const fn = jest.fn(
          () =>
            new Promise<string>((resolve) => {
              resolveFn = () => resolve('done');
            }),
        );

        const promise = service.withLock('long-job', 3000, fn);

        // Renewal interval is ~ttlMs/3 = 1000ms; advance past two intervals
        // while the job is still "running" to prove renew() gets called.
        await jest.advanceTimersByTimeAsync(2100);
        expect(redis.eval).toHaveBeenCalledWith(
          expect.stringContaining('pexpire'),
          1,
          `${LOCK_PREFIX}long-job`,
          expect.any(String),
          3000,
        );
        const renewCallsDuringRun = redis.eval.mock.calls.length;
        expect(renewCallsDuringRun).toBeGreaterThanOrEqual(2);

        resolveFn!();
        const { ran, result } = await promise;

        expect(ran).toBe(true);
        expect(result).toBe('done');
      } finally {
        jest.useRealTimers();
      }
    });

    it('failure recovery: a job that never releases still unblocks after TTL expiry', async () => {
      const { service, redis } = makeLockService();

      // First run acquires but the process "crashes" mid-job — fn never resolves,
      // and we simulate no release happening (redis key just expires naturally).
      redis.set.mockResolvedValueOnce('OK');
      const crashedToken = await service.acquire('recovering-job', 2000);
      expect(crashedToken).not.toBeNull();

      // A concurrent worker is blocked while the key is still live.
      redis.set.mockResolvedValueOnce(null);
      const { ran: blockedRan } = await service.withLock('recovering-job', 2000, jest.fn());
      expect(blockedRan).toBe(false);

      // After TTL expiry in Redis, a fresh worker can acquire and run normally.
      redis.set.mockResolvedValueOnce('OK');
      redis.eval.mockResolvedValue(1);
      const fn = jest.fn().mockResolvedValue('recovered');
      const { ran, result } = await service.withLock('recovering-job', 2000, fn);

      expect(ran).toBe(true);
      expect(result).toBe('recovered');
    });
  });
});
