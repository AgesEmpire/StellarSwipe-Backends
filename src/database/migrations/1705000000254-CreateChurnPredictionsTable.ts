import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateChurnPredictionsTable1705000000254 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'churn_predictions',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'userId', type: 'varchar' },
          { name: 'riskScore', type: 'decimal', precision: 5, scale: 4 },
          { name: 'riskLevel', type: 'varchar' },
          { name: 'daysSinceLastLogin', type: 'int', isNullable: true },
          { name: 'engagementScore', type: 'decimal', precision: 5, scale: 2, isNullable: true },
          { name: 'retentionTriggered', type: 'boolean', default: false },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
    );

    await queryRunner.createIndex(
      'churn_predictions',
      new TableIndex({ name: 'IDX_churn_predictions_userId_createdAt', columnNames: ['userId', 'createdAt'] }),
    );

    await queryRunner.createIndex(
      'churn_predictions',
      new TableIndex({ name: 'IDX_churn_predictions_riskLevel', columnNames: ['riskLevel', 'retentionTriggered'] }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'retention_campaigns',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'userId', type: 'varchar' },
          { name: 'churnPredictionId', type: 'uuid' },
          { name: 'actionType', type: 'varchar' },
          { name: 'message', type: 'text', isNullable: true },
          { name: 'opened', type: 'boolean', default: false },
          { name: 'converted', type: 'boolean', default: false },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('retention_campaigns');
    await queryRunner.dropTable('churn_predictions');
  }
}
