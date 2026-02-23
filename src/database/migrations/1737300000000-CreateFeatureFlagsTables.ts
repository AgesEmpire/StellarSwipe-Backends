import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateFeatureFlagsTables1737300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create feature_flags table
    await queryRunner.createTable(
      new Table({
        name: 'feature_flags',
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
            isUnique: true,
            isNullable: false,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'type',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          {
            name: 'enabled',
            type: 'boolean',
            default: false,
          },
          {
            name: 'config',
            type: 'jsonb',
            default: "'{}'",
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Create index on name
    await queryRunner.createIndex(
      'feature_flags',
      new TableIndex({
        name: 'idx_feature_flag_name',
        columnNames: ['name'],
      }),
    );

    // Create flag_assignments table
    await queryRunner.createTable(
      new Table({
        name: 'flag_assignments',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'flag_name',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'enabled',
            type: 'boolean',
            default: false,
          },
          {
            name: 'variant',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Create indexes on flag_assignments
    await queryRunner.createIndex(
      'flag_assignments',
      new TableIndex({
        name: 'idx_flag_assignment_user',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'flag_assignments',
      new TableIndex({
        name: 'idx_flag_assignment_flag',
        columnNames: ['flag_name'],
      }),
    );

    await queryRunner.createIndex(
      'flag_assignments',
      new TableIndex({
        name: 'idx_flag_assignment_user_flag',
        columnNames: ['user_id', 'flag_name'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('flag_assignments');
    await queryRunner.dropTable('feature_flags');
  }
}
