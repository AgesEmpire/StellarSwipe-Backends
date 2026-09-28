import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateUserConsentsTable1751300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "user_consents_category_enum" AS ENUM ('marketing_email', 'marketing_push')
    `);

    await queryRunner.createTable(
      new Table({
        name: 'user_consents',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'gen_random_uuid()' },
          { name: 'user_id', type: 'uuid', isNullable: false },
          { name: 'category', type: 'user_consents_category_enum', isNullable: false },
          { name: 'opted_in', type: 'boolean', default: false },
          { name: 'updated_at', type: 'timestamp with time zone', isNullable: false },
          { name: 'created_at', type: 'timestamp with time zone', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'user_consents',
      new TableIndex({
        name: 'idx_user_consent_user_category',
        columnNames: ['user_id', 'category'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('user_consents', 'idx_user_consent_user_category');
    await queryRunner.dropTable('user_consents');
    await queryRunner.query(`DROP TYPE IF EXISTS "user_consents_category_enum"`);
  }
}
