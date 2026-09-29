import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookEndpointVerification20260928100000 implements MigrationInterface {
  name = 'AddWebhookEndpointVerification20260928100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('webhooks'))) return;

    await queryRunner.query(`
      ALTER TABLE "webhooks"
      ADD COLUMN IF NOT EXISTS "pendingUrl" varchar(2048),
      ADD COLUMN IF NOT EXISTS "verificationTokenHash" varchar(64),
      ADD COLUMN IF NOT EXISTS "verificationTokenExpiresAt" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "urlVerifiedAt" TIMESTAMP
    `);
    // Endpoints registered before verification existed stay usable.
    await queryRunner.query(`
      UPDATE "webhooks" SET "urlVerifiedAt" = "createdAt"
      WHERE "urlVerifiedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "webhooks"
      DROP COLUMN IF EXISTS "urlVerifiedAt",
      DROP COLUMN IF EXISTS "verificationTokenExpiresAt",
      DROP COLUMN IF EXISTS "verificationTokenHash",
      DROP COLUMN IF EXISTS "pendingUrl"
    `);
  }
}
