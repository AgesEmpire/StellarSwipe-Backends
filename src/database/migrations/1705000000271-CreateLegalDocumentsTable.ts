import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateLegalDocumentsTable1705000000271 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE document_type_enum AS ENUM ('terms_of_service', 'privacy_policy', 'disclaimer', 'cookie_policy', 'risk_disclosure')`);
    await queryRunner.query(`CREATE TYPE document_status_enum AS ENUM ('active', 'inactive', 'archived')`);

    await queryRunner.createTable(
      new Table({
        name: 'legal_documents',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'title', type: 'varchar', length: '200' },
          { name: 'type', type: 'enum', enumName: 'document_type_enum' },
          { name: 'region', type: 'varchar', length: '10' },
          { name: 'language', type: 'varchar', length: '10', default: "'en'" },
          { name: 'status', type: 'enum', enumName: 'document_status_enum', default: "'active'" },
          { name: 'current_version_id', type: 'uuid', isNullable: true },
          { name: 'metadata', type: 'jsonb', default: "'{}'" },
          { name: 'created_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
        ],
        uniques: [
          { name: 'UQ_legal_documents_type_region_language', columnNames: ['type', 'region', 'language'] },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'document_versions',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'document_id', type: 'uuid' },
          { name: 'version', type: 'varchar', length: '20' },
          { name: 'content', type: 'text' },
          { name: 'content_hash', type: 'varchar', length: '64' },
          { name: 'changelog', type: 'text', isNullable: true },
          { name: 'is_active', type: 'boolean', default: false },
          { name: 'requires_reacceptance', type: 'boolean', default: false },
          { name: 'published_at', type: 'timestamp with time zone', isNullable: true },
          { name: 'published_by', type: 'varchar', length: '36', isNullable: true },
          { name: 'created_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
        ],
        uniques: [
          { name: 'UQ_document_versions_document_id_version', columnNames: ['document_id', 'version'] },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'document_versions',
      new TableForeignKey({
        columnNames: ['document_id'],
        referencedTableName: 'legal_documents',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex('legal_documents', new TableIndex({ name: 'IDX_legal_documents_region', columnNames: ['region'] }));
    await queryRunner.createIndex('legal_documents', new TableIndex({ name: 'IDX_legal_documents_type', columnNames: ['type'] }));
    await queryRunner.createIndex('document_versions', new TableIndex({ name: 'IDX_document_versions_document_active', columnNames: ['document_id', 'is_active'] }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('document_versions', true);
    await queryRunner.dropTable('legal_documents', true);
    await queryRunner.query(`DROP TYPE IF EXISTS document_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS document_type_enum`);
  }
}
