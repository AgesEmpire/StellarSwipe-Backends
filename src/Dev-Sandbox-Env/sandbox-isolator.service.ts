import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * All tables that belong to a sandbox environment.
 * Order matters for FK-safe truncation (most dependent first).
 */
const SANDBOX_TABLES = [
  'tips',
  'subscriptions',
  'tracks',
  'artists',
  'users',
] as const;

export type SandboxTable = (typeof SANDBOX_TABLES)[number];

export interface IsolationReport {
  sandboxId: string;
  schemaPrefix: string;
  tables: Array<{
    name: SandboxTable;
    rowCount: number;
    checksum: string;
  }>;
  totalRows: number;
  capturedAt: string;
}

@Injectable()
export class SandboxIsolatorService {
  private readonly logger = new Logger(SandboxIsolatorService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // ─── Schema prefix ────────────────────────────────────────────────────────

  generateSchemaPrefix(sandboxName: string): string {
    const slug = sandboxName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8);
    const rand = Math.random().toString(36).slice(2, 6);
    return `sbx_${slug}_${rand}`;
  }

  // ─── Data isolation (row-level via prefix column) ─────────────────────────

  /**
   * Truncate all sandbox-owned rows (identified by schemaPrefix tag).
   * Uses RESTART IDENTITY CASCADE per table, ordering respects FK constraints.
   */
  async truncateSandboxData(schemaPrefix: string): Promise<void> {
    this.logger.log(`Truncating sandbox data for prefix: ${schemaPrefix}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Disable FK checks temporarily
      await queryRunner.query('SET session_replication_role = replica');

      for (const table of SANDBOX_TABLES) {
        const count = await this.getRowCount(queryRunner, table, schemaPrefix);
        if (count > 0) {
          await queryRunner.query(
            `DELETE FROM ${table} WHERE sandbox_prefix = $1`,
            [schemaPrefix],
          );
          this.logger.debug(`Deleted ${count} rows from ${table} [${schemaPrefix}]`);
        }
      }

      await queryRunner.query('SET session_replication_role = DEFAULT');
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      await queryRunner.query('SET session_replication_role = DEFAULT');
      this.logger.error(`Truncation failed for ${schemaPrefix}`, err);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Capture an isolation report (row counts + checksums per table).
   */
  async captureReport(schemaPrefix: string, sandboxId: string): Promise<IsolationReport> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      const tables: IsolationReport['tables'] = [];
      let totalRows = 0;

      for (const table of SANDBOX_TABLES) {
        const rowCount = await this.getRowCount(queryRunner, table, schemaPrefix);
        const checksum = await this.computeChecksum(queryRunner, table, schemaPrefix);
        tables.push({ name: table, rowCount, checksum });
        totalRows += rowCount;
      }

      return {
        sandboxId,
        schemaPrefix,
        tables,
        totalRows,
        capturedAt: new Date().toISOString(),
      };
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Verify no data leaks between sandboxes: confirm no row in any table
   * references a schemaPrefix that doesn't match the given sandboxId.
   */
  async verifyIsolation(
    schemaPrefix: string,
    knownPrefixes: string[],
  ): Promise<{ isolated: boolean; violations: string[] }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    const violations: string[] = [];

    try {
      for (const table of SANDBOX_TABLES) {
        const result = await queryRunner.query(
          `SELECT COUNT(*) AS count FROM ${table}
           WHERE sandbox_prefix != $1 AND sandbox_prefix = ANY($2::text[])`,
          [schemaPrefix, knownPrefixes],
        );

        const count = parseInt(result[0]?.count ?? '0', 10);
        if (count > 0) {
          violations.push(`${table}: ${count} cross-sandbox rows`);
        }
      }
    } finally {
      await queryRunner.release();
    }

    return { isolated: violations.length === 0, violations };
  }

  /**
   * Add sandbox_prefix column to all sandbox tables if not already present.
   * Called once during module initialization.
   */
  async ensureSandboxColumns(): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      for (const table of SANDBOX_TABLES) {
        const exists = await queryRunner.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = $1 AND column_name = 'sandbox_prefix'
        `, [table]);

        if (exists.length === 0) {
          await queryRunner.query(
            `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS sandbox_prefix VARCHAR(30)`,
          );
          await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS idx_${table}_sandbox_prefix ON ${table} (sandbox_prefix)`,
          );
          this.logger.log(`Added sandbox_prefix column to ${table}`);
        }
      }
    } finally {
      await queryRunner.release();
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async getRowCount(
    queryRunner: any,
    table: SandboxTable,
    schemaPrefix: string,
  ): Promise<number> {
    const result = await queryRunner.query(
      `SELECT COUNT(*) AS count FROM ${table} WHERE sandbox_prefix = $1`,
      [schemaPrefix],
    );
    return parseInt(result[0]?.count ?? '0', 10);
  }

  private async computeChecksum(
    queryRunner: any,
    table: SandboxTable,
    schemaPrefix: string,
  ): Promise<string> {
    try {
      const result = await queryRunner.query(
        `SELECT MD5(string_agg(id::text, ',' ORDER BY created_at)) AS chk
         FROM ${table} WHERE sandbox_prefix = $1`,
        [schemaPrefix],
      );
      return result[0]?.chk ?? 'empty';
    } catch {
      return 'checksum-unavailable';
    }
  }
}
