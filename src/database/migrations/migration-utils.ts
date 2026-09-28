/**
 * migration-utils.ts
 *
 * Utilities for improving database migration rollback safety and detecting
 * irreversible migration changes before they are applied.
 *
 * Usage:
 *   - Wrap destructive `up()` bodies with `withRollbackSafety()` to get
 *     automatic pre-flight checks and structured error reporting.
 *   - Call `detectIrreversibleChanges()` on a SQL string to surface
 *     operations that cannot be safely rolled back.
 *   - Use `createSafeBackup()` / `restoreFromBackup()` helpers inside
 *     `up()` / `down()` when you need a data-level safety net.
 */

import { QueryRunner } from 'typeorm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Severity level of a detected irreversible change. */
export enum IrreversibleSeverity {
  /** Informational – rollback is possible but may lose data. */
  WARNING = 'WARNING',
  /** Rollback is technically possible but extremely risky. */
  HIGH = 'HIGH',
  /** Rollback is impossible without a prior backup. */
  CRITICAL = 'CRITICAL',
}

/** A single detected irreversible change within a SQL statement. */
export interface IrreversibleChange {
  /** Short identifier for the rule that triggered this finding. */
  rule: string;
  /** Human-readable description of the risk. */
  description: string;
  /** Severity of the finding. */
  severity: IrreversibleSeverity;
  /** The SQL fragment that triggered the rule (if extractable). */
  fragment?: string;
}

/** Result returned by `detectIrreversibleChanges()`. */
export interface IrreversibilityReport {
  /** Whether any irreversible changes were detected. */
  hasIrreversibleChanges: boolean;
  /** All findings, ordered by severity (CRITICAL first). */
  changes: IrreversibleChange[];
  /** Highest severity found, or null when the report is clean. */
  maxSeverity: IrreversibleSeverity | null;
}

/** Options for `withRollbackSafety()`. */
export interface RollbackSafetyOptions {
  /**
   * When true, throw a `MigrationRollbackError` if CRITICAL irreversible
   * changes are detected before running `up()`.
   * @default false
   */
  blockOnCritical?: boolean;
  /**
   * When true, throw on HIGH-severity findings as well.
   * @default false
   */
  blockOnHigh?: boolean;
  /**
   * Custom logger. Defaults to `console`.
   */
  logger?: Pick<Console, 'warn' | 'error' | 'log'>;
}

/** Thrown when `withRollbackSafety()` blocks execution due to critical risks. */
export class MigrationRollbackError extends Error {
  constructor(
    public readonly report: IrreversibilityReport,
    message?: string,
  ) {
    super(
      message ??
        `Migration blocked: ${report.changes.length} irreversible change(s) detected ` +
          `(max severity: ${report.maxSeverity})`,
    );
    this.name = 'MigrationRollbackError';
  }
}

// ---------------------------------------------------------------------------
// Irreversible-change detection rules
// ---------------------------------------------------------------------------

interface DetectionRule {
  rule: string;
  pattern: RegExp;
  description: string;
  severity: IrreversibleSeverity;
}

