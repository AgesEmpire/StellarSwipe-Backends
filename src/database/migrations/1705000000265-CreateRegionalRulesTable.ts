import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateRegionalRulesTable1705000000265 implements MigrationInterface {
  name = 'CreateRegionalRulesTable1705000000265';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "regional_compliance_rules_region_enum" AS ENUM('EU','US','NG','GLOBAL')`);
    await queryRunner.query(`CREATE TYPE "regional_compliance_rules_category_enum" AS ENUM('data_privacy','kyc','reporting','trading','aml')`);
    await queryRunner.query(`CREATE TYPE "regional_compliance_rules_severity_enum" AS ENUM('low','medium','high','critical')`);

    await queryRunner.createTable(
      new Table({
        name: 'regional_compliance_rules',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'rule_code', type: 'varchar', length: '50' },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'description', type: 'text' },
          { name: 'region', type: 'enum', enumName: 'regional_compliance_rules_region_enum' },
          { name: 'category', type: 'enum', enumName: 'regional_compliance_rules_category_enum' },
          { name: 'severity', type: 'enum', enumName: 'regional_compliance_rules_severity_enum', default: "'medium'" },
          { name: 'is_active', type: 'boolean', default: true },
          { name: 'metadata', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'compliance_checks',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'user_id', type: 'uuid' },
          { name: 'region', type: 'enum', enumName: 'regional_compliance_rules_region_enum' },
          { name: 'action', type: 'varchar', length: '100' },
          { name: 'passed', type: 'boolean', default: false },
          { name: 'checked_rules', type: 'jsonb', default: "'[]'" },
          { name: 'violations', type: 'jsonb', default: "'[]'" },
          { name: 'ip_address', type: 'varchar', length: '45', isNullable: true },
          { name: 'payload', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('regional_compliance_rules', new TableIndex({ name: 'IDX_rcr_region_active', columnNames: ['region', 'is_active'] }));
    await queryRunner.createIndex('compliance_checks', new TableIndex({ name: 'IDX_cc_user_region', columnNames: ['user_id', 'region'] }));
    await queryRunner.createIndex('compliance_checks', new TableIndex({ name: 'IDX_cc_created_at', columnNames: ['created_at'] }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('compliance_checks');
    await queryRunner.dropTable('regional_compliance_rules');
    await queryRunner.query(`DROP TYPE IF EXISTS "regional_compliance_rules_severity_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "regional_compliance_rules_category_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "regional_compliance_rules_region_enum"`);
  }
}
