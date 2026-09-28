import { ComplexityEstimatorArgs } from 'graphql-query-complexity';

/**
 * Base multiplier per field resolution.
 * Flat scalar fields cost 1; list fields multiply by the requested or default
 * page size (capped at 100 to prevent abuse via huge `limit` args).
 */
const BASE_COST = 1;
const DEFAULT_LIST_MULTIPLIER = 10;
const MAX_LIST_MULTIPLIER = 100;

// ─── Client-class complexity budgets (Issue #1035) ───────────────────────────
//
// Three authentication classes map to explicit budgets:
//   anonymous  — unauthenticated / no token
//   user       — authenticated regular user
//   trusted    — service-to-service / admin / pro
//
// Override via environment variables without a redeploy:
//   GRAPHQL_COMPLEXITY_LIMIT_TRUSTED=5000
//   GRAPHQL_COMPLEXITY_LIMIT_USER=1000
//   GRAPHQL_COMPLEXITY_LIMIT_ANONYMOUS=100
//   GRAPHQL_COMPLEXITY_LIMIT_ADMIN=2000   (legacy — maps to trusted)
//   GRAPHQL_COMPLEXITY_LIMIT_PRO=1000     (legacy — maps to user)
//   GRAPHQL_COMPLEXITY_LIMIT_DEFAULT=500  (legacy — maps to user)

const DEFAULT_LIMITS: Record<string, number> = {
  // Named client classes
  anonymous: Number(process.env.GRAPHQL_COMPLEXITY_LIMIT_ANONYMOUS) || 100,
  user:      Number(process.env.GRAPHQL_COMPLEXITY_LIMIT_USER)      || 500,
  trusted:   Number(process.env.GRAPHQL_COMPLEXITY_LIMIT_TRUSTED)   || 2000,
  // Legacy role aliases kept for backward compatibility
  admin:   Number(process.env.GRAPHQL_COMPLEXITY_LIMIT_ADMIN)   || 2000,
  pro:     Number(process.env.GRAPHQL_COMPLEXITY_LIMIT_PRO)     || 1000,
  premium: Number(process.env.GRAPHQL_COMPLEXITY_LIMIT_PREMIUM) || 750,
  default: Number(process.env.GRAPHQL_COMPLEXITY_LIMIT_DEFAULT) || 500,
};

/**
 * Per-field override map.
 * Fields with explicit costs here skip the generic list/scalar heuristic.
 * Use this for fields that trigger expensive external calls or aggregations.
 *
 * Key format: "<TypeName>.<fieldName>"
 */
export const FIELD_COMPLEXITY_OVERRIDES: Record<string, number> = {
  // portfolio.performance requires multiple aggregation queries
  'PortfolioType.performance': 5,
  // provider.stats requires aggregation across signals table
  'ProviderType.stats': 5,
  // trade summary is an aggregation query
  'Query.tradeSummary': 8,
  // latestSignals fires a cross-provider query
  'Query.latestSignals': 4,
  // topProviders ranks across the full provider table
  'Query.topProviders': 4,
};

/**
 * Simple field-cost estimator.
 *
 * - If a per-field override is registered in `FIELD_COMPLEXITY_OVERRIDES` it
 *   is returned directly (child complexity is added on top for object fields).
 * - List fields multiply child complexity by the smaller of the requested
 *   `limit`/`pagination.limit` arg and `MAX_LIST_MULTIPLIER`.
 * - Scalar and object fields cost `BASE_COST + childComplexity`.
 */
export function simpleComplexityEstimator() {
  return ({ type, field, args, childComplexity }: ComplexityEstimatorArgs): number => {
    const typeName = (type as any)?.name ?? '';
    const overrideKey = `${typeName}.${field.name}`;
    const override = FIELD_COMPLEXITY_OVERRIDES[overrideKey];
    if (override !== undefined) {
      return override + childComplexity;
    }

    const isList =
      field.type.toString().startsWith('[') ||
      (field.type as any).ofType?.toString().startsWith('[');

    if (isList) {
      const requestedLimit =
        (args as Record<string, any>)?.pagination?.limit ??
        (args as Record<string, any>)?.limit ??
        DEFAULT_LIST_MULTIPLIER;
      const multiplier = Math.min(
        typeof requestedLimit === 'number' ? requestedLimit : DEFAULT_LIST_MULTIPLIER,
        MAX_LIST_MULTIPLIER,
      );
      return BASE_COST + childComplexity * multiplier;
    }

    return BASE_COST + childComplexity;
  };
}

/**
 * Returns the maximum allowed complexity for a given role or client class.
 *
 * Resolution order:
 *   1. Exact match in DEFAULT_LIMITS (client class or legacy role)
 *   2. DEFAULT_LIMITS.default
 *
 * @example
 * getComplexityLimit()              // anonymous → 100
 * getComplexityLimit('user')        // authenticated user → 500
 * getComplexityLimit('trusted')     // service/admin → 2000
 * getComplexityLimit('admin')       // legacy alias → 2000
 */
export function getComplexityLimit(role?: string): number {
  if (!role) return DEFAULT_LIMITS.anonymous;
  return DEFAULT_LIMITS[role.toLowerCase()] ?? DEFAULT_LIMITS.default;
}

/**
 * Maps a raw user object to one of the three client classes:
 *   'anonymous' | 'user' | 'trusted'
 *
 * Trusted = admin, pro, or service-to-service tokens.
 * Anonymous = no user object present.
 */
export function resolveClientClass(
  user?: { role?: string; roles?: string[] } | null,
): 'anonymous' | 'user' | 'trusted' {
  if (!user) return 'anonymous';
  const roles = user.roles ?? (user.role ? [user.role] : []);
  if (roles.some((r) => ['admin', 'pro', 'trusted'].includes(r.toLowerCase()))) return 'trusted';
  if (roles.length > 0) return 'user';
  return 'anonymous';
}

/**
 * Resolves the role from a raw `req.user` object.
 *
 * Handles two common patterns:
 *   - `{ role: 'admin' }` (single role string)
 *   - `{ roles: ['admin', 'pro'] }` (array — highest-privilege role wins)
 *
 * Returns `undefined` when the user object is absent (unauthenticated).
 */
export function resolveUserRole(
  user?: { role?: string; roles?: string[] } | null,
): string | undefined {
  if (!user) return undefined;
  if (user.role) return user.role;
  if (Array.isArray(user.roles) && user.roles.length > 0) {
    // Pick the most permissive role based on the limit table
    return user.roles.reduce((best, current) => {
      return getComplexityLimit(current) > getComplexityLimit(best) ? current : best;
    });
  }
  return undefined;
}
