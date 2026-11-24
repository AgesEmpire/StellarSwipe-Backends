import { EntityTarget } from 'typeorm';

/**
 * Describes one record type's automated retention/cleanup rule.
 *
 * `dateProperty` and `extraWhere` reference TypeORM *entity property names*
 * (not raw DB column names) so QueryBuilder can translate them correctly
 * regardless of each entity's column naming (snake_case vs camelCase).
 */
export interface RetentionPolicy {
  /** Unique, human-readable identifier used in logs and manual triggers. */
  name: string;
  /** The TypeORM entity class this policy cleans up. */
  entity: EntityTarget<any>;
  /** Entity property holding the timestamp cleanup is measured against. */
  dateProperty: string;
  /** Retention window in days; records older than this become eligible for cleanup. */
  retentionDays: number;
  /**
   * Optional extra predicate (entity property syntax, e.g. `"status = :status"`)
   * ANDed with the date cutoff — e.g. only prune outbox events that have
   * already been published, never pending/failed ones still awaiting retry.
   */
  extraWhere?: string;
  extraParams?: Record<string, unknown>;
  /**
   * Entity property holding the owning tenant id. Legal holds are tenant-scoped,
   * so a tenant's hold only protects that tenant's records when this is set.
   * shortcut: without it, holds match records across all tenants (over-retains, never over-deletes), add it once the table has tenant_id.
   */
  tenantProperty?: string;
}

export interface RetentionRunResult {
  policy: string;
  deleted: number;
  /** Eligible records skipped because an active legal hold covers them. */
  excluded?: number;
  error?: string;
}
