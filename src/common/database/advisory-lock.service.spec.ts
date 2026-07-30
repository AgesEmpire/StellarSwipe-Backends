import { AdvisoryLockService } from './advisory-lock.service';
import { LockAcquisitionException } from '../exceptions/lock-acquisition.exception';

describe('AdvisoryLockService', () => {
  const buildService = (queryImpl: jest.Mock) => {
    const dataSource = { query: queryImpl } as any;
    return new AdvisoryLockService(dataSource);
  };

  afterEach(() => jest.useRealTimers());

  it('returns true and issues pg_try_advisory_lock when the lock is free', async () => {
    const query = jest.fn().mockResolvedValue([{ acquired: true }]);
    const service = buildService(query);

    const acquired = await service.tryAcquire('maintenance:audit-cleanup');

    expect(acquired).toBe(true);
    expect(query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [expect.any(String)],
    );
  });

  it('derives the same lock key for the same lock name every time', async () => {
    const query = jest.fn().mockResolvedValue([{ acquired: true }]);
    const service = buildService(query);

    await service.tryAcquire('maintenance:migration');
    await service.tryAcquire('maintenance:migration');

    const [, firstArgs] = query.mock.calls[0];
    const [, secondArgs] = query.mock.calls[1];
    expect(firstArgs[0]).toBe(secondArgs[0]);
  });

  it('runExclusive releases the lock after successful work', async () => {
    const query = jest.fn().mockResolvedValue([{ acquired: true }]);
    const service = buildService(query);

    const result = await service.runExclusive('job:x', async () => 'done');

    expect(result).toBe('done');
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [expect.any(String)]);
  });

  it('runExclusive releases the lock even when work throws', async () => {
    const query = jest.fn().mockResolvedValue([{ acquired: true }]);
    const service = buildService(query);

    await expect(
      service.runExclusive('job:y', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [expect.any(String)]);
  });

  it('throws LockAcquisitionException when the lock cannot be acquired before the timeout', async () => {
    const query = jest.fn().mockResolvedValue([{ acquired: false }]);
    const service = buildService(query);

    await expect(
      service.runExclusive('job:z', async () => 'unreachable', {
        timeoutMs: 10,
        pollIntervalMs: 5,
      }),
    ).rejects.toBeInstanceOf(LockAcquisitionException);
  });
});
