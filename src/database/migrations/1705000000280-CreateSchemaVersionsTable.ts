import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateSchemaVersionsTable1705000000280
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'schema_versions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'entity_name',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'version',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'is_compatible',
            type: 'boolean',
            default: true,
          },
          {
            name: 'migration_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'applied_at',
            type: 'timestamp with time zone',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        uniques: [
          {
            name: 'UQ_schema_versions_entity_version',
            columnNames: ['entity_name', 'version'],
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'schema_versions',
      new TableIndex({
        name: 'IDX_schema_versions_entity_name',
        columnNames: ['entity_name'],
      }),
    );

    await queryRunner.createIndex(
      'schema_versions',
      new TableIndex({
        name: 'IDX_schema_versions_entity_version',
        columnNames: ['entity_name', 'version'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('schema_versions', true);
  }
}
