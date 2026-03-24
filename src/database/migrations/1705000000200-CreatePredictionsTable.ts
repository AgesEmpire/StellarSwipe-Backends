import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreatePredictionsTable1705000000200 implements MigrationInterface {
  name = 'CreatePredictionsTable1705000000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "ml_prediction_confidence_level_enum" AS ENUM (
        'VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "ml_signal_outcome_enum" AS ENUM (
        'PENDING', 'TARGET_HIT', 'STOP_LOSS_HIT', 'EXPIRED', 'MANUALLY_CLOSED', 'CANCELLED'
      )
    `);

    await queryRunner.createTable(
      new Table({
        name: 'ml_predictions',
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
          { name: 'model_version_id', type: 'uuid', isNullable: true },
          {
            name: 'success_probability',
            type: 'decimal',
            precision: 5,
            scale: 4,
            isNullable: false,
          },
          {
            name: 'expected_pnl_low',
            type: 'decimal',
            precision: 10,
            scale: 6,
            isNullable: false,
          },
          {
            name: 'expected_pnl_mid',
            type: 'decimal',
            precision: 10,
            scale: 6,
            isNullable: false,
          },
          {
            name: 'expected_pnl_high',
            type: 'decimal',
            precision: 10,
            scale: 6,
            isNullable: false,
          },
          {
            name: 'confidence_score',
            type: 'decimal',
            precision: 5,
            scale: 4,
            isNullable: false,
          },
          {
            name: 'confidence_level',
            type: 'enum',
            enumName: 'ml_prediction_confidence_level_enum',
            isNullable: false,
          },
          { name: 'feature_vector', type: 'jsonb', isNullable: false },
          { name: 'model_contributions', type: 'jsonb', isNullable: false, default: "'[]'" },
          { name: 'top_features', type: 'jsonb', isNullable: true },
          { name: 'warnings', type: 'jsonb', isNullable: true },
          { name: 'market_condition_summary', type: 'text', isNullable: true },
          {
            name: 'actual_outcome',
            type: 'enum',
            enumName: 'ml_signal_outcome_enum',
            isNullable: true,
          },
          {
            name: 'actual_pnl',
            type: 'decimal',
            precision: 10,
            scale: 6,
            isNullable: true,
          },
          { name: 'was_correct', type: 'boolean', isNullable: true },
          { name: 'is_verified', type: 'boolean', default: false, isNullable: false },
          {
            name: 'verified_at',
            type: 'timestamp with time zone',
            isNullable: true,
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

    await queryRunner.query(`CREATE INDEX "IDX_ml_predictions_signal_id" ON "ml_predictions" ("signal_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_ml_predictions_provider_created" ON "ml_predictions" ("provider_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_ml_predictions_model_version" ON "ml_predictions" ("model_version_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_ml_predictions_is_verified" ON "ml_predictions" ("is_verified", "created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('ml_predictions');
    await queryRunner.query(`DROP TYPE IF EXISTS "ml_prediction_confidence_level_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ml_signal_outcome_enum"`);
  }
}
