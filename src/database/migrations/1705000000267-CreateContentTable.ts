import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateContentTable1705000000267 implements MigrationInterface {
  name = 'CreateContentTable1705000000267';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "cms_contents_type_enum" AS ENUM('help_doc','tutorial','notification','legal','marketing')`);
    await queryRunner.query(`CREATE TYPE "cms_contents_status_enum" AS ENUM('draft','published','archived')`);

    await queryRunner.createTable(
      new Table({
        name: 'cms_contents',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'slug', type: 'varchar', length: '255', isUnique: true },
          { name: 'title', type: 'varchar', length: '255' },
          { name: 'body', type: 'text' },
          { name: 'type', type: 'enum', enumName: 'cms_contents_type_enum' },
          { name: 'status', type: 'enum', enumName: 'cms_contents_status_enum', default: "'draft'" },
          { name: 'default_locale', type: 'varchar', length: '10', default: "'en'" },
          { name: 'author_id', type: 'uuid' },
          { name: 'published_at', type: 'timestamp', isNullable: true },
          { name: 'metadata', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'cms_content_versions',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'content_id', type: 'uuid' },
          { name: 'version', type: 'int' },
          { name: 'title', type: 'varchar', length: '255' },
          { name: 'body', type: 'text' },
          { name: 'changed_by', type: 'uuid' },
          { name: 'change_notes', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [{ columnNames: ['content_id'], referencedTableName: 'cms_contents', referencedColumnNames: ['id'], onDelete: 'CASCADE' }],
      }),
      true,
    );

    await queryRunner.createIndex('cms_contents', new TableIndex({ name: 'IDX_cms_type_status', columnNames: ['type', 'status'] }));
    await queryRunner.createIndex('cms_content_versions', new TableIndex({ name: 'IDX_cms_cv_content_version', columnNames: ['content_id', 'version'] }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('cms_content_versions');
    await queryRunner.dropTable('cms_contents');
    await queryRunner.query(`DROP TYPE IF EXISTS "cms_contents_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "cms_contents_type_enum"`);
  }
}
