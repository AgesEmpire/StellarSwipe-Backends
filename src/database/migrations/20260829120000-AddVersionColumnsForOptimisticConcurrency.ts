import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVersionColumnsForOptimisticConcurrency20260829120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conditional_orders"
      ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1
    `);
    await queryRunner.query(`
      ALTER TABLE "user_settings"
      ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1
    `);
    await queryRunner.query(`
      ALTER TABLE "revenue_share_tiers"
      ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conditional_orders" DROP COLUMN IF EXISTS "version"
    `);
    await queryRunner.query(`
      ALTER TABLE "user_settings" DROP COLUMN IF EXISTS "version"
    `);
    await queryRunner.query(`
      ALTER TABLE "revenue_share_tiers" DROP COLUMN IF EXISTS "version"
    `);
  }
}
