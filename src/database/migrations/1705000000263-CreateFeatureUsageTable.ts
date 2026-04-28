import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateFeatureUsageTable1705000000263 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "user_segment_enum" AS ENUM ('free', 'pro', 'enterprise', 'trial')
    `);
    await queryRunner.query(`
      CREATE TYPE "usage_event_type_enum" AS ENUM ('view', 'interact', 'complete', 'error', 'abandon')
    `);
    await queryRunner.query(`
      CREATE TYPE "adoption_stage_enum" AS ENUM ('awareness', 'activation', 'habit', 'champion', 'churned')
    `);

    await queryRunner.createTable(
      new Table({
        name: 'feature_usage_events',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'feature_key', type: 'varchar', isNullable: false },
          { name: 'feature_category', type: 'varchar', isNullable: true },
          { name: 'user_id', type: 'varchar', isNullable: false },
          {
            name: 'user_segment',
            type: 'enum',
            enum: ['free', 'pro', 'enterprise', 'trial'],
            default: "'free'",
          },
          {
            name: 'event_type',
            type: 'enum',
            enum: ['view', 'interact', 'complete', 'error', 'abandon'],
            default: "'interact'",
          },
          { name: 'session_id', type: 'varchar', isNullable: true },
          { name: 'duration_ms', type: 'int', isNullable: true },
          { name: 'metadata', type: 'jsonb', isNullable: true },
          { name: 'occurred_at', type: 'timestamptz', isNullable: false },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'feature_adoption',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'feature_key', type: 'varchar', isNullable: false },
          { name: 'feature_category', type: 'varchar', isNullable: true },
          { name: 'period_date', type: 'date', isNullable: false },
          {
            name: 'user_segment',
            type: 'enum',
            enum: ['free', 'pro', 'enterprise', 'trial'],
            isNullable: true,
          },
          { name: 'total_events', type: 'int', default: 0 },
          { name: 'unique_users', type: 'int', default: 0 },
          { name: 'new_users', type: 'int', default: 0 },
          { name: 'returning_users', type: 'int', default: 0 },
          {
            name: 'adoption_rate',
            type: 'decimal',
            precision: 5,
            scale: 4,
            default: 0,
          },
          {
            name: 'retention_rate',
            type: 'decimal',
            precision: 5,
            scale: 4,
            default: 0,
          },
          {
            name: 'avg_duration_ms',
            type: 'decimal',
            precision: 12,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'error_rate',
            type: 'decimal',
            precision: 5,
            scale: 4,
            default: 0,
          },
          { name: 'stage_breakdown', type: 'jsonb', isNullable: true },
          { name: 'aggregated_at', type: 'timestamptz', isNullable: false },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    // Indexes for feature_usage_events
    await queryRunner.createIndex(
      'feature_usage_events',
      new TableIndex({
        name: 'IDX_FEATURE_USAGE_KEY_OCCURRED',
        columnNames: ['feature_key', 'occurred_at'],
      }),
    );
    await queryRunner.createIndex(
      'feature_usage_events',
      new TableIndex({
        name: 'IDX_FEATURE_USAGE_USER_KEY',
        columnNames: ['user_id', 'feature_key'],
      }),
    );
    await queryRunner.createIndex(
      'feature_usage_events',
      new TableIndex({
        name: 'IDX_FEATURE_USAGE_SEGMENT_KEY',
        columnNames: ['user_segment', 'feature_key'],
      }),
    );
    await queryRunner.createIndex(
      'feature_usage_events',
      new TableIndex({
        name: 'IDX_FEATURE_USAGE_OCCURRED',
        columnNames: ['occurred_at'],
      }),
    );

    // Indexes for feature_adoption
    await queryRunner.createIndex(
      'feature_adoption',
      new TableIndex({
        name: 'IDX_FEATURE_ADOPTION_KEY_PERIOD_SEGMENT',
        columnNames: ['feature_key', 'period_date', 'user_segment'],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      'feature_adoption',
      new TableIndex({
        name: 'IDX_FEATURE_ADOPTION_KEY_PERIOD',
        columnNames: ['feature_key', 'period_date'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'feature_adoption',
      'IDX_FEATURE_ADOPTION_KEY_PERIOD',
    );
    await queryRunner.dropIndex(
      'feature_adoption',
      'IDX_FEATURE_ADOPTION_KEY_PERIOD_SEGMENT',
    );
    await queryRunner.dropIndex(
      'feature_usage_events',
      'IDX_FEATURE_USAGE_OCCURRED',
    );
    await queryRunner.dropIndex(
      'feature_usage_events',
      'IDX_FEATURE_USAGE_SEGMENT_KEY',
    );
    await queryRunner.dropIndex(
      'feature_usage_events',
      'IDX_FEATURE_USAGE_USER_KEY',
    );
    await queryRunner.dropIndex(
      'feature_usage_events',
      'IDX_FEATURE_USAGE_KEY_OCCURRED',
    );
    await queryRunner.dropTable('feature_adoption');
    await queryRunner.dropTable('feature_usage_events');
    await queryRunner.query(`DROP TYPE IF EXISTS "adoption_stage_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "usage_event_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_segment_enum"`);
  }
}
