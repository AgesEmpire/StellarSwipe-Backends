import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateBenchmarksTable1705000000256 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "benchmark_type_enum" AS ENUM (
        'platform',
        'peer_group',
        'market_index'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "performance_tier_enum" AS ENUM (
        'top',
        'above_average',
        'below_average',
        'bottom'
      )
    `);

    await queryRunner.createTable(
      new Table({
        name: 'provider_benchmarks',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'provider_id', type: 'varchar', isNullable: false },
          {
            name: 'benchmark_type',
            type: 'enum',
            enum: ['platform', 'peer_group', 'market_index'],
          },
          { name: 'reference_id', type: 'varchar', isNullable: true },
          { name: 'period_start', type: 'timestamptz' },
          { name: 'period_end', type: 'timestamptz' },
          { name: 'overall_score', type: 'decimal', precision: 8, scale: 4 },
          {
            name: 'overall_percentile',
            type: 'decimal',
            precision: 5,
            scale: 2,
          },
          {
            name: 'overall_tier',
            type: 'enum',
            enum: ['top', 'above_average', 'below_average', 'bottom'],
          },
          { name: 'metrics', type: 'jsonb' },
          { name: 'platform_stats', type: 'jsonb', isNullable: true },
          { name: 'sample_size', type: 'int', default: 0 },
          { name: 'calculated_at', type: 'timestamptz' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'peer_groups',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'group_key', type: 'varchar', isUnique: true },
          { name: 'name', type: 'varchar' },
          { name: 'description', type: 'varchar', isNullable: true },
          { name: 'criteria', type: 'jsonb' },
          { name: 'provider_ids', type: 'jsonb' },
          { name: 'provider_count', type: 'int', default: 0 },
          { name: 'is_active', type: 'boolean', default: true },
          { name: 'last_updated_at', type: 'timestamptz' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'provider_benchmarks',
      new TableIndex({
        name: 'IDX_PROVIDER_BENCHMARKS_PROVIDER_PERIOD_TYPE',
        columnNames: ['provider_id', 'period_start', 'benchmark_type'],
      }),
    );

    await queryRunner.createIndex(
      'provider_benchmarks',
      new TableIndex({
        name: 'IDX_PROVIDER_BENCHMARKS_TYPE_PERCENTILE',
        columnNames: ['benchmark_type', 'overall_percentile'],
      }),
    );

    await queryRunner.createIndex(
      'provider_benchmarks',
      new TableIndex({
        name: 'IDX_PROVIDER_BENCHMARKS_PROVIDER_ID',
        columnNames: ['provider_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'provider_benchmarks',
      'IDX_PROVIDER_BENCHMARKS_PROVIDER_ID',
    );
    await queryRunner.dropIndex(
      'provider_benchmarks',
      'IDX_PROVIDER_BENCHMARKS_TYPE_PERCENTILE',
    );
    await queryRunner.dropIndex(
      'provider_benchmarks',
      'IDX_PROVIDER_BENCHMARKS_PROVIDER_PERIOD_TYPE',
    );
    await queryRunner.dropTable('peer_groups');
    await queryRunner.dropTable('provider_benchmarks');
    await queryRunner.query(`DROP TYPE IF EXISTS "performance_tier_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "benchmark_type_enum"`);
  }
}
