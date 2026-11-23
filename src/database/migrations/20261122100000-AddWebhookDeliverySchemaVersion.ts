import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookDeliverySchemaVersion20261122100000 implements MigrationInterface {
  name = 'AddWebhookDeliverySchemaVersion20261122100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('webhook_deliveries'))) return;

    // Existing deliveries were all sent with payload schema v1.
    await queryRunner.query(`
      ALTER TABLE "webhook_deliveries"
      ADD COLUMN IF NOT EXISTS "schemaVersion" integer NOT NULL DEFAULT 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "webhook_deliveries"
      DROP COLUMN IF EXISTS "schemaVersion"
    `);
  }
}
