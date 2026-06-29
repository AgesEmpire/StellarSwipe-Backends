import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityMetadata } from 'typeorm';

/**
 * Configuration for entity retention rules.
 * Maps entity names to their retention policy (in days before purge).
 */
export interface RetentionRuleConfig {
  [entityName: string]: {
    days: number;
    description?: string;
  };
}

/**
 * Audit result for an entity's soft-delete and retention rule coverage.
 */
export interface SoftDeleteAuditResult {
  entityName: string;
  tableName: string;
  hasSoftDelete: boolean;
  hasRetentionRule: boolean;
  retentionDays?: number;
  status: 'covered' | 'uncovered' | 'no_soft_delete';
}

/**
 * SoftDeleteAuditService
 *
 * Audits the database schema to ensure every soft-deletable entity has a
 * corresponding retention/purge rule. Soft-deletable entities are those with
 * a DeleteDateColumn; if an entity supports soft-delete but has no defined
 * retention rule, this audit will flag it.
 *
 * This prevents silent indefinite retention of soft-deleted data.
 */
@Injectable()
export class SoftDeleteAuditService {
  private readonly logger = new Logger(SoftDeleteAuditService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Audits all entities in the schema.
   *
   * @param retentionRules Configuration of retention rules for entities
   * @returns Array of audit results, one per entity
   */
  auditAllEntities(retentionRules: RetentionRuleConfig): SoftDeleteAuditResult[] {
    const metadata = this.dataSource.entityMetadatas;
    const results: SoftDeleteAuditResult[] = [];

    for (const entityMeta of metadata) {
      const result = this.auditEntity(entityMeta, retentionRules);
      results.push(result);
    }

    return results;
  }

  /**
   * Audits a single entity for soft-delete and retention rule coverage.
   *
   * @param entityMeta TypeORM EntityMetadata
   * @param retentionRules Configuration of retention rules
   * @returns Audit result for the entity
   */
  auditEntity(
    entityMeta: EntityMetadata,
    retentionRules: RetentionRuleConfig,
  ): SoftDeleteAuditResult {
    const entityName = entityMeta.name;
    const tableName = entityMeta.tableName;

    // Check if entity has a DeleteDateColumn
    const hasSoftDelete = entityMeta.deletionDateColumn !== null;

    // Check if retention rule exists
    const rule = retentionRules[entityName];
    const hasRetentionRule = !!rule;

    const status = !hasSoftDelete
      ? 'no_soft_delete'
      : hasRetentionRule
      ? 'covered'
      : 'uncovered';

    return {
      entityName,
      tableName,
      hasSoftDelete,
      hasRetentionRule,
      retentionDays: rule?.days,
      status,
    };
  }

  /**
   * Audits and returns only uncovered soft-deletable entities.
   * These are entities with soft-delete capability but no retention rule.
   *
   * @param retentionRules Configuration of retention rules
   * @returns Array of uncovered entities
   */
  findUncoveredEntities(
    retentionRules: RetentionRuleConfig,
  ): SoftDeleteAuditResult[] {
    return this.auditAllEntities(retentionRules).filter(
      (r) => r.status === 'uncovered',
    );
  }

  /**
   * Logs a detailed audit report.
   * Throws an error if any soft-deletable entity lacks a retention rule.
   *
   * @param retentionRules Configuration of retention rules
   * @throws Error if uncovered entities are found
   */
  validateAndLogAudit(retentionRules: RetentionRuleConfig): void {
    const results = this.auditAllEntities(retentionRules);
    const covered = results.filter((r) => r.status === 'covered').length;
    const uncovered = results.filter((r) => r.status === 'uncovered');
    const total = results.length;

    this.logger.log(
      `Soft-delete audit: ${covered}/${total} soft-deletable entities have retention rules`,
    );

    if (uncovered.length > 0) {
      const uncoveredList = uncovered
        .map((u) => `  - ${u.entityName} (${u.tableName})`)
        .join('\n');

      const message =
        `CRITICAL: ${uncovered.length} soft-deletable entity/entities found WITHOUT retention rules:\n` +
        uncoveredList +
        '\n\nAll soft-deletable entities must have a defined retention/purge rule to prevent ' +
        'indefinite retention of deleted data.';

      this.logger.error(message);
      throw new Error(message);
    }

    results.forEach((r) => {
      if (r.status === 'covered') {
        this.logger.debug(
          `✓ ${r.entityName}: soft-delete enabled, retention after ${r.retentionDays} days`,
        );
      }
    });
  }
}
