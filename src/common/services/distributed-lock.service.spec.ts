import { ConfigService } from '@nestjs/config';
import { DistributedLockService } from './distributed-lock.service';

// Mock ioredis so no real Redis connection is needed
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    del: jest.fn(),
    disconnect: jest.fn(),
  }));
});

import Redis from 'ioredis';

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
    it('returns true when Redis SET NX succeeds (lock acquired)', async () => {
      const { service, redis } = makeLockService();
      redis.set.mockResolvedValue('OK');

      const result = await service.acquire('test-job', 5000);
      expect(result).toBe(true);
      expect(redis.set).toHaveBeenCalledWith(
        'stellarswipe:lock:test-job',
        '1',
        'PX',
        5000,
        'NX',
      );
    });

    it('returns false when lock is already held (SET NX returns null)', async () => {
      const { service, redis } = makeLockService();
      redis.set.mockResolvedValue(null);

      const result = await service.acquire('test-job', 5000);
      expect(result).toBe(false);
    });
  });

  describe('release', () => {
    it('deletes the lock key', async () => {
      const { service, redis } = makeLockService();
      redis.del.mockResolvedValue(1);

      await service.release('test-job');
      expect(redis.del).toHaveBeenCalledWith('stellarswipe:lock:test-job');
    });

    it('does not throw when DEL fails', async () => {
      const { service, redis } = makeLockService();
      redis.del.mockRejectedValue(new Error('Connection lost'));

      await expect(service.release('test-job')).resolves.toBeUndefined();
    });
  });

  describe('withLock', () => {
    it('runs the function and returns result when lock is acquired', async () => {
      const { service, redis } = makeLockService();
      redis.set.mockResolvedValue('OK');
      redis.del.mockResolvedValue(1);

      const fn = jest.fn().mockResolvedValue('done');
      const { ran, result } = await service.withLock('my-job', 5000, fn);

      expect(ran).toBe(true);
      expect(result).toBe('done');
      expect(fn).toHaveBeenCalledTimes(1);
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
      redis.del.mockResolvedValue(1);

      const fn = jest.fn().mockRejectedValue(new Error('Job crashed'));

      await expect(service.withLock('my-job', 5000, fn)).rejects.toThrow('Job crashed');
      expect(redis.del).toHaveBeenCalled();
    });

    it('simulates two concurrent instances: only one runs the job', async () => {
      const { service: instance1, redis: redis1 } = makeLockService();
      const { service: instance2, redis: redis2 } = makeLockService();

      // Instance 1 acquires the lock
      redis1.set.mockResolvedValue('OK');
      redis1.del.mockResolvedValue(1);

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
  });
});
