import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SoftDeleteAuditService, RetentionRuleConfig } from './soft-delete-audit.service';

/**
 * SoftDeleteAuditJob
 *
 * Scheduled job that periodically audits the database schema to ensure
 * every soft-deletable entity has a corresponding retention/purge rule.
 *
 * Runs daily; throws if any uncovered soft-deletable entities are found.
 * This prevents silent indefinite retention of soft-deleted data.
 */
@Injectable()
export class SoftDeleteAuditJob {
  private readonly logger = new Logger(SoftDeleteAuditJob.name);

  constructor(private readonly auditService: SoftDeleteAuditService) {}

  /**
   * Defines retention rules for all soft-deletable entities in the system.
   *
   * Add an entry here for each entity that uses @DeleteDateColumn.
   * Entity name maps to retention policy (days before purge).
   *
   * If a soft-deletable entity is missing from this configuration,
   * the audit job will fail and log a CRITICAL error.
   */
  private getRetentionRules(): RetentionRuleConfig {
    return {
      User: { days: 30, description: 'Delete user PII after 30 days' },
      Trade: { days: 90, description: 'Delete trade records after 90 days' },
      Signal: { days: 180, description: 'Delete signals after 180 days' },
      SubscriptionTier: {
        days: 365,
        description: 'Delete subscription tier records after 1 year',
      },
    };
  }

  /**
   * Runs the soft-delete audit job daily at 2 AM.
   *
   * Throws if any soft-deletable entity lacks a retention rule.
   * In a CI environment, this prevents deployment if the schema
   * has added new soft-deletable entities without retention rules.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async run(): Promise<void> {
    this.logger.log('Starting soft-delete audit job');

    const rules = this.getRetentionRules();

    try {
      this.auditService.validateAndLogAudit(rules);
      this.logger.log('Soft-delete audit completed successfully');
    } catch (error) {
      this.logger.error(
        'Soft-delete audit failed. Schema has soft-deletable entities without retention rules.',
        error,
      );
      throw error;
    }
  }
}
