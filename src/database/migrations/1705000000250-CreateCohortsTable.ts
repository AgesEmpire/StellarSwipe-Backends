import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateCohortsTable1705000000250 implements MigrationInterface {
  name = 'CreateCohortsTable1705000000250';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'cohorts',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'uuid_generate_v4()' },
          { name: 'cohort_type', type: 'varchar' },
          { name: 'cohort_key', type: 'varchar' },
          { name: 'cohort_size', type: 'int', default: 0 },
          { name: 'metadata', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'now()' },
          { name: 'updated_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'cohort_metrics',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'uuid_generate_v4()' },
          { name: 'cohort_type', type: 'varchar' },
          { name: 'cohort_key', type: 'varchar' },
          { name: 'period_index', type: 'int' },
          { name: 'active_users', type: 'int', default: 0 },
          { name: 'retention_rate', type: 'float', default: 0 },
          { name: 'created_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('cohorts', new TableIndex({ columnNames: ['cohort_type', 'cohort_key'], isUnique: true }));
    await queryRunner.createIndex('cohort_metrics', new TableIndex({ columnNames: ['cohort_type', 'cohort_key', 'period_index'], isUnique: true }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('cohort_metrics');
    await queryRunner.dropTable('cohorts');
  }
}
