import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateReferralsTable1737650000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'referrals',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'referrer_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'referred_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'referral_code',
            type: 'varchar',
            length: '8',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['pending', 'completed', 'rewarded'],
            default: "'pending'",
          },
          {
            name: 'reward_amount',
            type: 'decimal',
            precision: 18,
            scale: 7,
            default: '5.0000000',
          },
          {
            name: 'first_trade_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'rewarded_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'reward_tx_hash',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Create indexes
    await queryRunner.createIndex(
      'referrals',
      new TableIndex({
        name: 'IDX_referrals_referrer_id',
        columnNames: ['referrer_id'],
      }),
    );

    await queryRunner.createIndex(
      'referrals',
      new TableIndex({
        name: 'IDX_referrals_referred_id',
        columnNames: ['referred_id'],
      }),
    );

    await queryRunner.createIndex(
      'referrals',
      new TableIndex({
        name: 'IDX_referrals_referral_code',
        columnNames: ['referral_code'],
      }),
    );

    // Create foreign keys
    await queryRunner.createForeignKey(
      'referrals',
      new TableForeignKey({
        columnNames: ['referrer_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'referrals',
      new TableForeignKey({
        columnNames: ['referred_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('referrals');
    if (table) {
      const foreignKeys = table.foreignKeys;
      for (const foreignKey of foreignKeys) {
        await queryRunner.dropForeignKey('referrals', foreignKey);
      }
    }
    await queryRunner.dropTable('referrals');
  }
}
