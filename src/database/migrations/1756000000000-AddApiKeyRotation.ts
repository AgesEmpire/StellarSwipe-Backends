import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddApiKeyRotation1756000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of ['previousKeyHash', 'overlapUntil', 'revokedAt']) {
      await queryRunner.addColumn(
        'api_keys',
        new TableColumn({
          name,
          type: name === 'previousKeyHash' ? 'varchar' : 'timestamp',
          length: name === 'previousKeyHash' ? '60' : undefined,
          isNullable: true,
        }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of ['revokedAt', 'overlapUntil', 'previousKeyHash'])
      await queryRunner.dropColumn('api_keys', name);
  }
}
