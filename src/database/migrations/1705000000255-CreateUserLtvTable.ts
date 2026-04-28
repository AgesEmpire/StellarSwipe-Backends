import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateUserLtvTable1705000000255 implements MigrationInterface {
  name = 'CreateUserLtvTable1705000000255';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'user_ltv',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'uuid_generate_v4()' },
          { name: 'user_id', type: 'varchar', isUnique: true },
          { name: 'predicted_ltv', type: 'float', default: 0 },
          { name: 'historical_ltv', type: 'float', default: 0 },
          { name: 'cohort_ltv', type: 'float', default: 0 },
          { name: 'subscription_tier', type: 'varchar', default: "'free'" },
          { name: 'forecast_months', type: 'int', default: 12 },
          { name: 'confidence', type: 'float', default: 0 },
          { name: 'segment', type: 'varchar', default: "'low'" },
          { name: 'metadata', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'now()' },
          { name: 'updated_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'ltv_segments',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'uuid_generate_v4()' },
          { name: 'segment', type: 'varchar', isUnique: true },
          { name: 'min_ltv', type: 'float', default: 0 },
          { name: 'max_ltv', type: 'float', default: 0 },
          { name: 'user_count', type: 'int', default: 0 },
          { name: 'avg_ltv', type: 'float', default: 0 },
          { name: 'updated_at', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('user_ltv', new TableIndex({ columnNames: ['user_id'], isUnique: true }));
    await queryRunner.createIndex('user_ltv', new TableIndex({ columnNames: ['segment'] }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('ltv_segments');
    await queryRunner.dropTable('user_ltv');
  }
}
