import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Creates the `trade_sagas` table used to persist saga state and provide
 * an audit trail for multi-step trade execution.
 */
export class CreateTradeSagas1719000000000 implements MigrationInterface {
  name = 'CreateTradeSagas1719000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the saga_status enum type
    await queryRunner.query(`
      CREATE TYPE "trade_saga_status_enum" AS ENUM (
        'running',
        'completed',
        'compensating',
        'compensated',
        'failed_to_compensate'
      )
    `);

    await queryRunner.createTable(
      new Table({
        name: 'trade_sagas',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'trade_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'trace_id',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enumName: 'trade_saga_status_enum',
            default: "'running'",
            isNullable: false,
          },
          {
            name: 'steps',
            type: 'jsonb',
            default: "'[]'",
            isNullable: false,
          },
          {
            name: 'outcome_message',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'payload',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp with time zone',
            default: 'now()',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'trade_sagas',
      new TableIndex({
        name: 'idx_trade_saga_trade_id',
        columnNames: ['trade_id'],
      }),
    );

    await queryRunner.createIndex(
      'trade_sagas',
      new TableIndex({
        name: 'idx_trade_saga_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'trade_sagas',
      new TableIndex({
        name: 'idx_trade_saga_user_id',
        columnNames: ['user_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('trade_sagas', 'idx_trade_saga_user_id');
    await queryRunner.dropIndex('trade_sagas', 'idx_trade_saga_status');
    await queryRunner.dropIndex('trade_sagas', 'idx_trade_saga_trade_id');
    await queryRunner.dropTable('trade_sagas');
    await queryRunner.query(`DROP TYPE IF EXISTS "trade_saga_status_enum"`);
  }
}
