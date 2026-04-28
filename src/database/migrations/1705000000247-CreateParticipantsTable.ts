import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateParticipantsTable1705000000247 implements MigrationInterface {
  name = 'CreateParticipantsTable1705000000247';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'competition_participants',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'competition_id', type: 'uuid' },
          { name: 'user_id', type: 'uuid' },
          { name: 'joined_at', type: 'timestamp with time zone' },
          {
            name: 'current_score',
            type: 'double precision',
            default: 0,
          },
          { name: 'rank', type: 'int', isNullable: true },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            default: "'ACTIVE'",
          },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp with time zone',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'competition_participants',
      new TableIndex({
        name: 'UQ_COMPETITION_PARTICIPANT_USER',
        columnNames: ['competition_id', 'user_id'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'competition_participants',
      new TableIndex({
        name: 'IDX_COMPETITION_PARTICIPANTS_RANK',
        columnNames: ['competition_id', 'rank'],
      }),
    );

    await queryRunner.createForeignKey(
      'competition_participants',
      new TableForeignKey({
        columnNames: ['competition_id'],
        referencedTableName: 'competitions',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'competition_participants',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'competition_trades',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'participant_id', type: 'uuid' },
          {
            name: 'external_trade_id',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          {
            name: 'volume',
            type: 'decimal',
            precision: 24,
            scale: 8,
            default: "'0'",
          },
          {
            name: 'realized_pnl',
            type: 'decimal',
            precision: 24,
            scale: 8,
            default: "'0'",
          },
          {
            name: 'asset_pair',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          { name: 'recorded_at', type: 'timestamp with time zone' },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'competition_trades',
      new TableIndex({
        name: 'IDX_COMPETITION_TRADES_PARTICIPANT_TIME',
        columnNames: ['participant_id', 'recorded_at'],
      }),
    );

    await queryRunner.createForeignKey(
      'competition_trades',
      new TableForeignKey({
        columnNames: ['participant_id'],
        referencedTableName: 'competition_participants',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('competition_trades');
    await queryRunner.dropTable('competition_participants');
  }
}
