import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateTelegramUsersTable1705000000248 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'telegram_users',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'telegramId', type: 'bigint' },
          { name: 'username', type: 'varchar', isNullable: true },
          { name: 'firstName', type: 'varchar', isNullable: true },
          { name: 'userId', type: 'varchar', isNullable: true },
          { name: 'isActive', type: 'boolean', default: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
    );

    await queryRunner.createIndex(
      'telegram_users',
      new TableIndex({ name: 'IDX_telegram_users_telegramId', columnNames: ['telegramId'], isUnique: true }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'bot_subscriptions',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'telegramId', type: 'bigint' },
          { name: 'type', type: 'varchar' },
          { name: 'isActive', type: 'boolean', default: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
    );

    await queryRunner.createIndex(
      'bot_subscriptions',
      new TableIndex({ name: 'IDX_bot_subscriptions_telegramId_type', columnNames: ['telegramId', 'type'], isUnique: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('bot_subscriptions');
    await queryRunner.dropTable('telegram_users');
  }
}
