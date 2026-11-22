import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Records why a delivery attempt failed and whether it is retryable, so the
 * audit log doubles as the attempt history used to gate manual retries.
 */
export class AddFailureDetailsToNotificationDeliveryAuditLogs20261122120000 implements MigrationInterface {
  name = 'AddFailureDetailsToNotificationDeliveryAuditLogs20261122120000';

  private readonly table = 'notification_delivery_audit_logs';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable(this.table);
    if (!table) return;

    if (!table.columns.some((c) => c.name === 'error_message')) {
      await queryRunner.addColumn(
        this.table,
        new TableColumn({ name: 'error_message', type: 'text', isNullable: true }),
      );
    }

    if (!table.columns.some((c) => c.name === 'retryable')) {
      await queryRunner.addColumn(
        this.table,
        new TableColumn({ name: 'retryable', type: 'boolean', default: false }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn(this.table, 'retryable');
    await queryRunner.dropColumn(this.table, 'error_message');
  }
}
