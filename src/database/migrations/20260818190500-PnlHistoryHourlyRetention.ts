import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

/** Preserve the hour in chart history and support the 90-day cleanup query. */
export class PnlHistoryHourlyRetention20260818190500 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('pnl_history');
    if (!table) return;

    const snapshotDate = table.findColumnByName('snapshot_date');
    if (snapshotDate?.type === 'date') {
      await queryRunner.changeColumn(
        'pnl_history',
        'snapshot_date',
        new TableColumn({ ...snapshotDate, type: 'timestamp with time zone' }),
      );
    }

    const hasIndex = table.indices.some((index) => index.name === 'IDX_pnl_history_user_snapshot_date');
    if (!hasIndex) {
      await queryRunner.createIndex(
        'pnl_history',
        new TableIndex({
          name: 'IDX_pnl_history_user_snapshot_date',
          columnNames: ['user_id', 'snapshot_date'],
        }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('pnl_history');
    if (!table) return;

    const index = table.indices.find((item) => item.name === 'IDX_pnl_history_user_snapshot_date');
    if (index) await queryRunner.dropIndex('pnl_history', index);

    const snapshotDate = table.findColumnByName('snapshot_date');
    if (snapshotDate?.type === 'timestamp with time zone') {
      await queryRunner.changeColumn(
        'pnl_history',
        'snapshot_date',
        new TableColumn({ ...snapshotDate, type: 'date' }),
      );
    }
  }
}
