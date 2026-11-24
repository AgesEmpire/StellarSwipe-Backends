import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * - #1520: append-only copy policy versions + per-trade policy snapshots
 * - #1524: contest trade-event ledger, result corrections, finalization fields
 * - #1527: stable failure code on trades
 */
export class CopyPolicyVersionsContestIntegrityTradeFailureCodes20261123120000
  implements MigrationInterface
{
  name = 'CopyPolicyVersionsContestIntegrityTradeFailureCodes20261123120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // #1520
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "copy_policy_versions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "follower_id" uuid NOT NULL,
        "provider_id" uuid NOT NULL,
        "version" int NOT NULL,
        "settings" jsonb NOT NULL,
        "settings_hash" varchar(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_copy_policy_versions_follower_provider_version"
        ON "copy_policy_versions" ("follower_id", "provider_id", "version")`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "copy_trade_executions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "trade_id" uuid NOT NULL,
        "follower_id" uuid NOT NULL,
        "provider_id" uuid NOT NULL,
        "policy_version_id" uuid NOT NULL REFERENCES "copy_policy_versions"("id") ON DELETE RESTRICT,
        "policy_version" int NOT NULL,
        "resolved_settings" jsonb NOT NULL,
        "executed_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_copy_trade_executions_trade"
        ON "copy_trade_executions" ("trade_id")`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_copy_trade_executions_follower_provider"
        ON "copy_trade_executions" ("follower_id", "provider_id")`);
    // Enforce immutability at the database level.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION copy_policy_immutable() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
      END;
      $$ LANGUAGE plpgsql`);
    for (const table of ['copy_policy_versions', 'copy_trade_executions']) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_${table}_immutable" ON "${table}"`);
      await queryRunner.query(`
        CREATE TRIGGER "trg_${table}_immutable" BEFORE UPDATE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION copy_policy_immutable()`);
    }
    await queryRunner.query(
      `ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "copy_policy_version_id" uuid NULL`,
    );

    // #1527
    await queryRunner.query(
      `ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "failure_code" varchar(64) NULL`,
    );

    // #1524
    await queryRunner.query(`
      ALTER TABLE "contests"
        ADD COLUMN IF NOT EXISTS "finalized_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "published_scores" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "result_revision" int NOT NULL DEFAULT 0`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contest_trade_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "contest_id" uuid NOT NULL,
        "event_id" varchar(128) NOT NULL,
        "provider_id" uuid NOT NULL,
        "event_time" timestamptz NOT NULL,
        "ingested_at" timestamptz NOT NULL,
        "score_delta" double precision NOT NULL,
        "disposition" varchar(32) NOT NULL,
        "correction_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_contest_trade_events_contest_event"
        ON "contest_trade_events" ("contest_id", "event_id")`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_contest_trade_events_contest_disposition"
        ON "contest_trade_events" ("contest_id", "disposition")`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contest_result_corrections" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "contest_id" uuid NOT NULL,
        "actor_id" varchar(128) NOT NULL,
        "reason" text NOT NULL,
        "event_ids" jsonb NOT NULL,
        "from_revision" int NOT NULL,
        "to_revision" int NOT NULL,
        "previous_scores" jsonb NOT NULL,
        "new_scores" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_contest_result_corrections_revision"
        ON "contest_result_corrections" ("contest_id", "to_revision")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "contest_result_corrections"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "contest_trade_events"`);
    await queryRunner.query(`
      ALTER TABLE "contests"
        DROP COLUMN IF EXISTS "result_revision",
        DROP COLUMN IF EXISTS "published_scores",
        DROP COLUMN IF EXISTS "finalized_at"`);
    await queryRunner.query(`ALTER TABLE "trades" DROP COLUMN IF EXISTS "failure_code"`);
    await queryRunner.query(`ALTER TABLE "trades" DROP COLUMN IF EXISTS "copy_policy_version_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "copy_trade_executions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "copy_policy_versions"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS copy_policy_immutable()`);
  }
}
