import { DataSource, QueryRunner } from 'typeorm';

/**
 * DatabaseFactory — provides isolated database state for integration tests.
 *
 * Each test gets a dedicated query runner wrapped in a transaction that is
 * rolled back after the test, guaranteeing no state leaks between tests and
 * enabling safe parallel execution.
 */
export class DatabaseFactory {
  private queryRunner: QueryRunner | null = null;

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Begin an isolated transaction for the test.
   * All operations within this transaction are rolled back in `cleanup()`.
   */
  async setup(): Promise<QueryRunner> {
    this.queryRunner = this.dataSource.createQueryRunner();
    await this.queryRunner.connect();
    await this.queryRunner.startTransaction();
    return this.queryRunner;
  }

  /**
   * Roll back the transaction and release the connection.
   * Call this in `afterEach`.
   */
  async cleanup(): Promise<void> {
    if (this.queryRunner) {
      await this.queryRunner.rollbackTransaction();
      await this.queryRunner.release();
      this.queryRunner = null;
    }
  }

  /**
   * Truncate specific tables (for tests that cannot use transaction isolation).
   */
  async truncateTables(tableNames: string[]): Promise<void> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    try {
      await qr.query('SET session_replication_role = replica');
      for (const table of tableNames) {
        await qr.query(`TRUNCATE TABLE "${table}" CASCADE`);
      }
      await qr.query('SET session_replication_role = DEFAULT');
    } finally {
      await qr.release();
    }
  }
}
