import { Injectable } from '@nestjs/common';
import { getCurrentTenantIdOrNull } from '../tenancy/tenant-context';

/**
 * #943 — Tenant-aware configuration.
 *
 * The app-level `ConfigService` (./config.service.ts) exposes a single,
 * process-wide value per setting — every tenant gets the same answer. This
 * service adds a thin, tenant-aware lookup layer on top of that: it lets
 * specific tenants override a small set of "critical settings" (feature
 * flags and rate limits today) while everyone else keeps getting the global
 * default.
 *
 * Resolution follows the same "specific override falls back to global
 * default" pattern already used by RegionalFlagsService/FlagEvaluator
 * (src/feature-flags/regional) — just scoped by tenantId instead of region.
 * The active tenant is read from the AsyncLocalStorage-based tenant context
 * (src/tenancy/tenant-context.ts) via `getCurrentTenantIdOrNull()`, which
 * safely returns `null` outside of a request scope (app bootstrap,
 * background jobs, etc.) — in that case every lookup here simply falls back
 * to the caller-supplied default.
 *
 * Storage: there is no existing "tenant settings" entity/table in
 * src/tenancy or src/multitenancy, so overrides are kept in a plain
 * in-memory Map keyed by tenantId. This is intentionally lightweight for
 * the current scope; swap the Map for a repository-backed store if tenant
 * config ever needs to survive a process restart.
 */

export interface TenantRateLimitOverride {
  limit?: number;
  window?: number;
}

interface TenantOverrides {
  featureFlags: Record<string, boolean>;
  rateLimits: Record<string, TenantRateLimitOverride>;
}

@Injectable()
export class TenantConfigService {
  private readonly overridesByTenant = new Map<string, TenantOverrides>();

  // ── Feature flags ──────────────────────────────────────────────────────

  /** Sets (or replaces) a tenant's override for a given feature flag. */
  setFeatureFlagOverride(tenantId: string, flagName: string, enabled: boolean): void {
    this.ensureTenant(tenantId).featureFlags[flagName] = enabled;
  }

  /** Removes a tenant's override for a given feature flag, if any. */
  clearFeatureFlagOverride(tenantId: string, flagName: string): void {
    delete this.overridesByTenant.get(tenantId)?.featureFlags[flagName];
  }

  /**
   * Resolves whether `flagName` has an explicit tenant-specific value for
   * the given (or currently active) tenant.
   *
   * Returns `undefined` — not `false` — when there is no active tenant
   * context or no override was configured for this tenant/flag, so callers
   * can distinguish "no opinion, fall through to normal evaluation" from an
   * explicit tenant override of `false`.
   */
  resolveFeatureFlagOverride(
    flagName: string,
    tenantId: string | null = getCurrentTenantIdOrNull(),
  ): boolean | undefined {
    if (!tenantId) return undefined;
    return this.overridesByTenant.get(tenantId)?.featureFlags[flagName];
  }

  // ── Rate limits ────────────────────────────────────────────────────────

  /**
   * Sets (or merges into) a tenant's override for a given rate-limit scope
   * (e.g. a tier name like "trade", or a namespaced scope like
   * "trade:account"). Partial overrides (only `limit` or only `window`) are
   * merged on top of any existing override for that tenant/scope.
   */
  setRateLimitOverride(tenantId: string, scope: string, override: TenantRateLimitOverride): void {
    const tenant = this.ensureTenant(tenantId);
    tenant.rateLimits[scope] = { ...tenant.rateLimits[scope], ...override };
  }

  /** Removes a tenant's rate-limit override for a given scope, if any. */
  clearRateLimitOverride(tenantId: string, scope: string): void {
    delete this.overridesByTenant.get(tenantId)?.rateLimits[scope];
  }

  /**
   * Resolves the effective `{ limit, window }` for a rate-limit scope,
   * layering any tenant-specific override on top of `defaults`. Missing
   * fields on a partial override fall back to `defaults`. Returns `defaults`
   * unchanged when there is no active tenant or no override for this scope.
   */
  resolveRateLimit(
    scope: string,
    defaults: TenantRateLimitOverride,
    tenantId: string | null = getCurrentTenantIdOrNull(),
  ): TenantRateLimitOverride {
    if (!tenantId) return defaults;

    const override = this.overridesByTenant.get(tenantId)?.rateLimits[scope];
    if (!override) return defaults;

    return {
      limit: override.limit ?? defaults.limit,
      window: override.window ?? defaults.window,
    };
  }

  // ── Introspection ──────────────────────────────────────────────────────

  /** Returns a snapshot of all overrides configured for a tenant. */
  getOverridesForTenant(tenantId: string): TenantOverrides {
    const tenant = this.overridesByTenant.get(tenantId);
    return {
      featureFlags: { ...(tenant?.featureFlags ?? {}) },
      rateLimits: { ...(tenant?.rateLimits ?? {}) },
    };
  }

  private ensureTenant(tenantId: string): TenantOverrides {
    let tenant = this.overridesByTenant.get(tenantId);
    if (!tenant) {
      tenant = { featureFlags: {}, rateLimits: {} };
      this.overridesByTenant.set(tenantId, tenant);
    }
    return tenant;
  }
}
