import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateProfileSessionsTable1705000000261 implements MigrationInterface {
  name = 'CreateProfileSessionsTable1705000000261';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enums ────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "profile_session_status_enum" AS ENUM (
        'active', 'completed', 'failed', 'cancelled'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "profile_session_type_enum" AS ENUM (
        'cpu', 'memory', 'query', 'api', 'full'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "snapshot_type_enum" AS ENUM (
        'cpu', 'memory', 'query', 'api'
      )
    `);

    // ── profile_sessions ─────────────────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'profile_sessions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'name', type: 'varchar', length: '100' },
          {
            name: 'type',
            type: 'enum',
            enumName: 'profile_session_type_enum',
            default: "'full'",
          },
          {
            name: 'status',
            type: 'enum',
            enumName: 'profile_session_status_enum',
            default: "'active'",
          },
          { name: 'durationSeconds', type: 'int', default: 60 },
          { name: 'samplingIntervalMs', type: 'int', default: 1000 },
          { name: 'config', type: 'jsonb', isNullable: true },
          { name: 'summary', type: 'jsonb', isNullable: true },
          { name: 'errorMessage', type: 'text', isNullable: true },
          { name: 'startedAt', type: 'timestamptz', isNullable: true },
          { name: 'completedAt', type: 'timestamptz', isNullable: true },
          { name: 'triggeredBy', type: 'varchar', length: '45', isNullable: true },
          { name: 'environment', type: 'varchar', length: '100', isNullable: true },
          { name: 'appVersion', type: 'varchar', length: '50', isNullable: true },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'profile_sessions',
      new TableIndex({
        name: 'IDX_profile_sessions_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'profile_sessions',
      new TableIndex({
        name: 'IDX_profile_sessions_type_created',
        columnNames: ['type', 'createdAt'],
      }),
    );

    await queryRunner.createIndex(
      'profile_sessions',
      new TableIndex({
        name: 'IDX_profile_sessions_createdAt',
        columnNames: ['createdAt'],
      }),
    );

    // ── performance_snapshots ─────────────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'performance_snapshots',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'sessionId', type: 'uuid' },
          {
            name: 'type',
            type: 'enum',
            enumName: 'snapshot_type_enum',
          },
          { name: 'data', type: 'jsonb' },
          { name: 'valueNumeric', type: 'float', isNullable: true },
          { name: 'isAnomaly', type: 'boolean', default: false },
          { name: 'anomalyReason', type: 'text', isNullable: true },
          { name: 'capturedAt', type: 'timestamptz' },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        foreignKeys: [
          {
            name: 'FK_performance_snapshots_session',
            columnNames: ['sessionId'],
            referencedTableName: 'profile_sessions',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'performance_snapshots',
      new TableIndex({
        name: 'IDX_performance_snapshots_session_captured',
        columnNames: ['sessionId', 'capturedAt'],
      }),
    );

    await queryRunner.createIndex(
      'performance_snapshots',
      new TableIndex({
        name: 'IDX_performance_snapshots_session_type',
        columnNames: ['sessionId', 'type'],
      }),
    );

    await queryRunner.createIndex(
      'performance_snapshots',
      new TableIndex({
        name: 'IDX_performance_snapshots_anomaly',
        columnNames: ['isAnomaly'],
        where: '"isAnomaly" = true',
      }),
    );

    // updatedAt trigger for profile_sessions
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_profile_sessions_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW."updatedAt" = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_profile_sessions_updated_at
      BEFORE UPDATE ON profile_sessions
      FOR EACH ROW
      EXECUTE FUNCTION update_profile_sessions_updated_at();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_profile_sessions_updated_at ON profile_sessions`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS update_profile_sessions_updated_at`);

    await queryRunner.dropTable('performance_snapshots', true);
    await queryRunner.dropTable('profile_sessions', true);

    await queryRunner.query(`DROP TYPE IF EXISTS "snapshot_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "profile_session_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "profile_session_status_enum"`);
  }
}