const DETECTION_RULES: DetectionRule[] = [
  {
    rule: 'DROP_TABLE',
    pattern: /\bDROP\s+TABLE\b/i,
    description:
      'DROP TABLE permanently removes the table and all its data. ' +
      'Ensure a backup exists before applying.',
    severity: IrreversibleSeverity.CRITICAL,
  },
  {
    rule: 'DROP_COLUMN',
    pattern: /\bDROP\s+COLUMN\b/i,
    description:
      'DROP COLUMN removes the column and all stored values. ' +
      'Data cannot be recovered without a prior backup.',
    severity: IrreversibleSeverity.CRITICAL,
  },
  {
    rule: 'DROP_DATABASE',
    pattern: /\bDROP\s+DATABASE\b/i,
    description:
      'DROP DATABASE destroys the entire database. This is irreversible.',
    severity: IrreversibleSeverity.CRITICAL,
  },
  {
    rule: 'DROP_SCHEMA',
    pattern: /\bDROP\s+SCHEMA\b/i,
    description:
      'DROP SCHEMA removes the schema and all contained objects. ' +
      'Ensure a full backup exists.',
    severity: IrreversibleSeverity.CRITICAL,
  },
  {
    rule: 'TRUNCATE',
    pattern: /\bTRUNCATE\b/i,
    description:
      'TRUNCATE removes all rows from a table without logging individual row deletions. ' +
      'Data cannot be recovered without a prior backup.',
    severity: IrreversibleSeverity.CRITICAL,
  },
  {
    rule: 'DROP_TYPE',
    pattern: /\bDROP\s+TYPE\b/i,
    description:
      'DROP TYPE removes a custom type. Columns using this type must be migrated first.',
    severity: IrreversibleSeverity.HIGH,
  },
  {
    rule: 'DROP_INDEX',
    pattern: /\bDROP\s+INDEX\b/i,
    description:
      'DROP INDEX removes an index. While re-creatable, it may cause performance degradation ' +
      'if the down() migration is not implemented.',
    severity: IrreversibleSeverity.WARNING,
  },
  {
    rule: 'DROP_CONSTRAINT',
    pattern: /\bDROP\s+CONSTRAINT\b/i,
    description:
      'DROP CONSTRAINT removes a constraint. Existing data may violate the constraint ' +
      'when it is re-added during rollback.',
    severity: IrreversibleSeverity.HIGH,
  },
  {
    rule: 'ALTER_COLUMN_TYPE',
    pattern: /\bALTER\s+COLUMN\b.*\bTYPE\b/i,
    description:
      'Changing a column type may cause data loss if the new type is narrower than the old one.',
    severity: IrreversibleSeverity.HIGH,
  },
  {
    rule: 'SET_NOT_NULL',
    pattern: /\bSET\s+NOT\s+NULL\b/i,
    description:
      'Adding NOT NULL to an existing column will fail if any rows contain NULL values. ' +
      'Rollback restores the constraint but existing NULLs may have been coerced.',
    severity: IrreversibleSeverity.WARNING,
  },
  {
    rule: 'DELETE_DATA',
    pattern: /\bDELETE\s+FROM\b/i,
    description:
      'DELETE FROM inside a migration permanently removes rows. ' +
      'Ensure the down() migration can restore them or that a backup exists.',
    severity: IrreversibleSeverity.HIGH,
  },
  {
    rule: 'UPDATE_DATA',
    pattern: /\bUPDATE\b.*\bSET\b/i,
    description:
      'UPDATE inside a migration modifies existing data. ' +
      'The original values are lost unless the down() migration reverses the change.',
    severity: IrreversibleSeverity.WARNING,
  },
];

// ---------------------------------------------------------------------------
// Core utilities
// ---------------------------------------------------------------------------

/**
 * Analyse a SQL string (or array of SQL strings) for irreversible operations.
 *
 * @param sql - A single SQL statement or an array of statements.
 * @returns An `IrreversibilityReport` describing all findings.
 *
 * @example
 * const report = detectIrreversibleChanges('DROP TABLE users');
 * if (report.hasIrreversibleChanges) {
 *   console.warn(report.changes);
 * }
 */
export function detectIrreversibleChanges(
  sql: string | string[],
): IrreversibilityReport {
  const statements = Array.isArray(sql) ? sql : [sql];
  const combined = statements.join('\n');

  const changes: IrreversibleChange[] = [];

  for (const rule of DETECTION_RULES) {
    const match = rule.pattern.exec(combined);
    if (match) {
      changes.push({
        rule: rule.rule,
        description: rule.description,
        severity: rule.severity,
        fragment: match[0],
      });
    }
  }

  // Sort: CRITICAL → HIGH → WARNING
  const severityOrder: Record<IrreversibleSeverity, number> = {
    [IrreversibleSeverity.CRITICAL]: 0,
    [IrreversibleSeverity.HIGH]: 1,
    [IrreversibleSeverity.WARNING]: 2,
  };
  changes.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const maxSeverity =
    changes.length > 0 ? (changes[0].severity as IrreversibleSeverity) : null;

  return {
    hasIrreversibleChanges: changes.length > 0,
    changes,
    maxSeverity,
  };
}

/**
 * Wrap a migration `up()` body with rollback-safety pre-flight checks.
 *
 * The wrapper:
 *  1. Analyses the provided SQL for irreversible changes.
 *  2. Logs findings at the appropriate level.
 *  3. Optionally blocks execution when CRITICAL (or HIGH) changes are found.
 *  4. Executes the migration body inside a savepoint so partial failures
 *     can be rolled back without affecting the outer transaction.
 *
 * @param queryRunner - The TypeORM QueryRunner for the current migration.
 * @param sql         - The SQL statement(s) that will be executed.
 * @param body        - Async function containing the actual migration logic.
 * @param options     - Behaviour overrides.
 *
 * @example
 * public async up(queryRunner: QueryRunner): Promise<void> {
 *   await withRollbackSafety(
 *     queryRunner,
 *     'DROP TABLE legacy_tokens',
 *     async () => {
 *       await queryRunner.query('DROP TABLE legacy_tokens');
 *     },
 *     { blockOnCritical: true },
 *   );
 * }
 */
