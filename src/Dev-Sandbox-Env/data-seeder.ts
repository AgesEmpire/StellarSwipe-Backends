import { DataSource, QueryRunner } from 'typeorm';
import { Logger } from '@nestjs/common';

const logger = new Logger('DataSeeder');

export interface SeederOptions {
  schemaPrefix: string;
  dryRun?: boolean;
  batchSize?: number;
}

export interface SeederResult {
  table: string;
  inserted: number;
  skipped: number;
  errors: string[];
}

/**
 * Low-level batch insertion helper used by TestDataGeneratorService.
 * Handles chunked inserts, dry-run mode, and per-table error isolation.
 */
export class DataSeeder {
  private readonly batchSize: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly options: SeederOptions,
  ) {
    this.batchSize = options.batchSize ?? 200;
  }

  async batchInsert<T extends Record<string, unknown>>(
    table: string,
    columns: (keyof T)[],
    rows: T[],
    conflictTarget?: string,
  ): Promise<SeederResult> {
    const result: SeederResult = {
      table,
      inserted: 0,
      skipped: 0,
      errors: [],
    };

    if (rows.length === 0) return result;

    if (this.options.dryRun) {
      logger.debug(`[DRY RUN] Would insert ${rows.length} rows into ${table}`);
      result.skipped = rows.length;
      return result;
    }

    const chunks = this.chunk(rows, this.batchSize);
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    for (const chunk of chunks) {
      await queryRunner.startTransaction();
      try {
        const { sql, params } = this.buildInsertSql(
          table,
          columns as string[],
          chunk,
          this.options.schemaPrefix,
          conflictTarget,
        );
        await queryRunner.query(sql, params);
        await queryRunner.commitTransaction();
        result.inserted += chunk.length;
      } catch (err: any) {
        await queryRunner.rollbackTransaction();
        result.errors.push(`Chunk failed: ${err.message}`);
        result.skipped += chunk.length;
        logger.error(`Batch insert error in ${table}: ${err.message}`);
      }
    }

    await queryRunner.release();
    return result;
  }

  async runRawSql(sql: string, params: unknown[] = []): Promise<void> {
    if (this.options.dryRun) {
      logger.debug(`[DRY RUN] SQL: ${sql.slice(0, 120)}`);
      return;
    }
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(sql, params);
    } finally {
      await queryRunner.release();
    }
  }

  async withTransaction<T>(
    fn: (qr: QueryRunner) => Promise<T>,
  ): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await fn(queryRunner);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private buildInsertSql(
    table: string,
    columns: string[],
    rows: Record<string, unknown>[],
    schemaPrefix: string,
    conflictTarget?: string,
  ): { sql: string; params: unknown[] } {
    const allColumns = ['sandbox_prefix', ...columns];
    const params: unknown[] = [];
    let paramIdx = 1;

    const valuePlaceholders = rows.map((row) => {
      const rowParams = [schemaPrefix, ...columns.map((c) => row[c])];
      const placeholders = rowParams.map(() => `$${paramIdx++}`).join(', ');
      params.push(...rowParams);
      return `(${placeholders})`;
    });

    const conflict = conflictTarget
      ? `ON CONFLICT (${conflictTarget}) DO NOTHING`
      : 'ON CONFLICT DO NOTHING';

    const sql = `
      INSERT INTO ${table} (${allColumns.join(', ')})
      VALUES ${valuePlaceholders.join(', ')}
      ${conflict}
    `;

    return { sql, params };
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

/** Factory function for easy construction in services */
export function createDataSeeder(
  dataSource: DataSource,
  options: SeederOptions,
): DataSeeder {
  return new DataSeeder(dataSource, options);
}
