import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Issue #1372 — Database readiness check for transaction capability.
 *
 * `DatabaseHealthIndicator` only proves the database is reachable
 * (`SELECT 1`). That is not sufficient for critical backend workflows
 * (trade execution, settlement, migrations) which depend on the database
 * being able to actually BEGIN a transaction, write, and COMMIT/ROLLBACK —
 * a connection can be "up" while transactions are failing (e.g. the
 * connection is stuck in a broken transaction state, the role lacks write
 * privileges, or the server is in a read-only/failover mode).
 *
 * The probe creates a session-scoped temporary table, writes a row, reads
 * it back, and always rolls back — so it never leaves any trace and never
 * touches real application tables. `ON COMMIT DROP` plus the rollback
 * itself guarantee the probe table never survives this check, even if the
 * process dies mid-check (temp tables are connection-scoped and vanish
 * when the connection is released/closed).
 */
@Injectable()
export class TransactionReadinessIndicator extends HealthIndicator {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        await queryRunner.query(
          'CREATE TEMP TABLE IF NOT EXISTS __readiness_txn_probe (id INT NOT NULL) ON COMMIT DROP',
        );
        await queryRunner.query(
          'INSERT INTO __readiness_txn_probe (id) VALUES (1)',
        );
        const rows = await queryRunner.query(
          'SELECT id FROM __readiness_txn_probe WHERE id = 1',
        );

        if (!Array.isArray(rows) || rows.length !== 1) {
          throw new Error('Transaction probe write was not visible to a read in the same transaction');
        }
      } finally {
        // Always roll back — the probe never persists, win or lose.
        await queryRunner.rollbackTransaction();
      }

      const latency = Date.now() - startTime;
      return this.getStatus(key, true, {
        transactional: true,
        latency: `${latency}ms`,
      });
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      throw new HealthCheckError(
        'Database transaction capability check failed',
        this.getStatus(key, false, {
          transactional: false,
          error: errorMessage,
          latency: `${latency}ms`,
        }),
      );
    } finally {
      await queryRunner.release();
    }
  }
}
