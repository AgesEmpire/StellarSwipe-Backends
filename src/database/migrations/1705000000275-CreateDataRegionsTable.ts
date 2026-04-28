import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateDataRegionsTable1705000000275 implements MigrationInterface {
  name = 'CreateDataRegionsTable1705000000275';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'data_regions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'code',
            type: 'varchar',
            length: '10',
            isNullable: false,
            isUnique: true,
          },
          {
            name: 'name',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'storage_endpoint',
            type: 'varchar',
            length: '500',
            isNullable: false,
          },
          {
            name: 'country_codes',
            type: 'simple-array',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            default: "'active'",
            isNullable: false,
          },
          {
            name: 'compliance_frameworks',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'residency_policies',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '200',
            isNullable: false,
          },
          {
            name: 'policy_type',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            default: "'active'",
            isNullable: false,
          },
          {
            name: 'region_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'data_localization_required',
            type: 'boolean',
            default: true,
            isNullable: false,
          },
          {
            name: 'cross_border_transfer_allowed',
            type: 'boolean',
            default: false,
            isNullable: false,
          },
          {
            name: 'allowed_transfer_destinations',
            type: 'simple-array',
            isNullable: true,
          },
          {
            name: 'retention_days',
            type: 'int',
            default: 730,
            isNullable: false,
          },
          {
            name: 'encryption_required',
            type: 'boolean',
            default: true,
            isNullable: false,
          },
          {
            name: 'additional_requirements',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
        foreignKeys: [
          {
            columnNames: ['region_id'],
            referencedTableName: 'data_regions',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'data_regions',
      new TableIndex({
        name: 'IDX_data_regions_code',
        columnNames: ['code'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'data_regions',
      new TableIndex({
        name: 'IDX_data_regions_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'residency_policies',
      new TableIndex({
        name: 'IDX_residency_policies_region_id',
        columnNames: ['region_id'],
      }),
    );

    await queryRunner.createIndex(
      'residency_policies',
      new TableIndex({
        name: 'IDX_residency_policies_policy_type',
        columnNames: ['policy_type'],
      }),
    );

    await queryRunner.createIndex(
      'residency_policies',
      new TableIndex({
        name: 'IDX_residency_policies_status',
        columnNames: ['status'],
      }),
    );

    // Seed default regions
    await queryRunner.query(`
      INSERT INTO data_regions (id, code, name, storage_endpoint, country_codes, status, compliance_frameworks)
      VALUES
        (uuid_generate_v4(), 'EU',   'European Union',  'https://eu-storage.stellarswipe.internal',   'AT,BE,BG,CY,CZ,DE,DK,EE,ES,FI,FR,GR,HR,HU,IE,IT,LT,LU,LV,MT,NL,PL,PT,RO,SE,SI,SK,IS,LI,NO,CH,GB', 'active', '["GDPR"]'),
        (uuid_generate_v4(), 'US',   'United States',   'https://us-storage.stellarswipe.internal',   'US,CA,MX,PR,GU,VI',                                                                                  'active', '["CCPA"]'),
        (uuid_generate_v4(), 'ASIA', 'Asia-Pacific',    'https://asia-storage.stellarswipe.internal', 'CN,JP,KR,SG,IN,TH,MY,PH,ID,VN,TW,HK,MO,AU,NZ',                                                     'active', '["CHINA_CSL","PDPA","APPI","PIPA"]')
      ON CONFLICT (code) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('residency_policies', true);
    await queryRunner.dropTable('data_regions', true);
  }
}
