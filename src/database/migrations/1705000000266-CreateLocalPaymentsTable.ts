import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateLocalPaymentsTable1705000000266 implements MigrationInterface {
  name = 'CreateLocalPaymentsTable1705000000266';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "local_payments_status_enum" AS ENUM('pending','processing','completed','failed','cancelled')`);

    await queryRunner.createTable(
      new Table({
        name: 'local_payments',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'user_id', type: 'uuid' },
          { name: 'provider', type: 'varchar', length: '50' },
          { name: 'amount', type: 'decimal', precision: 18, scale: 2 },
          { name: 'currency', type: 'varchar', length: '3' },
          { name: 'country', type: 'varchar', length: '2' },
          { name: 'status', type: 'enum', enumName: 'local_payments_status_enum', default: "'pending'" },
          { name: 'external_ref', type: 'varchar', length: '255' },
          { name: 'checkout_url', type: 'varchar', length: '500', isNullable: true },
          { name: 'phone_number', type: 'varchar', length: '20', isNullable: true },
          { name: 'metadata', type: 'jsonb', isNullable: true },
          { name: 'completed_at', type: 'timestamp', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'local_payment_configs',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'provider', type: 'varchar', length: '50' },
          { name: 'country', type: 'varchar', length: '2' },
          { name: 'is_enabled', type: 'boolean', default: true },
          { name: 'min_amount', type: 'decimal', precision: 18, scale: 2, default: 0 },
          { name: 'max_amount', type: 'decimal', precision: 18, scale: 2, isNullable: true },
          { name: 'settings', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        uniques: [{ columnNames: ['provider', 'country'] }],
      }),
      true,
    );

    await queryRunner.createIndex('local_payments', new TableIndex({ name: 'IDX_lp_user_provider', columnNames: ['user_id', 'provider'] }));
    await queryRunner.createIndex('local_payments', new TableIndex({ name: 'IDX_lp_status', columnNames: ['status'] }));
    await queryRunner.createIndex('local_payments', new TableIndex({ name: 'IDX_lp_external_ref', columnNames: ['external_ref'] }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('local_payment_configs');
    await queryRunner.dropTable('local_payments');
    await queryRunner.query(`DROP TYPE IF EXISTS "local_payments_status_enum"`);
  }
}
