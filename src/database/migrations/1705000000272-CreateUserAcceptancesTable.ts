import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateUserAcceptancesTable1705000000272 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'user_acceptances',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'user_id', type: 'varchar', length: '36' },
          { name: 'document_id', type: 'uuid' },
          { name: 'version_id', type: 'uuid' },
          { name: 'ip_address', type: 'varchar', length: '50', isNullable: true },
          { name: 'user_agent', type: 'varchar', length: '500', isNullable: true },
          { name: 'region', type: 'varchar', length: '10', isNullable: true },
          { name: 'metadata', type: 'jsonb', default: "'{}'" },
          { name: 'accepted_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'user_acceptances',
      new TableForeignKey({
        columnNames: ['document_id'],
        referencedTableName: 'legal_documents',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'user_acceptances',
      new TableForeignKey({
        columnNames: ['version_id'],
        referencedTableName: 'document_versions',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex('user_acceptances', new TableIndex({ name: 'IDX_user_acceptances_user_document', columnNames: ['user_id', 'document_id'] }));
    await queryRunner.createIndex('user_acceptances', new TableIndex({ name: 'IDX_user_acceptances_user_version', columnNames: ['user_id', 'version_id'] }));
    await queryRunner.createIndex('user_acceptances', new TableIndex({ name: 'IDX_user_acceptances_document_version', columnNames: ['document_id', 'version_id'] }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('user_acceptances', true);
  }
}
