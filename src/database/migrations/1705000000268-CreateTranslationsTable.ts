import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateTranslationsTable1705000000268 implements MigrationInterface {
  name = 'CreateTranslationsTable1705000000268';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "cms_translations_status_enum" AS ENUM('pending','in_review','approved','rejected')`);

    await queryRunner.createTable(
      new Table({
        name: 'cms_translations',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'content_id', type: 'uuid' },
          { name: 'locale', type: 'varchar', length: '10' },
          { name: 'title', type: 'varchar', length: '255' },
          { name: 'body', type: 'text' },
          { name: 'status', type: 'enum', enumName: 'cms_translations_status_enum', default: "'pending'" },
          { name: 'translator_id', type: 'uuid', isNullable: true },
          { name: 'reviewed_by', type: 'uuid', isNullable: true },
          { name: 'reviewed_at', type: 'timestamp', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        uniques: [{ columnNames: ['content_id', 'locale'] }],
        foreignKeys: [{ columnNames: ['content_id'], referencedTableName: 'cms_contents', referencedColumnNames: ['id'], onDelete: 'CASCADE' }],
      }),
      true,
    );

    await queryRunner.createIndex('cms_translations', new TableIndex({ name: 'IDX_cms_tr_locale_status', columnNames: ['locale', 'status'] }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('cms_translations');
    await queryRunner.query(`DROP TYPE IF EXISTS "cms_translations_status_enum"`);
  }
}
