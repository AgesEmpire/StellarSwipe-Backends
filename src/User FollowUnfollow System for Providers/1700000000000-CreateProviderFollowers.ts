import { MigrationInterface, QueryRunner, Table, TableIndex, TableUnique } from 'typeorm';

export class CreateProviderFollowers1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add follower_count to providers if not present
    await queryRunner.query(`
      ALTER TABLE providers
      ADD COLUMN IF NOT EXISTS follower_count INTEGER NOT NULL DEFAULT 0
    `);

    await queryRunner.createTable(
      new Table({
        name: 'provider_followers',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'provider_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'followed_at',
            type: 'timestamp with time zone',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    // Unique constraint to prevent duplicate follows
    await queryRunner.createUniqueConstraint(
      'provider_followers',
      new TableUnique({
        name: 'UQ_provider_followers_user_provider',
        columnNames: ['user_id', 'provider_id'],
      }),
    );

    // Indexes for fast lookups
    await queryRunner.createIndex(
      'provider_followers',
      new TableIndex({
        name: 'IDX_provider_followers_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'provider_followers',
      new TableIndex({
        name: 'IDX_provider_followers_provider_id',
        columnNames: ['provider_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('provider_followers');
    await queryRunner.query(
      `ALTER TABLE providers DROP COLUMN IF EXISTS follower_count`,
    );
  }
}
