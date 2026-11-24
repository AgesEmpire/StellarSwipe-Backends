import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookPauseAndStateAudits20261122100000 implements MigrationInterface {
  name = 'AddWebhookPauseAndStateAudits20261122100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('webhooks')) {
      await queryRunner.query(`
        ALTER TABLE "webhooks"
        ADD COLUMN IF NOT EXISTS "paused" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP
      `);
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webhook_state_audits" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "requestedBy" uuid NOT NULL,
        "webhookId" uuid NOT NULL,
        "action" varchar(20) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhook_state_audits_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_webhook_state_audits_requestedBy"
      ON "webhook_state_audits" ("requestedBy")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_webhook_state_audits_webhookId"
      ON "webhook_state_audits" ("webhookId")
    `);

    // Audit records are immutable: reject any UPDATE or DELETE.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION webhook_state_audits_immutable()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'webhook_state_audits records are immutable';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_webhook_state_audits_immutable"
      BEFORE UPDATE OR DELETE ON "webhook_state_audits"
      FOR EACH ROW EXECUTE FUNCTION webhook_state_audits_immutable()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_webhook_state_audits_immutable" ON "webhook_state_audits"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS webhook_state_audits_immutable()`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_state_audits"`);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "webhooks"
      DROP COLUMN IF EXISTS "pausedAt",
      DROP COLUMN IF EXISTS "paused"
    `);
  }
}
