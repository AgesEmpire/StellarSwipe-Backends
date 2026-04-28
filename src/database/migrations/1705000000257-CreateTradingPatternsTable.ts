import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateTradingPatternsTable1705000000257 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "pattern_type_enum" AS ENUM ('win_loss', 'timing', 'sizing', 'holding_period')
    `);

    await queryRunner.query(`
      CREATE TYPE "insight_type_enum" AS ENUM ('strength', 'weakness', 'opportunity')
    `);

    await queryRunner.createTable(
      new Table({
        name: 'trading_patterns',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'user_id', type: 'uuid', isNullable: false },
          {
            name: 'pattern_type',
            type: 'enum',
            enum: ['win_loss', 'timing', 'sizing', 'holding_period'],
          },
          { name: 'metrics', type: 'jsonb' },
          { name: 'analyzed_at', type: 'timestamptz' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'pattern_insights',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'user_id', type: 'uuid', isNullable: false },
          {
            name: 'insight_type',
            type: 'enum',
            enum: ['strength', 'weakness', 'opportunity'],
          },
          { name: 'title', type: 'varchar', length: '255' },
          { name: 'description', type: 'text' },
          { name: 'pattern_type', type: 'varchar', length: '50' },
          { name: 'data', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'trading_patterns',
      new TableIndex({
        name: 'IDX_TRADING_PATTERNS_USER_TYPE',
        columnNames: ['user_id', 'pattern_type'],
      }),
    );
    await queryRunner.createIndex(
      'pattern_insights',
      new TableIndex({
        name: 'IDX_PATTERN_INSIGHTS_USER_ID',
        columnNames: ['user_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'pattern_insights',
      'IDX_PATTERN_INSIGHTS_USER_ID',
    );
    await queryRunner.dropIndex(
      'trading_patterns',
      'IDX_TRADING_PATTERNS_USER_TYPE',
    );
    await queryRunner.dropTable('pattern_insights');
    await queryRunner.dropTable('trading_patterns');
    await queryRunner.query(`DROP TYPE IF EXISTS "insight_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "pattern_type_enum"`);
  }
}
