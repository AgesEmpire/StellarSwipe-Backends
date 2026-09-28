import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddDeletedAtToTrades1753800000001 implements MigrationInterface {
  private readonly table = 'trades';
  private readonly column = 'deleted_at';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable(this.table);
    if (!table) return;

    if (!table.columns.some((existing) => existing.name === this.column)) {
      await queryRunner.addColumn(
        this.table,
        new TableColumn({
          name: this.column,
          type: 'timestamp',
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable(this.table);
    if (!table) return;

    if (table.columns.some((existing) => existing.name === this.column)) {
      await queryRunner.dropColumn(this.table, this.column);
    }
  }
}
