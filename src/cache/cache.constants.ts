/**
 * Cache key ownership and TTL policy.
 *
 * Every supported cache key MUST be declared here with:
 *  - owner: the module/service that is the authoritative writer for the key.
 *  - ttlSeconds: the maximum staleness window for the key.
 *  - tenantScoped: whether the key must be namespaced per tenant to prevent
 *    stale data from crossing tenant or authorization boundaries.
 *
 * Mutations performed by the owning service are responsible for invalidating
 * (or versioning) the affected entries. Cache failures must degrade to the
 * source of truth rather than serving stale data.
 */
export interface CacheKeyPolicy {
  /** Authoritative writer responsible for invalidating this key. */
  owner: string;
  /** Maximum staleness window, in seconds. */
  ttlSeconds: number;
  /** Whether the key must be namespaced per tenant. */
  tenantScoped: boolean;
}

/**
 * Registry of supported cache keys mapped to their ownership + TTL policy.
 * Keys not present here are not supported and must not be cached.
 */
export const CACHE_KEY_POLICIES = {
  'user:profile': {
    owner: 'UsersService',
    ttlSeconds: 300,
    tenantScoped: true,
  },
  'user:permissions': {
    owner: 'AuthorizationService',
    ttlSeconds: 60,
    tenantScoped: true,
  },
  'tenant:settings': {
    owner: 'TenantsService',
    ttlSeconds: 300,
    tenantScoped: true,
  },
  'tenant:membership': {
    owner: 'TenantsService',
    ttlSeconds: 60,
    tenantScoped: true,
  },
} as const satisfies Record<string, CacheKeyPolicy>;

export type CacheKey = keyof typeof CACHE_KEY_POLICIES;

/**
 * Returns the policy for a supported cache key, or undefined when the key is
 * not registered. Callers must treat an unregistered key as uncacheable so
 * that cache failures degrade to the source of truth.
 */
export function getCacheKeyPolicy(key: string): CacheKeyPolicy | undefined {
  return (CACHE_KEY_POLICIES as Record<string, CacheKeyPolicy>)[key];
}

/**
 * Builds the effective cache key, namespacing tenant-scoped keys so that
 * entries cannot leak across tenant or authorization boundaries.
 */
export function buildCacheKey(
  key: CacheKey,
  tenantId?: string,
): string | undefined {
  const policy = getCacheKeyPolicy(key);
  if (!policy) {
    return undefined;
  }
  if (policy.tenantScoped) {
    if (!tenantId) {
      return undefined;
    }
    return `${tenantId}:${key}`;
  }
  return key;
}
