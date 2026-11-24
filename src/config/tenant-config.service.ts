import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { getCurrentTenantIdOrNull } from '../tenancy/tenant-context';
import { redactAuditPayload } from '../audit/audit.service';

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
 *
 * Change control: every set/clear is authorized against the actor's tenant,
 * requires an explicit reason, and records a before/after audit entry with
 * secrets redacted. If the audit write fails, the override change is rolled
 * back so an unaudited change is never left in effect.
 */

export interface TenantRateLimitOverride {
  limit?: number;
  window?: number;
}

/** The principal making an override change. */
export interface TenantOverrideActor {
  userId: string;
  /** Tenant the actor belongs to; must match the target tenant unless SUPER_ADMIN. */
  tenantId: string;
  role: string;
}

export type TenantOverrideScope = 'featureFlag' | 'rateLimit';

export interface TenantOverrideAuditEntry {
  tenantId: string;
  scope: TenantOverrideScope;
  /** Flag name or rate-limit scope that changed. */
  key: string;
  before: unknown;
  after: unknown;
  actorUserId: string;
  reason: string;
  changedAt: Date;
}

interface TenantOverrides {
  featureFlags: Record<string, boolean>;
  rateLimits: Record<string, TenantRateLimitOverride>;
}

@Injectable()
export class TenantConfigService {
  private readonly logger = new Logger(TenantConfigService.name);
  private readonly overridesByTenant = new Map<string, TenantOverrides>();
  // shortcut: audit trail is in-memory and lost on restart, upgrade to a repository-backed table before relying on it for compliance review
  private readonly auditTrail: TenantOverrideAuditEntry[] = [];

  // ── Feature flags ──────────────────────────────────────────────────────

  /** Sets (or replaces) a tenant's override for a given feature flag. */
  async setFeatureFlagOverride(
    tenantId: string,
    flagName: string,
    enabled: boolean,
    actor: TenantOverrideActor,
    reason: string,
  ): Promise<void> {
    this.assertCanChangeOverrides(tenantId, actor, reason);
    const before = this.overridesByTenant.get(tenantId)?.featureFlags[flagName];
    await this.commitChange(
      { tenantId, scope: 'featureFlag', key: flagName, before, after: enabled, actor, reason },
      () => {
        this.ensureTenant(tenantId).featureFlags[flagName] = enabled;
      },
    );
  }

  /** Removes a tenant's override for a given feature flag, if any. */
  async clearFeatureFlagOverride(
    tenantId: string,
    flagName: string,
    actor: TenantOverrideActor,
    reason: string,
  ): Promise<void> {
    this.assertCanChangeOverrides(tenantId, actor, reason);
    const before = this.overridesByTenant.get(tenantId)?.featureFlags[flagName];
    await this.commitChange(
      { tenantId, scope: 'featureFlag', key: flagName, before, after: undefined, actor, reason },
      () => {
        delete this.overridesByTenant.get(tenantId)?.featureFlags[flagName];
      },
    );
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
  async setRateLimitOverride(
    tenantId: string,
    scope: string,
    override: TenantRateLimitOverride,
    actor: TenantOverrideActor,
    reason: string,
  ): Promise<void> {
    this.assertCanChangeOverrides(tenantId, actor, reason);
    const before = this.overridesByTenant.get(tenantId)?.rateLimits[scope];
    const after = { ...before, ...override };
    await this.commitChange(
      { tenantId, scope: 'rateLimit', key: scope, before, after, actor, reason },
      () => {
        const tenant = this.ensureTenant(tenantId);
        tenant.rateLimits[scope] = after;
      },
    );
  }

  /** Removes a tenant's rate-limit override for a given scope, if any. */
  async clearRateLimitOverride(
    tenantId: string,
    scope: string,
    actor: TenantOverrideActor,
    reason: string,
  ): Promise<void> {
    this.assertCanChangeOverrides(tenantId, actor, reason);
    const before = this.overridesByTenant.get(tenantId)?.rateLimits[scope];
    await this.commitChange(
      { tenantId, scope: 'rateLimit', key: scope, before, after: undefined, actor, reason },
      () => {
        delete this.overridesByTenant.get(tenantId)?.rateLimits[scope];
      },
    );
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

  // ── Audit ──────────────────────────────────────────────────────────────

  /** Returns the audit entries recorded for a tenant, oldest first. */
  getAuditTrailForTenant(tenantId: string): TenantOverrideAuditEntry[] {
    return this.auditTrail.filter((entry) => entry.tenantId === tenantId).map((entry) => ({ ...entry }));
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

  private assertCanChangeOverrides(
    tenantId: string,
    actor: TenantOverrideActor,
    reason: string,
  ): void {
    if (!actor?.userId) {
      throw new UnauthorizedException('Tenant override changes require an authenticated actor');
    }
    if (actor.role !== 'SUPER_ADMIN' && actor.tenantId !== tenantId) {
      throw new ForbiddenException('Actor is not authorized to change overrides for this tenant');
    }
    if (!reason?.trim()) {
      throw new BadRequestException('Tenant override changes require an explicit reason');
    }
  }

  /**
   * Applies a change and records its audit entry. If either step fails, the
   * tenant's overrides are restored to their pre-change state before the error
   * is rethrown.
   */
  private async commitChange(
    change: {
      tenantId: string;
      scope: TenantOverrideScope;
      key: string;
      before: unknown;
      after: unknown;
      actor: TenantOverrideActor;
      reason: string;
    },
    mutate: () => void,
  ): Promise<void> {
    const snapshot = this.snapshotTenant(change.tenantId);
    try {
      mutate();
      await this.persistAuditEntry({
        tenantId: change.tenantId,
        scope: change.scope,
        key: change.key,
        before: redactAuditPayload(change.before),
        after: redactAuditPayload(change.after),
        actorUserId: change.actor.userId,
        reason: change.reason.trim(),
        changedAt: new Date(),
      });
    } catch (err) {
      this.restoreTenant(change.tenantId, snapshot);
      this.logger.error(
        `Tenant override change rolled back for tenant=${change.tenantId} scope=${change.scope} key=${change.key}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  private async persistAuditEntry(entry: TenantOverrideAuditEntry): Promise<void> {
    this.auditTrail.push(entry);
  }

  private snapshotTenant(tenantId: string): TenantOverrides | undefined {
    const tenant = this.overridesByTenant.get(tenantId);
    return tenant
      ? { featureFlags: { ...tenant.featureFlags }, rateLimits: { ...tenant.rateLimits } }
      : undefined;
  }

  private restoreTenant(tenantId: string, snapshot: TenantOverrides | undefined): void {
    if (snapshot) {
      this.overridesByTenant.set(tenantId, snapshot);
    } else {
      this.overridesByTenant.delete(tenantId);
    }
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