export async function withRollbackSafety(
  queryRunner: QueryRunner,
  sql: string | string[],
  body: () => Promise<void>,
  options: RollbackSafetyOptions = {},
): Promise<void> {
  const {
    blockOnCritical = false,
    blockOnHigh = false,
    logger = console,
  } = options;

  const report = detectIrreversibleChanges(sql);

  if (report.hasIrreversibleChanges) {
    for (const change of report.changes) {
      const msg =
        `[MigrationUtils] ${change.severity} – ${change.rule}: ${change.description}` +
        (change.fragment ? ` (fragment: "${change.fragment}")` : '');

      if (change.severity === IrreversibleSeverity.CRITICAL) {
        logger.error(msg);
      } else if (change.severity === IrreversibleSeverity.HIGH) {
        logger.warn(msg);
      } else {
        logger.log(msg);
      }
    }

    const shouldBlock =
      (blockOnCritical &&
        report.maxSeverity === IrreversibleSeverity.CRITICAL) ||
      (blockOnHigh &&
        (report.maxSeverity === IrreversibleSeverity.CRITICAL ||
          report.maxSeverity === IrreversibleSeverity.HIGH));

    if (shouldBlock) {
      throw new MigrationRollbackError(report);
    }
  }

  // Execute inside a savepoint so a partial failure can be rolled back
  // without aborting the outer transaction managed by TypeORM.
  const savepointName = `sp_migration_${Date.now()}`;
  await queryRunner.query(`SAVEPOINT ${savepointName}`);

  try {
    await body();
  } catch (err) {
    await queryRunner.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
    throw err;
  }

  await queryRunner.query(`RELEASE SAVEPOINT ${savepointName}`);
}

/**
 * Create a backup of a table's data into a temporary shadow table.
 *
 * The shadow table is named `<tableName>_backup_<timestamp>` and is
 * created in the same schema. Call `restoreFromBackup()` in `down()` to
 * restore the data.
 *
 * @param queryRunner - The TypeORM QueryRunner.
 * @param tableName   - Name of the table to back up.
 * @returns The name of the created backup table.
 *
 * @example
 * const backupTable = await createSafeBackup(queryRunner, 'users');
 * // … destructive operation …
 * // In down():
 * await restoreFromBackup(queryRunner, 'users', backupTable);
 */
export async function createSafeBackup(
  queryRunner: QueryRunner,
  tableName: string,
): Promise<string> {
  const backupTable = `${tableName}_backup_${Date.now()}`;
  await queryRunner.query(
    `CREATE TABLE "${backupTable}" AS SELECT * FROM "${tableName}"`,
  );
  return backupTable;
}

/**
 * Restore a table's data from a backup created by `createSafeBackup()`.
 *
 * This truncates the target table and re-inserts all rows from the backup.
 * The backup table is **not** dropped automatically so it can serve as an
 * audit trail; drop it manually once the migration is confirmed stable.
 *
 * @param queryRunner   - The TypeORM QueryRunner.
 * @param tableName     - Name of the table to restore into.
 * @param backupTable   - Name of the backup table (returned by `createSafeBackup()`).
 */
export async function restoreFromBackup(
  queryRunner: QueryRunner,
  tableName: string,
  backupTable: string,
): Promise<void> {
  await queryRunner.query(`TRUNCATE TABLE "${tableName}"`);
  await queryRunner.query(
    `INSERT INTO "${tableName}" SELECT * FROM "${backupTable}"`,
  );
}

/**
 * Drop a backup table created by `createSafeBackup()` once it is no
 * longer needed.
 *
 * @param queryRunner - The TypeORM QueryRunner.
 * @param backupTable - Name of the backup table to drop.
 */
export async function dropBackupTable(
  queryRunner: QueryRunner,
  backupTable: string,
): Promise<void> {
  await queryRunner.query(`DROP TABLE IF EXISTS "${backupTable}"`);
}

/**
 * Verify that a table exists in the database.
 *
 * Useful in `down()` migrations to guard against double-rollback scenarios.
 *
 * @param queryRunner - The TypeORM QueryRunner.
 * @param tableName   - Table name to check.
 * @returns `true` if the table exists, `false` otherwise.
 */
export async function tableExists(
  queryRunner: QueryRunner,
  tableName: string,
): Promise<boolean> {
  const result: Array<{ exists: boolean }> = await queryRunner.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = $1
     ) AS "exists"`,
    [tableName],
  );
  return result[0]?.exists === true;
}

/**
 * Verify that a column exists on a table.
 *
 * Useful in `down()` migrations to guard against double-rollback scenarios.
 *
 * @param queryRunner - The TypeORM QueryRunner.
 * @param tableName   - Table name.
 * @param columnName  - Column name to check.
 * @returns `true` if the column exists, `false` otherwise.
 */
export async function columnExists(
  queryRunner: QueryRunner,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result: Array<{ exists: boolean }> = await queryRunner.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = $1
         AND column_name  = $2
     ) AS "exists"`,
    [tableName, columnName],
  );
  return result[0]?.exists === true;
}
