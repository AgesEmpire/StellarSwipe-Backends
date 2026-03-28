import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateCompetitionsTable1705000000246 implements MigrationInterface {
  name = 'CreateCompetitionsTable1705000000246';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'competitions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'starts_at', type: 'timestamp with time zone' },
          { name: 'ends_at', type: 'timestamp with time zone' },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            default: "'DRAFT'",
          },
          {
            name: 'rules_json',
            type: 'jsonb',
            default: "'{}'",
          },
          {
            name: 'scoring_metric',
            type: 'varchar',
            length: '32',
            default: "'PNL'",
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
      'competitions',
      new TableIndex({
        name: 'IDX_COMPETITIONS_STATUS_WINDOW',
        columnNames: ['status', 'starts_at', 'ends_at'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'competition_prize_pools',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'competition_id',
            type: 'uuid',
            isUnique: true,
          },
          {
            name: 'total_amount',
            type: 'decimal',
            precision: 24,
            scale: 8,
            default: "'0'",
          },
          {
            name: 'currency',
            type: 'varchar',
            length: '16',
            default: "'USDC'",
          },
          {
            name: 'distribution_rules_json',
            type: 'jsonb',
            default: "'[]'",
          },
          {
            name: 'distributed_at',
            type: 'timestamp with time zone',
            isNullable: true,
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

    await queryRunner.createForeignKey(
      'competition_prize_pools',
      new TableForeignKey({
        columnNames: ['competition_id'],
        referencedTableName: 'competitions',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('competition_prize_pools');
    await queryRunner.dropIndex('competitions', 'IDX_COMPETITIONS_STATUS_WINDOW');
    await queryRunner.dropTable('competitions');
  }
}
