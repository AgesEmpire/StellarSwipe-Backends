import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateModelVersionsTable1705000000202 implements MigrationInterface {
  name = 'CreateModelVersionsTable1705000000202';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "ml_model_type_enum" AS ENUM (
        'GRADIENT_BOOSTING', 'NEURAL_NETWORK', 'ENSEMBLE'
      )
    `);

    await queryRunner.createTable(
      new Table({
        name: 'ml_model_versions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'model_type',
            type: 'enum',
            enumName: 'ml_model_type_enum',
            isNullable: false,
          },
          { name: 'version', type: 'varchar', length: '50', isNullable: false },
          { name: 'is_active', type: 'boolean', default: false, isNullable: false },
          {
            name: 'accuracy',
            type: 'decimal',
            precision: 5,
            scale: 4,
            default: 0,
            isNullable: false,
          },
          {
            name: 'precision',
            type: 'decimal',
            precision: 5,
            scale: 4,
            default: 0,
            isNullable: false,
          },
          {
            name: 'recall',
            type: 'decimal',
            precision: 5,
            scale: 4,
            default: 0,
            isNullable: false,
          },
          {
            name: 'f1_score',
            type: 'decimal',
            precision: 5,
            scale: 4,
            default: 0,
            isNullable: false,
          },
          {
            name: 'auc',
            type: 'decimal',
            precision: 5,
            scale: 4,
            default: 0,
            isNullable: false,
          },
          { name: 'samples_used', type: 'int', default: 0, isNullable: false },
          { name: 'training_duration_ms', type: 'int', default: 0, isNullable: false },
          { name: 'model_data', type: 'jsonb', isNullable: false },
          { name: 'feature_importance', type: 'jsonb', isNullable: true },
          { name: 'training_config', type: 'jsonb', isNullable: true },
          {
            name: 'trained_at',
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

    await queryRunner.query(`CREATE INDEX "IDX_ml_model_versions_type_active" ON "ml_model_versions" ("model_type", "is_active")`);
    await queryRunner.query(`CREATE INDEX "IDX_ml_model_versions_trained_at" ON "ml_model_versions" ("trained_at" DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('ml_model_versions');
    await queryRunner.query(`DROP TYPE IF EXISTS "ml_model_type_enum"`);
  }
}
