import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateSignalDecayTable1705000000258 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "decay_curve_type_enum" AS ENUM (
        'exponential',
        'linear',
        'logarithmic',
        'power'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "decay_status_enum" AS ENUM (
        'active',
        'degraded',
        'expired'
      )
    `);

    await queryRunner.createTable(
      new Table({
        name: 'signal_decay',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'signal_id', type: 'varchar', isNullable: false },
          { name: 'signal_type', type: 'varchar', isNullable: false },
          {
            name: 'decay_curve_type',
            type: 'enum',
            enum: ['exponential', 'linear', 'logarithmic', 'power'],
            default: "'exponential'",
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['active', 'degraded', 'expired'],
            default: "'active'",
          },
          { name: 'initial_accuracy', type: 'decimal', precision: 5, scale: 4 },
          { name: 'current_accuracy', type: 'decimal', precision: 5, scale: 4 },
          { name: 'decay_rate', type: 'decimal', precision: 8, scale: 6 },
          { name: 'half_life_hours', type: 'decimal', precision: 10, scale: 4 },
          {
            name: 'optimal_entry_window_start',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'optimal_entry_window_end',
            type: 'decimal',
            precision: 10,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'recommended_expiry_hours',
            type: 'decimal',
            precision: 10,
            scale: 4,
          },
          { name: 'sample_count', type: 'int', default: 0 },
          {
            name: 'r_squared',
            type: 'decimal',
            precision: 5,
            scale: 4,
            isNullable: true,
          },
          { name: 'curve_parameters', type: 'jsonb', isNullable: true },
          { name: 'performance_by_hour', type: 'jsonb', isNullable: true },
          { name: 'volatility_adjusted', type: 'boolean', default: false },
          {
            name: 'market_regime',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          { name: 'analyzed_at', type: 'timestamptz' },
          { name: 'valid_until', type: 'timestamptz', isNullable: true },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'signal_decay',
      new TableIndex({
        name: 'IDX_SIGNAL_DECAY_SIGNAL_ID_ANALYZED_AT',
        columnNames: ['signal_id', 'analyzed_at'],
      }),
    );

    await queryRunner.createIndex(
      'signal_decay',
      new TableIndex({
        name: 'IDX_SIGNAL_DECAY_TYPE_STATUS',
        columnNames: ['signal_type', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'signal_decay',
      new TableIndex({
        name: 'IDX_SIGNAL_DECAY_SIGNAL_ID',
        columnNames: ['signal_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('signal_decay', 'IDX_SIGNAL_DECAY_SIGNAL_ID');
    await queryRunner.dropIndex('signal_decay', 'IDX_SIGNAL_DECAY_TYPE_STATUS');
    await queryRunner.dropIndex(
      'signal_decay',
      'IDX_SIGNAL_DECAY_SIGNAL_ID_ANALYZED_AT',
    );
    await queryRunner.dropTable('signal_decay');
    await queryRunner.query(`DROP TYPE IF EXISTS "decay_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "decay_curve_type_enum"`);
  }
}
