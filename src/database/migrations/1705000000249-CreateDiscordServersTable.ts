import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateDiscordServersTable1705000000249 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'discord_servers',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'guildId', type: 'varchar' },
          { name: 'guildName', type: 'varchar' },
          { name: 'alertChannelId', type: 'varchar', isNullable: true },
          { name: 'announcementChannelId', type: 'varchar', isNullable: true },
          { name: 'isActive', type: 'boolean', default: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
    );

    await queryRunner.createIndex(
      'discord_servers',
      new TableIndex({ name: 'IDX_discord_servers_guildId', columnNames: ['guildId'], isUnique: true }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'channel_subscriptions',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'guildId', type: 'varchar' },
          { name: 'channelId', type: 'varchar' },
          { name: 'topic', type: 'varchar' },
          { name: 'isActive', type: 'boolean', default: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
    );

    await queryRunner.createIndex(
      'channel_subscriptions',
      new TableIndex({ name: 'IDX_channel_subscriptions_guildId_topic', columnNames: ['guildId', 'topic'], isUnique: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('channel_subscriptions');
    await queryRunner.dropTable('discord_servers');
  }
}
