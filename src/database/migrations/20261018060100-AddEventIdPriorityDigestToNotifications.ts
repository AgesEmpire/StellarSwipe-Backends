import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

/**
 * Adds:
 *  - `event_id` + a unique partial index, so retried domain-event handlers
 *    can dedupe in-app notification creation at the database level instead
 *    of relying on in-memory state.
 *  - `priority` and `digested_at`, used to batch low-priority notifications
 *    into scheduled digests while keeping urgent notifications immediate.
 */
export class AddEventIdPriorityDigestToNotifications20261018060100 implements MigrationInterface {
  name = 'AddEventIdPriorityDigestToNotifications20261018060100';

  private readonly table = 'notifications';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable(this.table);
    if (!table) return;

    if (!table.columns.some((c) => c.name === 'event_id')) {
      await queryRunner.addColumn(
        this.table,
        new TableColumn({
          name: 'event_id',
          type: 'varchar',
          length: '255',
          isNullable: true,
        }),
      );
    }

    if (!table.columns.some((c) => c.name === 'priority')) {
      await queryRunner.query(`
        ALTER TABLE "notifications"
        ADD COLUMN "priority" varchar(20) NOT NULL DEFAULT 'urgent'
      `);
    }

    if (!table.columns.some((c) => c.name === 'digested_at')) {
      await queryRunner.addColumn(
        this.table,
        new TableColumn({
          name: 'digested_at',
          type: 'timestamp',
          isNullable: true,
        }),
      );
    }

    const hasEventIdIndex = table.indices.some((i) => i.name === 'idx_notifications_event_id');
    if (!hasEventIdIndex) {
      await queryRunner.createIndex(
        this.table,
        new TableIndex({
          name: 'idx_notifications_event_id',
          columnNames: ['event_id'],
          isUnique: true,
          where: '"event_id" IS NOT NULL',
        }),
      );
    }

    const hasDigestIndex = table.indices.some((i) => i.name === 'idx_notifications_digest_lookup');
    if (!hasDigestIndex) {
      await queryRunner.createIndex(
        this.table,
        new TableIndex({
          name: 'idx_notifications_digest_lookup',
          columnNames: ['user_id', 'priority', 'digested_at'],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable(this.table);
    if (!table) return;

    if (table.indices.some((i) => i.name === 'idx_notifications_digest_lookup')) {
      await queryRunner.dropIndex(this.table, 'idx_notifications_digest_lookup');
    }
    if (table.indices.some((i) => i.name === 'idx_notifications_event_id')) {
      await queryRunner.dropIndex(this.table, 'idx_notifications_event_id');
    }
    if (table.columns.some((c) => c.name === 'digested_at')) {
      await queryRunner.dropColumn(this.table, 'digested_at');
    }
    if (table.columns.some((c) => c.name === 'priority')) {
      await queryRunner.dropColumn(this.table, 'priority');
    }
    if (table.columns.some((c) => c.name === 'event_id')) {
      await queryRunner.dropColumn(this.table, 'event_id');
    }
  }
}
