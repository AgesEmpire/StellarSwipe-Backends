import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds scheduled-digest configuration and locale to
 * user_notification_preferences, so low-priority notifications can be
 * grouped into a digest the user controls (enabled/disabled, frequency,
 * time of day) and rendered in their locale.
 */
export class AddDigestAndLocaleToNotificationPreferences20261018060200 implements MigrationInterface {
  name = 'AddDigestAndLocaleToNotificationPreferences20261018060200';

  private readonly table = 'user_notification_preferences';
  private readonly columns: TableColumn[] = [
    new TableColumn({
      name: 'digest_enabled',
      type: 'boolean',
      default: true,
    }),
    new TableColumn({
      name: 'digest_frequency',
      type: 'varchar',
      length: '10',
      default: "'daily'",
    }),
    new TableColumn({
      name: 'digest_hour',
      type: 'int',
      default: 9,
    }),
    new TableColumn({
      name: 'locale',
      type: 'varchar',
      length: '10',
      default: "'en'",
    }),
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable(this.table);
    if (!table) return;

    for (const column of this.columns) {
      if (!table.columns.some((existing) => existing.name === column.name)) {
        await queryRunner.addColumn(this.table, column);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable(this.table);
    if (!table) return;

    for (const column of this.columns) {
      if (table.columns.some((existing) => existing.name === column.name)) {
        await queryRunner.dropColumn(this.table, column.name);
      }
    }
  }
}
