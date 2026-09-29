import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWebhookReplayAuditsTable20260928110000 implements MigrationInterface {
  name = 'CreateWebhookReplayAuditsTable20260928110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webhook_replay_audits" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "requestedBy" uuid NOT NULL,
        "originalDeliveryId" uuid NOT NULL,
        "targetWebhookId" uuid NOT NULL,
        "replayDeliveryId" uuid,
        "outcome" varchar(20) NOT NULL,
        "reason" varchar(255),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhook_replay_audits_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_webhook_replay_audits_requestedBy"
      ON "webhook_replay_audits" ("requestedBy")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_webhook_replay_audits_targetWebhookId"
      ON "webhook_replay_audits" ("targetWebhookId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_webhook_replay_audits_original_target_created"
      ON "webhook_replay_audits" ("originalDeliveryId", "targetWebhookId", "createdAt")
    `);

    // Audit records are immutable: reject any UPDATE or DELETE.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION webhook_replay_audits_immutable()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'webhook_replay_audits records are immutable';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_webhook_replay_audits_immutable"
      BEFORE UPDATE OR DELETE ON "webhook_replay_audits"
      FOR EACH ROW EXECUTE FUNCTION webhook_replay_audits_immutable()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_webhook_replay_audits_immutable" ON "webhook_replay_audits"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS webhook_replay_audits_immutable()`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_replay_audits"`);
  }
}
