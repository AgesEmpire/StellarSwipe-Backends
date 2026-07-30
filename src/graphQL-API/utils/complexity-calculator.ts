import { ComplexityEstimatorArgs } from 'graphql-query-complexity';

/**
 * Base multiplier per field resolution.
 * Flat scalar fields cost 1; list fields multiply by the requested or default
 * page size (capped at 100 to prevent abuse via huge `limit` args).
 */
const BASE_COST = 1;
const DEFAULT_LIST_MULTIPLIER = 10;
const MAX_LIST_MULTIPLIER = 100;

// ─── Role-based complexity limits ────────────────────────────────────────────
//
// Override via environment variables so ops can tune limits without deploys:
//   GRAPHQL_COMPLEXITY_LIMIT_ADMIN=5000
//   GRAPHQL_COMPLEXITY_LIMIT_PRO=1500
//   GRAPHQL_COMPLEXITY_LIMIT_DEFAULT=500
//
// Falls back to the values below when the env vars are absent.

const DEFAULT_LIMITS: Record<string, number> = {
  admin: Number(process.env.GRAPHQL_COMPLEXITY_LIMIT_ADMIN) || 2000,
  pro: Number(process.env.GRAPHQL_COMPLEXITY_LIMIT_PRO) || 1000,
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
 * Returns the maximum allowed complexity for a given user role.
 *
 * Resolution order:
 *   1. Exact role match in `DEFAULT_LIMITS`
 *   2. `DEFAULT_LIMITS.default`
 *
 * Callers can pass the role string from `req.user.role` (or the highest role
 * when a user holds multiple).
 *
 * @example
 * // Unauthenticated / unknown role → 500
 * getComplexityLimit()
 *
 * // Authenticated admin → 2000 (or GRAPHQL_COMPLEXITY_LIMIT_ADMIN if set)
 * getComplexityLimit('admin')
 */
export function getComplexityLimit(role?: string): number {
  if (!role) return DEFAULT_LIMITS.default;
  return DEFAULT_LIMITS[role.toLowerCase()] ?? DEFAULT_LIMITS.default;
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
