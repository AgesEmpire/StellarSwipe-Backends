import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateNotificationDeliveryAuditLogsTable20260720120000
  implements MigrationInterface
{
  name = 'CreateNotificationDeliveryAuditLogsTable20260720120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "notification_delivery_audit_logs_channel_enum" AS ENUM ('email', 'in_app', 'push', 'both')
    `);

    await queryRunner.createTable(
      new Table({
        name: 'notification_delivery_audit_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'user_id', type: 'uuid', isNullable: false },
          { name: 'notification_id', type: 'uuid', isNullable: true },
          {
            name: 'notification_type',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'channel',
            type: 'notification_delivery_audit_logs_channel_enum',
            isNullable: false,
          },
          {
            name: 'delivered_at',
            type: 'timestamp with time zone',
            isNullable: true,
          },
          { name: 'skipped_reason', type: 'text', isNullable: true },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'notification_delivery_audit_logs',
      new TableIndex({
        name: 'idx_notification_delivery_audit_logs_user_created_at',
        columnNames: ['user_id', 'created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'notification_delivery_audit_logs',
      'idx_notification_delivery_audit_logs_user_created_at',
    );
    await queryRunner.dropTable('notification_delivery_audit_logs');
    await queryRunner.query(
      `DROP TYPE IF EXISTS "notification_delivery_audit_logs_channel_enum"`,
    );
  }
}
