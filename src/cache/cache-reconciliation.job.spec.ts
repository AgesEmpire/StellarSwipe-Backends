import { CacheReconciliationJob } from './cache-reconciliation.job';
import { CachePrefix } from './cache.service';

const mockSignals = [
  { id: 'sig-1', status: 'ACTIVE', updatedAt: new Date('2024-01-01') },
  { id: 'sig-2', status: 'EXPIRED', updatedAt: new Date('2024-01-02') },
];

const mockCacheService = {
  get: jest.fn(),
  del: jest.fn(),
};

const mockSignalRepo = {
  find: jest.fn().mockResolvedValue(mockSignals),
};

const mockConfigService = {
  get: jest.fn((key: string, fallback: any) => {
    if (key === 'cache.reconciliation.sampleRate') return 1; // 100% sampling for tests
    return fallback;
  }),
};

const makeJob = () =>
  new CacheReconciliationJob(
    mockCacheService as any,
    mockSignalRepo as any,
    mockConfigService as any,
  );

describe('CacheReconciliationJob', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does nothing when cached value matches db row', async () => {
    mockCacheService.get.mockResolvedValue({ status: 'ACTIVE', updatedAt: new Date('2024-01-01') });
    await makeJob().reconcile();
    expect(mockCacheService.del).not.toHaveBeenCalled();
  });

  it('deletes cache key when status mismatch detected', async () => {
    mockCacheService.get
      .mockResolvedValueOnce({ status: 'STALE', updatedAt: new Date('2024-01-01') }) // sig-1 mismatches
      .mockResolvedValueOnce({ status: 'EXPIRED', updatedAt: new Date('2024-01-02') }); // sig-2 matches

    await makeJob().reconcile();

    expect(mockCacheService.del).toHaveBeenCalledTimes(1);
    expect(mockCacheService.del).toHaveBeenCalledWith(`${CachePrefix.SIGNAL}sig-1`);
  });

  it('skips keys not present in cache', async () => {
    mockCacheService.get.mockResolvedValue(null);
    await makeJob().reconcile();
    expect(mockCacheService.del).not.toHaveBeenCalled();
  });
});
