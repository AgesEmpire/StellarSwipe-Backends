import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, WhereExpressionBuilder } from 'typeorm';
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
      const held = this.heldPredicate(policy);

      // Operators need to see what legal holds kept out of this sweep.
      const excluded = await this.eligibleQuery(repository.createQueryBuilder('record'), policy, cutoff)
        .andWhere(held.sql, held.params)
        .getCount();

      const qb = this.eligibleQuery(repository.createQueryBuilder('record').delete(), policy, cutoff)
        .andWhere(`NOT ${held.sql}`, held.params);

      const result = await qb.execute();
      const deleted = result.affected ?? 0;

      this.logger.log(
        `Retention policy "${policy.name}": deleted ${deleted} record(s) older than ${policy.retentionDays} days, excluded ${excluded} under legal hold`,
      );
      return { policy: policy.name, deleted, excluded };
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

  /** Cutoff + policy predicate, shared by the delete and the exclusion count. */
  private eligibleQuery<Q extends WhereExpressionBuilder>(qb: Q, policy: RetentionPolicy, cutoff: Date): Q {
    qb.where(`record.${policy.dateProperty} < :cutoff`, { cutoff });
    if (policy.extraWhere) {
      qb.andWhere(policy.extraWhere, policy.extraParams ?? {});
    }
    return qb;
  }

  /** SQL matching records covered by an active (unreleased, unexpired) legal hold. */
  private heldPredicate(policy: RetentionPolicy): { sql: string; params: Record<string, unknown> } {
    const tenantMatch = policy.tenantProperty
      ? `AND lh.tenant_id = CAST(record.${policy.tenantProperty} AS varchar)`
      : '';
    const sql = `EXISTS (
      SELECT 1 FROM legal_holds lh
      WHERE lh.policy_name = :holdPolicy
        AND lh.released_at IS NULL
        AND (lh.expires_at IS NULL OR lh.expires_at > :holdNow)
        AND (lh.record_id IS NULL OR lh.record_id = CAST(record.id AS varchar))
        ${tenantMatch}
    )`;
    return { sql, params: { holdPolicy: policy.name, holdNow: new Date() } };
  }

  /** Nightly sweep — 3 AM, after the (pre-existing) 2 AM audit-log cleanup window. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async enforceAllRetentionPolicies(): Promise<void> {
    await this.runAll();
  }
}
