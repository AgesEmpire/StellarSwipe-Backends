/**
 * Consistent cache invalidation policy definitions for tenant-specific,
 * user-specific, and global entity caches.
 *
 * Goals:
 *  - Prevent stale reads by defining explicit TTL + invalidation triggers per scope.
 *  - Prevent cache stampedes via jittered TTLs and a distributed lock hint for
 *    the "recompute on miss" path.
 */

export enum CacheScope {
  GLOBAL = 'global',
  TENANT = 'tenant',
  USER = 'user',
}

export interface CacheInvalidationPolicy {
  scope: CacheScope;
  /** Base TTL in seconds before an entry is considered stale. */
  ttlSeconds: number;
  /** Random jitter (seconds) added/subtracted from ttlSeconds to avoid synchronized expiry (stampede prevention). */
  jitterSeconds: number;
  /** Events that must actively evict/invalidate this scope's keys rather than waiting for TTL. */
  invalidateOnEvents: string[];
  /** Whether a distributed lock should guard cache-miss recomputation for this scope. */
  useRecomputeLock: boolean;
  /** Cache key prefix convention for this scope. */
  keyPrefix: string;
}

/**
 * Default policy table. Scopes are ordered from broadest (global) to narrowest (user)
 * since narrower scopes should generally use shorter TTLs and more aggressive invalidation.
 */
export const CACHE_INVALIDATION_POLICIES: Record<CacheScope, CacheInvalidationPolicy> = {
  [CacheScope.GLOBAL]: {
    scope: CacheScope.GLOBAL,
    ttlSeconds: 300,
    jitterSeconds: 30,
    invalidateOnEvents: ['config.updated', 'feature-flag.updated', 'market-data.refreshed'],
    useRecomputeLock: true,
    keyPrefix: 'cache:global:',
  },
  [CacheScope.TENANT]: {
    scope: CacheScope.TENANT,
    ttlSeconds: 120,
    jitterSeconds: 15,
    invalidateOnEvents: ['tenant.settings.updated', 'tenant.plan.changed', 'tenant.member.updated'],
    useRecomputeLock: true,
    keyPrefix: 'cache:tenant:',
  },
  [CacheScope.USER]: {
    scope: CacheScope.USER,
    ttlSeconds: 60,
    jitterSeconds: 5,
    invalidateOnEvents: ['user.profile.updated', 'user.permissions.updated', 'user.logout'],
    useRecomputeLock: false,
    keyPrefix: 'cache:user:',
  },
};

/**
 * Builds a scoped cache key following the policy's key prefix convention.
 * Tenant/user keys are namespaced by id to guarantee tenant/user isolation
 * (no cross-tenant or cross-user stale reads).
 */
export function buildScopedCacheKey(
  scope: CacheScope,
  entity: string,
  id: string,
  scopeId?: string,
): string {
  const policy = CACHE_INVALIDATION_POLICIES[scope];
  if (scope === CacheScope.GLOBAL) {
    return `${policy.keyPrefix}${entity}:${id}`;
  }
  if (!scopeId) {
    throw new Error(`scopeId is required to build a ${scope} cache key`);
  }
  return `${policy.keyPrefix}${scopeId}:${entity}:${id}`;
}

/** Returns the effective TTL (base +/- jitter) in seconds to use when setting a cache entry. */
export function resolveTtlWithJitter(scope: CacheScope): number {
  const policy = CACHE_INVALIDATION_POLICIES[scope];
  const jitter = Math.floor((Math.random() * 2 - 1) * policy.jitterSeconds);
  return Math.max(1, policy.ttlSeconds + jitter);
}
