import { MigrationInterface, QueryRunner, Table, TableIndex, TableUnique } from 'typeorm';

export class CreateUserProviderMutesTable1751000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'user_provider_mutes',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'user_id', type: 'uuid', isNullable: false },
          { name: 'provider_id', type: 'uuid', isNullable: false },
          { name: 'muted_at', type: 'timestamp', default: 'NOW()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'user_provider_mutes',
      new TableIndex({ name: 'idx_upm_user_id', columnNames: ['user_id'] }),
    );

    await queryRunner.createUniqueConstraint(
      'user_provider_mutes',
      new TableUnique({ name: 'uq_user_provider_mute', columnNames: ['user_id', 'provider_id'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('user_provider_mutes', true);
  }
}
