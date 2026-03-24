import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateTrainingDataTable1705000000201 implements MigrationInterface {
  name = 'CreateTrainingDataTable1705000000201';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'ml_training_data',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'signal_id', type: 'uuid', isNullable: false },
          { name: 'provider_id', type: 'uuid', isNullable: false },
          { name: 'asset_pair', type: 'varchar', length: '50', isNullable: false },
          { name: 'feature_vector', type: 'jsonb', isNullable: false },
          { name: 'feature_snapshot', type: 'jsonb', isNullable: false },
          { name: 'success_label', type: 'smallint', isNullable: false },
          {
            name: 'pnl_label',
            type: 'decimal',
            precision: 10,
            scale: 6,
            isNullable: false,
          },
          {
            name: 'outcome',
            type: 'enum',
            // Re-use the outcome enum created by the predictions migration
            enumName: 'ml_signal_outcome_enum',
            isNullable: false,
          },
          { name: 'is_validated', type: 'boolean', default: true, isNullable: false },
          {
            name: 'collected_at',
            type: 'timestamp with time zone',
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ml_training_data_signal_id" ON "ml_training_data" ("signal_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_ml_training_data_provider_collected" ON "ml_training_data" ("provider_id", "collected_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_ml_training_data_validated_collected" ON "ml_training_data" ("is_validated", "collected_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_ml_training_data_asset_pair" ON "ml_training_data" ("asset_pair")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('ml_training_data');
  }
}
