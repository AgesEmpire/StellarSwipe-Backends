import { MigrationInterface, QueryRunner, TableColumn, TableIndex, TableUnique } from 'typeorm';

export class AddReferralCodeToUsers1751000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'referral_code',
        type: 'varchar',
        length: '8',
        isNullable: true,
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'users',
      new TableIndex({ name: 'idx_users_referral_code', columnNames: ['referral_code'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('users', 'idx_users_referral_code');
    await queryRunner.dropColumn('users', 'referral_code');
  }
}
