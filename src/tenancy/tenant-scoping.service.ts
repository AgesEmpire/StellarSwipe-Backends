/**
 * TenantScopingService
 *
 * Implements multi-tenant data isolation by automatically injecting a
 * tenant_id predicate into every TypeORM SelectQueryBuilder that passes
 * through this service.
 *
 * Isolation strategy
 * ──────────────────
 * • Shared schema, discriminator column (tenant_id on each table).
 * • Every read/write is scoped to the active tenant resolved from the
 *   async-local-storage context set by TenantMiddleware.
 * • Cross-tenant access is only permitted for SUPER_ADMIN callers and
 *   requires an explicit opt-in via `unscopedQuery()`.
 *
 * Security properties preserved
 * ──────────────────────────────
 * • A missing tenant context throws rather than silently returning all rows.
 * • The tenant predicate is always added as a WHERE clause — it cannot be
 *   overridden by callers of `scopeQuery()`.
 * • `unscopedQuery()` is guarded by a role check and emits an audit event.
 */
import {
  Injectable,
  Logger,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { SelectQueryBuilder, Repository, ObjectLiteral } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getCurrentTenantId, getCurrentTenantIdOrNull } from './tenant-context';

export const TENANT_COLUMN = 'tenant_id';

export interface TenantScopeOptions {
  /** Alias used in the query builder (defaults to the first alias). */
  alias?: string;
}

@Injectable()
export class TenantScopingService {
  private readonly logger = new Logger(TenantScopingService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Adds a tenant_id WHERE clause to the provided query builder.
   * Throws if no tenant context is active.
   */
  scopeQuery<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    options: TenantScopeOptions = {},
  ): SelectQueryBuilder<T> {
    const tenantId = getCurrentTenantId();
    const alias = options.alias ?? qb.alias;

    qb.andWhere(`${alias}.${TENANT_COLUMN} = :__tenantId`, {
      __tenantId: tenantId,
    });

    return qb;
  }

  /**
   * Scopes a TypeORM Repository find-options object by injecting tenant_id.
   * Use this when you cannot use a QueryBuilder (e.g. simple findOne calls).
   */
  scopeFindOptions<T extends ObjectLiteral>(
    where: Partial<T> | Partial<T>[],
  ): Partial<T> | Partial<T>[] {
    const tenantId = getCurrentTenantId();
    const inject = { [TENANT_COLUMN]: tenantId } as unknown as Partial<T>;

    if (Array.isArray(where)) {
      return where.map((w) => ({ ...w, ...inject }));
    }
    return { ...where, ...inject };
  }

  /**
   * Returns the active tenant ID — convenience wrapper.
   */
  getActiveTenantId(): string {
    return getCurrentTenantId();
  }

  /**
   * Executes a callback in an unscoped context (cross-tenant access).
   * Restricted to SUPER_ADMIN role; emits an audit event for every call.
   *
   * @param callerRole  Role of the caller — must be 'SUPER_ADMIN'.
   * @param reason      Human-readable justification logged in the audit trail.
   * @param fn          Async callback that performs the unscoped operation.
   */
  async unscopedQuery<T>(
    callerRole: string,
    reason: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (callerRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Cross-tenant queries require SUPER_ADMIN role',
      );
    }

    const tenantId = getCurrentTenantIdOrNull();

    this.logger.warn(
      `Unscoped (cross-tenant) query executed by SUPER_ADMIN. ` +
        `Originating tenant: ${tenantId ?? 'none'}. Reason: ${reason}`,
    );

    this.eventEmitter.emit('tenant.unscoped_access', {
      originTenantId: tenantId,
      reason,
      timestamp: new Date(),
    });

    return fn();
  }

  /**
   * Validates that a resource belongs to the active tenant.
   * Throws ForbiddenException if the tenantId does not match.
   */
  assertTenantOwnership(
    resourceTenantId: string,
    resourceLabel = 'resource',
  ): void {
    const activeTenantId = getCurrentTenantId();
    if (resourceTenantId !== activeTenantId) {
      this.logger.warn(
        `Tenant isolation violation: active=${activeTenantId}, ` +
          `resource=${resourceTenantId}, label=${resourceLabel}`,
      );
      throw new ForbiddenException(
        `Access denied: ${resourceLabel} does not belong to the current tenant`,
      );
    }
  }
}
