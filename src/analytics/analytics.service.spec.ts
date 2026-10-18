import { AnalyticsService } from './analytics.service';
import { ReplicaLagService } from './replica-lag.service';

/**
 * Issue #1371 — Route analytics reads based on read-replica lag.
 *
 * Exercises AnalyticsService's internal read-routing (getReadDataSource /
 * executeReadQuery) directly, since that is the behavior this issue adds:
 * freshness-sensitive reads must avoid a replica whose lag exceeds policy,
 * and must still fall back to the primary on a genuine query failure.
 */
describe('AnalyticsService read routing (Issue #1371)', () => {
  const makeService = (opts: { isWithinPolicy: boolean }) => {
    const replicaDataSource = { tag: 'replica' } as any;
    const primaryDataSource = { tag: 'primary' } as any;
    const replicaLagService = {
      isWithinPolicy: jest.fn().mockResolvedValue(opts.isWithinPolicy),
      getLagMs: jest.fn(),
      getStatus: jest.fn(),
    } as unknown as ReplicaLagService;

    const service = new AnalyticsService(
      {} as any, // UserEvent repository — unused by the methods under test
      {} as any, // MetricSnapshot repository — unused by the methods under test
      replicaDataSource,
      primaryDataSource,
      replicaLagService,
    );

    return { service, replicaDataSource, primaryDataSource, replicaLagService };
  };

  it('routes reads to the replica when lag is within policy', async () => {
    const { service, replicaDataSource } = makeService({ isWithinPolicy: true });

    const dataSource = await (service as any).getReadDataSource();

    expect(dataSource).toBe(replicaDataSource);
  });

  it('routes reads to the primary when replica lag exceeds policy', async () => {
    const { service, primaryDataSource, replicaLagService } = makeService({ isWithinPolicy: false });

    const dataSource = await (service as any).getReadDataSource();

    expect(dataSource).toBe(primaryDataSource);
    expect(replicaLagService.isWithinPolicy).toHaveBeenCalled();
  });

  it('executeReadQuery runs against the replica when fresh and does not touch the primary', async () => {
    const { service, replicaDataSource, primaryDataSource } = makeService({ isWithinPolicy: true });
    const queryFn = jest.fn().mockResolvedValue('replica-result');

    const result = await (service as any).executeReadQuery(queryFn);

    expect(result).toBe('replica-result');
    expect(queryFn).toHaveBeenCalledWith(replicaDataSource);
    expect(queryFn).not.toHaveBeenCalledWith(primaryDataSource);
  });

  it('executeReadQuery runs against the primary directly when the replica is stale', async () => {
    const { service, primaryDataSource } = makeService({ isWithinPolicy: false });
    const queryFn = jest.fn().mockResolvedValue('primary-result');

    const result = await (service as any).executeReadQuery(queryFn);

    expect(result).toBe('primary-result');
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(queryFn).toHaveBeenCalledWith(primaryDataSource);
  });

  it('falls back to the primary when a fresh replica query still fails', async () => {
    const { service, replicaDataSource, primaryDataSource } = makeService({ isWithinPolicy: true });
    const queryFn = jest.fn().mockImplementation((dataSource) => {
      if (dataSource === replicaDataSource) {
        return Promise.reject(new Error('replica connection reset'));
      }
      return Promise.resolve('primary-result');
    });

    const result = await (service as any).executeReadQuery(queryFn);

    expect(result).toBe('primary-result');
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the primary itself fails (no infinite fallback loop)', async () => {
    const { service } = makeService({ isWithinPolicy: false });
    const queryFn = jest.fn().mockRejectedValue(new Error('primary unavailable'));

    await expect((service as any).executeReadQuery(queryFn)).rejects.toThrow('primary unavailable');
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
