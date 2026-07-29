import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateSupportTeamsTable1705000000273 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'support_teams',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'name', type: 'varchar', length: '100' },
          { name: 'region', type: 'varchar', length: '10' },
          { name: 'languages', type: 'text' },
          { name: 'timezone', type: 'varchar', length: '50' },
          { name: 'skills', type: 'text', isNullable: true },
          { name: 'max_capacity', type: 'integer', default: 20 },
          { name: 'current_load', type: 'integer', default: 0 },
          { name: 'is_active', type: 'boolean', default: true },
          { name: 'working_hours', type: 'jsonb', default: "'{}'" },
          { name: 'metadata', type: 'jsonb', default: "'{}'" },
          { name: 'created_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('support_teams', new TableIndex({ name: 'IDX_support_teams_region', columnNames: ['region'] }));
    await queryRunner.createIndex('support_teams', new TableIndex({ name: 'IDX_support_teams_is_active', columnNames: ['is_active'] }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('support_teams', true);
  }
}
