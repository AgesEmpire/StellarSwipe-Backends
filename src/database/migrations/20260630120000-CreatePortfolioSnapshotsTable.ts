import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreatePortfolioSnapshotsTable20260630120000 implements MigrationInterface {
  name = 'CreatePortfolioSnapshotsTable20260630120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'portfolio_snapshots',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'realized_pnl',
            type: 'decimal',
            precision: 18,
            scale: 8,
            default: '0',
            isNullable: false,
          },
          {
            name: 'unrealized_pnl',
            type: 'decimal',
            precision: 18,
            scale: 8,
            default: '0',
            isNullable: false,
          },
          {
            name: 'total_pnl',
            type: 'decimal',
            precision: 18,
            scale: 8,
            default: '0',
            isNullable: false,
          },
          {
            name: 'portfolio_value',
            type: 'decimal',
            precision: 18,
            scale: 8,
            default: '0',
            isNullable: false,
          },
          {
            name: 'computed_at',
            type: 'timestamp',
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'portfolio_snapshots',
      new TableIndex({
        name: 'IDX_portfolio_snapshots_user_computed_at',
        columnNames: ['user_id', 'computed_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('portfolio_snapshots');
  }
}
