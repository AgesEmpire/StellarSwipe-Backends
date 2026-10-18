import { existsSync, readFileSync } from 'fs';
import { DeprecationOptions } from '../decorators/deprecated.decorator';

/**
 * #1379 — Add API deprecation sunset validation in CI.
 *
 * Deprecated routes are declared two ways in this codebase:
 *   - `@Deprecated()` alone (runtime headers only — see trades.controller.ts)
 *   - `@ApiDeprecated()` (runtime headers + `deprecated: true` and the
 *     `x-sunset` extension in the generated OpenAPI document)
 *
 * so a sunset-date check needs to look at both route metadata (reflected
 * off the controller handlers) and the generated OpenAPI output. This
 * module holds the pure validation logic shared by both sources; the CI
 * entrypoint is scripts/validate-deprecation-sunset.ts.
 */

export interface RouteDeprecationInfo {
  /** Human-readable identifier used in error output, e.g. "GET /trades/user/:userId". */
  route: string;
  isDeprecated: boolean;
  metadata?: Pick<DeprecationOptions, 'sunsetDate'> | undefined;
}

export type DeprecationSunsetIssueReason = 'missing_sunset_date' | 'invalid_sunset_date';

export interface DeprecationSunsetIssue {
  route: string;
  reason: DeprecationSunsetIssueReason;
  detail: string;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates that every deprecated route carries a well-formed sunset date.
 * Active (non-deprecated) routes are skipped — there is nothing to validate
 * on them, and they must never be flagged.
 */
export function validateDeprecationSunsets(
  routes: RouteDeprecationInfo[],
): DeprecationSunsetIssue[] {
  const issues: DeprecationSunsetIssue[] = [];

  for (const { route, isDeprecated, metadata } of routes) {
    if (!isDeprecated) {
      continue;
    }

    const sunsetDate = metadata?.sunsetDate;

    if (!sunsetDate || !sunsetDate.trim()) {
      issues.push({
        route,
        reason: 'missing_sunset_date',
        detail: `${route} is marked deprecated but has no sunsetDate.`,
      });
      continue;
    }

    if (!ISO_DATE_PATTERN.test(sunsetDate) || Number.isNaN(Date.parse(sunsetDate))) {
      issues.push({
        route,
        reason: 'invalid_sunset_date',
        detail: `${route} has a malformed sunsetDate "${sunsetDate}" (expected YYYY-MM-DD).`,
      });
    }
  }

  return issues;
}

/**
 * Reads deprecated-operation metadata out of a generated OpenAPI document,
 * normalized to the same shape `validateDeprecationSunsets` expects. Covers
 * routes marked deprecated via a raw `@ApiOperation({ deprecated: true })`
 * (bypassing `@ApiDeprecated()`/the `x-sunset` extension entirely) as well
 * as ones that went through `@ApiDeprecated()` correctly.
 *
 * Returns an empty array (not a throw) when the spec file doesn't exist —
 * callers that only care about route metadata can skip generating it.
 */
export function collectOpenApiDeprecatedRoutes(specPath: string): RouteDeprecationInfo[] {
  if (!existsSync(specPath)) {
    return [];
  }

  const spec = JSON.parse(readFileSync(specPath, 'utf-8')) as {
    paths?: Record<string, Record<string, any>>;
  };

  const routes: RouteDeprecationInfo[] = [];

  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods ?? {})) {
      if (!operation || typeof operation !== 'object') {
        continue;
      }

      const isDeprecated = operation.deprecated === true;
      routes.push({
        route: `${method.toUpperCase()} ${path}`,
        isDeprecated,
        metadata: isDeprecated ? { sunsetDate: operation['x-sunset'] } : undefined,
      });
    }
  }

  return routes;
}
