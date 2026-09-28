import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateRegionalFlagConfigsTable1705000000269 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE regional_flag_status_enum AS ENUM ('active', 'inactive', 'scheduled')`);

    await queryRunner.createTable(
      new Table({
        name: 'regional_flag_configs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'flag_name', type: 'varchar', length: '100' },
          { name: 'region', type: 'varchar', length: '10' },
          { name: 'enabled', type: 'boolean', default: false },
          {
            name: 'status',
            type: 'enum',
            enumName: 'regional_flag_status_enum',
            default: "'active'",
          },
          { name: 'overrides', type: 'jsonb', default: "'{}'" },
          { name: 'enabled_at', type: 'timestamp with time zone', isNullable: true },
          { name: 'disabled_at', type: 'timestamp with time zone', isNullable: true },
          { name: 'reason', type: 'varchar', length: '255', isNullable: true },
          { name: 'updated_by', type: 'varchar', length: '36', isNullable: true },
          { name: 'created_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
        ],
        uniques: [
          { name: 'UQ_regional_flag_configs_flag_region', columnNames: ['flag_name', 'region'] },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'regional_flag_configs',
      new TableIndex({ name: 'IDX_regional_flag_configs_region', columnNames: ['region'] }),
    );

    await queryRunner.createIndex(
      'regional_flag_configs',
      new TableIndex({ name: 'IDX_regional_flag_configs_flag_name', columnNames: ['flag_name'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('regional_flag_configs', true);
    await queryRunner.query(`DROP TYPE IF EXISTS regional_flag_status_enum`);
  }
}
