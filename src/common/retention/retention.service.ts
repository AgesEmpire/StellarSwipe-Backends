import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RetentionPolicy, RetentionRunResult } from './retention-policy.interface';

/**
 * Central lifecycle-management engine for expiring records: audit trails,
 * integration/outbox events, and other operational logs that would otherwise
 * grow unbounded. Modules register a {@link RetentionPolicy} describing what
 * to clean up and how long to keep it; this service enforces all registered
 * policies on a nightly schedule (and exposes a manual trigger for ops/CLI use).
 *
 * See docs/guides/retention-policy.md for configuration defaults and
 * operational notes.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private readonly policies = new Map<string, RetentionPolicy>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  registerPolicy(policy: RetentionPolicy): void {
    if (this.policies.has(policy.name)) {
      this.logger.warn(`Retention policy "${policy.name}" registered more than once — overwriting`);
    }
    this.policies.set(policy.name, policy);
  }

  getPolicies(): RetentionPolicy[] {
    return [...this.policies.values()];
  }

  /**
   * Deletes all records matched by a single policy's cutoff (and optional
   * extra predicate). Runs as a single DELETE statement — no batching — since
   * retention sweeps are expected to run nightly and stay small relative to
   * table growth between runs.
   */
  async runPolicy(policy: RetentionPolicy): Promise<RetentionRunResult> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - policy.retentionDays);

    try {
      const repository = this.dataSource.getRepository(policy.entity);
      const qb = repository
        .createQueryBuilder('record')
        .delete()
        .where(`record.${policy.dateProperty} < :cutoff`, { cutoff });

      if (policy.extraWhere) {
        qb.andWhere(policy.extraWhere, policy.extraParams ?? {});
      }

      const result = await qb.execute();
      const deleted = result.affected ?? 0;

      this.logger.log(
        `Retention policy "${policy.name}": deleted ${deleted} record(s) older than ${policy.retentionDays} days`,
      );
      return { policy: policy.name, deleted };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Retention policy "${policy.name}" failed: ${message}`);
      return { policy: policy.name, deleted: 0, error: message };
    }
  }

  /** Runs every registered policy sequentially and returns a per-policy summary. */
  async runAll(): Promise<RetentionRunResult[]> {
    const results: RetentionRunResult[] = [];
    for (const policy of this.policies.values()) {
      results.push(await this.runPolicy(policy));
    }
    return results;
  }

  /** Nightly sweep — 3 AM, after the (pre-existing) 2 AM audit-log cleanup window. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async enforceAllRetentionPolicies(): Promise<void> {
    await this.runAll();
  }
}
