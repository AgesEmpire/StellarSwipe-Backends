import { ReplicaLagService } from './replica-lag.service';

describe('ReplicaLagService (Issue #1371)', () => {
  const makeService = (opts: { query: jest.Mock; maxLagMs?: number }) => {
    const replicaDataSource = { query: opts.query } as any;
    const configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'database.replica.maxLagMs') return opts.maxLagMs ?? 5000;
        return undefined;
      }),
    } as any;
    return new ReplicaLagService(replicaDataSource, configService);
  };

  it('reports 0ms lag when the replica has not replayed anything yet (NULL timestamp)', async () => {
    const query = jest.fn().mockResolvedValue([{ lag_ms: 0 }]);
    const service = makeService({ query });

    expect(await service.getLagMs()).toBe(0);
  });

  it('reports the measured lag in milliseconds from the replica probe', async () => {
    const query = jest.fn().mockResolvedValue([{ lag_ms: '1500' }]);
    const service = makeService({ query });

    expect(await service.getLagMs()).toBe(1500);
  });

  it('treats a failed lag probe as infinitely stale (fail safe towards the primary)', async () => {
    const query = jest.fn().mockRejectedValue(new Error('connection refused'));
    const service = makeService({ query });

    expect(await service.getLagMs()).toBe(Number.POSITIVE_INFINITY);
  });

  describe('getStatus / isWithinPolicy', () => {
    it('is within policy when lag is below the configured limit', async () => {
      const query = jest.fn().mockResolvedValue([{ lag_ms: 100 }]);
      const service = makeService({ query, maxLagMs: 5000 });

      const status = await service.getStatus();
      expect(status.withinPolicy).toBe(true);
      expect(status.lagMs).toBe(100);
    });

    it('is outside policy when lag exceeds the configured limit', async () => {
      const query = jest.fn().mockResolvedValue([{ lag_ms: 9000 }]);
      const service = makeService({ query, maxLagMs: 5000 });

      expect(await service.isWithinPolicy()).toBe(false);
    });

    it('is outside policy when the replica could not be measured at all', async () => {
      const query = jest.fn().mockRejectedValue(new Error('timeout'));
      const service = makeService({ query, maxLagMs: 5000 });

      expect(await service.isWithinPolicy()).toBe(false);
    });

    it('caches the measurement briefly instead of probing on every call', async () => {
      const query = jest.fn().mockResolvedValue([{ lag_ms: 100 }]);
      const service = makeService({ query });

      await service.getStatus();
      await service.getStatus();

      expect(query).toHaveBeenCalledTimes(1);
    });

    it('bypasses the cache when forceRefresh is true', async () => {
      const query = jest.fn().mockResolvedValue([{ lag_ms: 100 }]);
      const service = makeService({ query });

      await service.getStatus();
      await service.getStatus(true);

      expect(query).toHaveBeenCalledTimes(2);
    });
  });
});
