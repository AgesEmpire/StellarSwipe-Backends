import { MigrationInterface, QueryRunner, Table, Index } from 'typeorm';

export class CreateTransactionLimitsTable1737562000000 implements MigrationInterface {
  name = 'CreateTransactionLimitsTable1737562000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'transaction_limits',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'userId',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'userTier',
            type: 'enum',
            enum: ['basic', 'verified', 'premium'],
            default: "'basic'",
          },
          {
            name: 'limitType',
            type: 'enum',
            enum: ['daily_volume', 'weekly_volume', 'hourly_trades', 'daily_trades'],
          },
          {
            name: 'limitValue',
            type: 'decimal',
            precision: 20,
            scale: 8,
          },
          {
            name: 'currentUsage',
            type: 'decimal',
            precision: 20,
            scale: 8,
            default: '0',
          },
          {
            name: 'lastResetAt',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'coolingOffUntil',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'transaction_limits',
      new Index('IDX_transaction_limits_userId', ['userId']),
    );

    await queryRunner.createIndex(
      'transaction_limits',
      new Index('IDX_transaction_limits_userId_limitType', ['userId', 'limitType'], {
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('transaction_limits');
  }
}