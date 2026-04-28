import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateExperimentResultsTable1705000000253 implements MigrationInterface {
  name = 'CreateExperimentResultsTable1705000000253';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'experiment_results',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'uuid_generate_v4()' },
          { name: 'experiment_id', type: 'varchar' },
          { name: 'name', type: 'varchar' },
          { name: 'variants', type: 'jsonb' },
          { name: 'confidence_level', type: 'float', default: 0.95 },
          { name: 'is_significant', type: 'boolean', default: false },
          { name: 'winning_variant', type: 'varchar', isNullable: true },
          { name: 'analysis', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'variant_performance',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'uuid_generate_v4()' },
          { name: 'experiment_id', type: 'varchar' },
          { name: 'variant_id', type: 'varchar' },
          { name: 'name', type: 'varchar' },
          { name: 'impressions', type: 'int', default: 0 },
          { name: 'conversions', type: 'int', default: 0 },
          { name: 'conversion_rate', type: 'float', default: 0 },
          { name: 'mean', type: 'float', isNullable: true },
          { name: 'std_dev', type: 'float', isNullable: true },
          { name: 'recorded_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('experiment_results', new TableIndex({ columnNames: ['experiment_id', 'created_at'] }));
    await queryRunner.createIndex('variant_performance', new TableIndex({ columnNames: ['experiment_id', 'variant_id'] }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('variant_performance');
    await queryRunner.dropTable('experiment_results');
  }
}
