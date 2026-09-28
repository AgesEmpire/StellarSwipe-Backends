import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddEntrypointMetadataToFeatureFlags1752700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'feature_flags',
      new TableColumn({
        name: 'contractId',
        type: 'varchar',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'feature_flags',
      new TableColumn({
        name: 'method',
        type: 'varchar',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'feature_flags',
      new TableColumn({
        name: 'retired',
        type: 'boolean',
        default: false,
      }),
    );

    await queryRunner.createIndex(
      'feature_flags',
      new TableIndex({
        name: 'idx_feature_flag_contract_method',
        columnNames: ['contractId', 'method'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('feature_flags', 'idx_feature_flag_contract_method');
    await queryRunner.dropColumn('feature_flags', 'retired');
    await queryRunner.dropColumn('feature_flags', 'method');
    await queryRunner.dropColumn('feature_flags', 'contractId');
  }
}
