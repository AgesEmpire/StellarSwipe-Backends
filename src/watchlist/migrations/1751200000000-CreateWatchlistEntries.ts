import { MigrationInterface, QueryRunner, Table, TableIndex, TableUnique } from 'typeorm';

export class CreateWatchlistEntries1751200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'watchlist_entries',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'trader_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'added_at',
            type: 'timestamp with time zone',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createUniqueConstraint(
      'watchlist_entries',
      new TableUnique({
        name: 'UQ_watchlist_entries_user_trader',
        columnNames: ['user_id', 'trader_id'],
      }),
    );

    await queryRunner.createIndex(
      'watchlist_entries',
      new TableIndex({
        name: 'IDX_watchlist_entries_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'watchlist_entries',
      new TableIndex({
        name: 'IDX_watchlist_entries_trader_id',
        columnNames: ['trader_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('watchlist_entries');
  }
}
