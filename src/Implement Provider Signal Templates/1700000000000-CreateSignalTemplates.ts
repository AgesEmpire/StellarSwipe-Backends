import { MigrationInterface, QueryRunner, Table, Index } from 'typeorm';

export class CreateSignalTemplates1700000000000 implements MigrationInterface {
  name = 'CreateSignalTemplates1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'signal_templates',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'providerId', type: 'uuid', isNullable: false },
          { name: 'name', type: 'varchar', length: '100' },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'structure', type: 'jsonb' },
          { name: 'variables', type: 'text' },          // TypeORM simple-array → comma-separated text
          { name: 'usageCount', type: 'int', default: 0 },
          { name: 'isPublic', type: 'boolean', default: false },
          { name: 'version', type: 'int', default: 1 },
          { name: 'previousVersionId', type: 'uuid', isNullable: true },
          { name: 'isActive', type: 'boolean', default: true },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'signal_templates',
      new Index({ name: 'IDX_signal_templates_providerId', columnNames: ['providerId'] }),
    );

    await queryRunner.createIndex(
      'signal_templates',
      new Index({ name: 'IDX_signal_templates_isPublic', columnNames: ['isPublic'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('signal_templates');
  }
}
