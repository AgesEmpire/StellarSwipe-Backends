import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

/**
 * Adds:
 *  - `external_message_id` and `delivery_state` on `notifications`, so provider
 *    receipts can be matched to a notification and its delivery state tracked.
 *  - `notification_provider_receipts`, one row per provider event, with a
 *    unique `(provider, event_id)` index so redelivered events are applied once.
 */
export class CreateNotificationProviderReceipts20261122090000 implements MigrationInterface {
  name = 'CreateNotificationProviderReceipts20261122090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('notifications', [
      new TableColumn({ name: 'external_message_id', type: 'varchar', length: '255', isNullable: true }),
      new TableColumn({ name: 'delivery_state', type: 'varchar', length: '20', isNullable: true }),
    ]);

    await queryRunner.createIndex(
      'notifications',
      new TableIndex({
        name: 'idx_notifications_external_message_id',
        columnNames: ['external_message_id'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'notification_provider_receipts',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'provider', type: 'varchar', length: '20', isNullable: false },
          { name: 'event_id', type: 'varchar', length: '255', isNullable: false },
          { name: 'external_message_id', type: 'varchar', length: '255', isNullable: true },
          { name: 'notification_id', type: 'uuid', isNullable: true },
          { name: 'provider_status', type: 'varchar', length: '100', isNullable: false },
          { name: 'delivery_state', type: 'varchar', length: '20', isNullable: true },
          { name: 'applied', type: 'boolean', isNullable: false, default: false },
          { name: 'reason', type: 'text', isNullable: true },
          { name: 'occurred_at', type: 'timestamp with time zone', isNullable: true },
          { name: 'created_at', type: 'timestamp with time zone', isNullable: false, default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndices('notification_provider_receipts', [
      new TableIndex({
        name: 'idx_notification_provider_receipts_event',
        columnNames: ['provider', 'event_id'],
        isUnique: true,
      }),
      new TableIndex({
        name: 'idx_notification_provider_receipts_message',
        columnNames: ['external_message_id'],
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('notification_provider_receipts', true);

    await queryRunner.dropIndex('notifications', 'idx_notifications_external_message_id');
    await queryRunner.dropColumns('notifications', ['external_message_id', 'delivery_state']);
  }
}
