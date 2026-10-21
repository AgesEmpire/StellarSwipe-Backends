import { ConfigService } from '@nestjs/config';
import {
  DistributedLockService,
  LockExecutionContext,
} from './distributed-lock.service';

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
const FENCE_PREFIX = 'stellarswipe:fence:';
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
    it('returns an ownership token when atomic lease acquisition succeeds', async () => {
      const { service, redis } = makeLockService();
      redis.eval.mockResolvedValue(1);

      const token = await service.acquire('test-job', 5000);

      expect(token).toEqual(expect.any(String));
      expect(token).toMatch(UUID_RE);
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("incr"'),
        2,
        `${LOCK_PREFIX}test-job`,
        `${FENCE_PREFIX}test-job`,
        token,
        5000,
      );
    });

    it('returns null when lock is already held', async () => {
      const { service, redis } = makeLockService();
      redis.eval.mockResolvedValue(null);

      const result = await service.acquire('test-job', 5000);
      expect(result).toBeNull();
    });

    it('issues a different token on each acquisition', async () => {
      const { service, redis } = makeLockService();
      redis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

      const token1 = await service.acquire('test-job', 5000);
      const token2 = await service.acquire('test-job', 5000);

      expect(token1).not.toEqual(token2);
    });

    it.each([0, 99, 1.5, Number.MAX_SAFE_INTEGER + 1])(
      'rejects invalid or unbounded TTL %s',
      async (ttlMs) => {
        const { service, redis } = makeLockService();

        await expect(service.acquire('test-job', ttlMs)).rejects.toThrow(
          /Lock TTL must be an integer/,
        );
        expect(redis.eval).not.toHaveBeenCalled();
      },
    );
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

    it('rejects an out-of-range renewal TTL', async () => {
      const { service, redis } = makeLockService();

      await expect(service.renew('test-job', 'token-abc', 24 * 60 * 60 * 1000 + 1))
        .rejects.toThrow(/Lock TTL must be an integer/);
      expect(redis.eval).not.toHaveBeenCalled();
    });
  });

  describe('expiry (crashed worker recovery)', () => {
    it('becomes acquirable again once the TTL has elapsed, even if never released', async () => {
      const { service, redis } = makeLockService();

      // First worker acquires the lock and then "crashes" — never calls release().
      redis.eval.mockResolvedValueOnce(1);
      const firstToken = await service.acquire('crash-job', 1000);
      expect(firstToken).not.toBeNull();

      // A second acquire attempt while the lease is still alive is blocked.
      redis.eval.mockResolvedValueOnce(false);
      const blocked = await service.acquire('crash-job', 1000);
      expect(blocked).toBeNull();

      // Once Redis expires the key (TTL elapsed), acquisition succeeds for a new worker —
      // the crashed holder never permanently blocks the lock.
      redis.eval.mockResolvedValueOnce(2);
      const secondToken = await service.acquire('crash-job', 1000);
      expect(secondToken).not.toBeNull();
      expect(secondToken).not.toEqual(firstToken);
    });
  });

  describe('withLock', () => {
    it('runs the function and returns result when lock is acquired', async () => {
      const { service, redis } = makeLockService();
      redis.eval.mockResolvedValue(1);

      const fn = jest.fn().mockResolvedValue('done');
      const { ran, result, fencingToken } = await service.withLock('my-job', 5000, fn);

      expect(ran).toBe(true);
      expect(result).toBe('done');
      expect(fencingToken).toBe(1);
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({
          fencingToken: 1,
          signal: expect.any(AbortSignal),
          assertCurrent: expect.any(Function),
        }),
      );
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('increments the fencing token for each successful lease', async () => {
      const { service, redis } = makeLockService();
      redis.eval
        .mockResolvedValue(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2);
      const observedFences: number[] = [];

      await service.withLock('fenced-job', 5000, async ({ fencingToken }) => {
        observedFences.push(fencingToken);
      });
      await service.withLock('fenced-job', 5000, async ({ fencingToken }) => {
        observedFences.push(fencingToken);
      });

      expect(observedFences).toEqual([1, 2]);
    });

    it('releases using the same token it acquired with', async () => {
      const { service, redis } = makeLockService();
      redis.eval.mockResolvedValue(1);

      await service.withLock('my-job', 5000, async () => 'done');

      const releaseCall = redis.eval.mock.calls.find(([script]) =>
        script.includes('redis.call("del"'),
      );
      const [, , keyArg, tokenArg] = releaseCall!;
      expect(keyArg).toBe(`${LOCK_PREFIX}my-job`);
      expect(tokenArg).toMatch(UUID_RE);
    });

    it('skips execution and returns ran=false when lock is already held', async () => {
      const { service, redis } = makeLockService();
      redis.eval.mockResolvedValue(false); // lock held by another replica

      const fn = jest.fn();
      const { ran } = await service.withLock('my-job', 5000, fn);

      expect(ran).toBe(false);
      expect(fn).not.toHaveBeenCalled();
    });

    it('releases the lock even when the function throws', async () => {
      const { service, redis } = makeLockService();
      redis.eval.mockResolvedValue(1);

      const fn = jest.fn().mockRejectedValue(new Error('Job crashed'));

      await expect(service.withLock('my-job', 5000, fn)).rejects.toThrow('Job crashed');
      expect(redis.eval).toHaveBeenCalled();
    });

    it('simulates two concurrent instances: only one runs the job (contention)', async () => {
      const { service: instance1, redis: redis1 } = makeLockService();
      const { service: instance2, redis: redis2 } = makeLockService();

      // Instance 1 acquires the lock
      redis1.eval.mockResolvedValue(1);

      // Instance 2 finds the lock already held
      redis2.eval.mockResolvedValue(false);

      const job = jest.fn().mockResolvedValue('completed');

      const [res1, res2] = await Promise.all([
        instance1.withLock('shared-job', 5000, job),
        instance2.withLock('shared-job', 5000, job),
      ]);

      expect(res1.ran).toBe(true);
      expect(res2.ran).toBe(false);
      expect(job).toHaveBeenCalledTimes(1);
    });

    it('rejects a delayed former owner after another lease receives a newer fence', async () => {
      const { service, redis } = makeLockService();
      redis.eval.mockResolvedValueOnce(1);

      let context!: LockExecutionContext;
      let startJob!: () => void;
      let continueJob!: () => void;
      const started = new Promise<void>((resolve) => {
        startJob = resolve;
      });
      const waitForContinuation = new Promise<void>((resolve) => {
        continueJob = resolve;
      });
      const protectedCommit = jest.fn();
      const formerOwnerRun = service.withLock('fenced-job', 5000, async (lockContext) => {
        context = lockContext;
        startJob();
        await waitForContinuation;
        await lockContext.assertCurrent();
        protectedCommit();
        return 'committed';
      });
      await started;

      redis.eval.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
      const replacementOwner = await service.acquire('fenced-job', 5000);
      expect(replacementOwner).not.toBeNull();
      expect(context.fencingToken).toBe(1);
      await expect(context.assertCurrent()).rejects.toThrow('Lease ownership');
      expect(context.signal.aborted).toBe(true);

      continueJob();
      await expect(formerOwnerRun).rejects.toThrow('Lease ownership');
      expect(protectedCommit).not.toHaveBeenCalled();
    });

    it('aborts the handler and rejects its result when lease renewal fails', async () => {
      jest.useFakeTimers();
      try {
        const { service, redis } = makeLockService();
        redis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
        const run = service.withLock(
          'expired-job',
          600,
          ({ signal }) =>
            new Promise<string>((resolve) => {
              signal.addEventListener('abort', () => resolve('finished'), { once: true });
            }),
        );

        await jest.advanceTimersByTimeAsync(210);

        await expect(run).rejects.toThrow('Lease ownership');
      } finally {
        jest.useRealTimers();
      }
    });

    it('periodically renews the lease while the guarded function runs', async () => {
      jest.useFakeTimers();
      try {
        const { service, redis } = makeLockService();
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
      redis.eval.mockResolvedValueOnce(1);
      const crashedToken = await service.acquire('recovering-job', 2000);
      expect(crashedToken).not.toBeNull();

      // A concurrent worker is blocked while the key is still live.
      redis.eval.mockResolvedValueOnce(false);
      const { ran: blockedRan } = await service.withLock('recovering-job', 2000, jest.fn());
      expect(blockedRan).toBe(false);

      // After TTL expiry in Redis, a fresh worker can acquire and run normally.
      redis.eval.mockResolvedValueOnce(2);
      redis.eval.mockResolvedValue(1);
      const fn = jest.fn().mockResolvedValue('recovered');
      const { ran, result } = await service.withLock('recovering-job', 2000, fn);

      expect(ran).toBe(true);
      expect(result).toBe('recovered');
    });
  });
});
