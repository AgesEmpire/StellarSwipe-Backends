import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateContestsTable1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'contests',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'start_time',
            type: 'timestamp with time zone',
          },
          {
            name: 'end_time',
            type: 'timestamp with time zone',
          },
          {
            name: 'metric',
            type: 'enum',
            enum: ['HIGHEST_ROI', 'BEST_SUCCESS_RATE', 'MOST_VOLUME', 'MOST_FOLLOWERS'],
            default: "'HIGHEST_ROI'",
          },
          {
            name: 'min_signals',
            type: 'int',
            default: 3,
          },
          {
            name: 'prize_pool',
            type: 'decimal',
            precision: 18,
            scale: 8,
            default: '0',
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['ACTIVE', 'FINALIZED', 'CANCELLED'],
            default: "'ACTIVE'",
          },
          {
            name: 'winners',
            type: 'jsonb',
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

    await queryRunner.createIndex(
      'contests',
      new TableIndex({
        name: 'IDX_CONTESTS_STATUS_TIME',
        columnNames: ['status', 'start_time', 'end_time'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('contests', 'IDX_CONTESTS_STATUS_TIME');
    await queryRunner.dropTable('contests');
  }
}
