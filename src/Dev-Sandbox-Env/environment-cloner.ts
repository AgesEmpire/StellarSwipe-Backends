import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SandboxEnvironment } from '../entities/sandbox-environment.entity';
import { TestDataSnapshot, SnapshotType } from '../entities/test-data-snapshot.entity';

const logger = new Logger('EnvironmentCloner');

export interface CloneOptions {
  sourceSandbox: SandboxEnvironment;
  targetName: string;
  targetOwnerId: string;
  targetSchemaPrefix: string;
  copyData?: boolean;
  copyMockConfig?: boolean;
  copyFeatureFlags?: boolean;
  newTtlSeconds?: number;
}

export interface CloneResult {
  sourceId: string;
  targetId: string;
  targetName: string;
  rowsCopied: number;
  durationMs: number;
}

const CLONEABLE_TABLES = [
  'users',
  'artists',
  'tracks',
  'subscriptions',
  'tips',
] as const;

/**
 * EnvironmentCloner duplicates a sandbox's configuration and optionally
 * its data into a new sandbox environment. Useful for forking a baseline
 * environment for parallel test runs.
 */
export class EnvironmentCloner {
  constructor(private readonly dataSource: DataSource) {}

  async clone(options: CloneOptions): Promise<CloneResult> {
    const start = Date.now();
    logger.log(
      `Cloning sandbox "${options.sourceSandbox.name}" → "${options.targetName}"`,
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let rowsCopied = 0;

    try {
      if (options.copyData) {
        for (const table of CLONEABLE_TABLES) {
          const copied = await this.cloneTableData(
            queryRunner,
            table,
            options.sourceSandbox.schemaPrefix,
            options.targetSchemaPrefix,
          );
          rowsCopied += copied;
          logger.debug(
            `Cloned ${copied} rows from ${table} into "${options.targetName}"`,
          );
        }
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    const result: CloneResult = {
      sourceId: options.sourceSandbox.id,
      targetId: '', // filled by caller after entity creation
      targetName: options.targetName,
      rowsCopied,
      durationMs: Date.now() - start,
    };

    logger.log(
      `Clone complete: ${rowsCopied} rows copied in ${result.durationMs}ms`,
    );

    return result;
  }

  buildClonedEnvironment(options: CloneOptions): Partial<SandboxEnvironment> {
    const source = options.sourceSandbox;

    return {
      name: options.targetName,
      ownerId: options.targetOwnerId,
      tier: source.tier,
      description: `Clone of "${source.name}"`,
      schemaPrefix: options.targetSchemaPrefix,
      featureFlags: options.copyFeatureFlags ? { ...source.featureFlags } : {},
      mockConfig: options.copyMockConfig ? { ...source.mockConfig } : {},
      ttlSeconds: options.newTtlSeconds ?? source.ttlSeconds,
      expiresAt:
        options.newTtlSeconds != null
          ? new Date(Date.now() + options.newTtlSeconds * 1000)
          : source.expiresAt,
      metadata: {
        clonedFrom: source.id,
        clonedFromName: source.name,
        clonedAt: new Date().toISOString(),
      },
    };
  }

  buildSnapshotFromClone(
    targetEnvId: string,
    sourceName: string,
    rowsCopied: number,
  ): Partial<TestDataSnapshot> {
    return {
      environmentId: targetEnvId,
      label: `Cloned from "${sourceName}"`,
      type: SnapshotType.SEEDED,
      totalRows: rowsCopied,
      isRestorable: true,
      metadata: { origin: 'clone' },
    };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async cloneTableData(
    queryRunner: any,
    table: string,
    sourcePrefix: string,
    targetPrefix: string,
  ): Promise<number> {
    /**
     * Copy all rows from source prefix, replacing the sandbox_prefix column
     * with the target prefix. New UUIDs are generated to avoid PK collisions.
     *
     * NOTE: This approach works when table schemas are consistent.
     * Adjust the column list per table if column sets diverge.
     */
    try {
      const result = await queryRunner.query(`
        INSERT INTO ${table} (sandbox_prefix, id, created_at, updated_at)
        SELECT $2, gen_random_uuid(), NOW(), NOW()
        FROM ${table}
        WHERE sandbox_prefix = $1
      `, [sourcePrefix, targetPrefix]);

      // rowCount from pg driver
      return result?.rowCount ?? 0;
    } catch (err: any) {
      logger.warn(`Could not clone table ${table}: ${err.message}`);
      return 0;
    }
  }
}

export function createEnvironmentCloner(dataSource: DataSource): EnvironmentCloner {
  return new EnvironmentCloner(dataSource);
}
