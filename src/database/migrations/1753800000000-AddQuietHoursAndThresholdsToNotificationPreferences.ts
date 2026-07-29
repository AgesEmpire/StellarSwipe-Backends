import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddQuietHoursAndThresholdsToNotificationPreferences1753800000000
  implements MigrationInterface
{
  private readonly table = 'user_notification_preferences';
  private readonly columns: TableColumn[] = [
    new TableColumn({
      name: 'quiet_hours_enabled',
      type: 'boolean',
      default: false,
    }),
    new TableColumn({
      name: 'quiet_hours_start',
      type: 'varchar',
      length: '5',
      isNullable: true,
    }),
    new TableColumn({
      name: 'quiet_hours_end',
      type: 'varchar',
      length: '5',
      isNullable: true,
    }),
    new TableColumn({
      name: 'timezone',
      type: 'varchar',
      default: "'UTC'",
    }),
    new TableColumn({
      name: 'thresholds',
      type: 'jsonb',
      isNullable: true,
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
