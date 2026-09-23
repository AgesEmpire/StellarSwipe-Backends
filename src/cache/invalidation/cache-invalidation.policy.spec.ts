import {
  CACHE_INVALIDATION_POLICIES,
  CacheScope,
  buildScopedCacheKey,
  resolveTtlWithJitter,
} from './cache-invalidation.policy';

describe('cache invalidation policy', () => {
  it('defines a policy for every scope', () => {
    expect(Object.keys(CACHE_INVALIDATION_POLICIES)).toEqual(
      expect.arrayContaining([CacheScope.GLOBAL, CacheScope.TENANT, CacheScope.USER]),
    );
  });

  it('narrows TTL from global -> tenant -> user to reduce staleness blast radius', () => {
    const { GLOBAL, TENANT, USER } = CACHE_INVALIDATION_POLICIES;
    expect(GLOBAL.ttlSeconds).toBeGreaterThanOrEqual(TENANT.ttlSeconds);
    expect(TENANT.ttlSeconds).toBeGreaterThanOrEqual(USER.ttlSeconds);
  });

  it('builds isolated keys per tenant so tenants cannot read each other\'s cache', () => {
    const keyA = buildScopedCacheKey(CacheScope.TENANT, 'portfolio', '1', 'tenant-a');
    const keyB = buildScopedCacheKey(CacheScope.TENANT, 'portfolio', '1', 'tenant-b');
    expect(keyA).not.toEqual(keyB);
  });

  it('throws when a scope id is missing for a non-global scope', () => {
    expect(() => buildScopedCacheKey(CacheScope.USER, 'profile', '1')).toThrow();
  });

  it('keeps jittered TTL within bounds to avoid a stampede at exact expiry', () => {
    const policy = CACHE_INVALIDATION_POLICIES[CacheScope.GLOBAL];
    const ttl = resolveTtlWithJitter(CacheScope.GLOBAL);
    expect(ttl).toBeGreaterThanOrEqual(policy.ttlSeconds - policy.jitterSeconds);
    expect(ttl).toBeLessThanOrEqual(policy.ttlSeconds + policy.jitterSeconds);
  });
});
