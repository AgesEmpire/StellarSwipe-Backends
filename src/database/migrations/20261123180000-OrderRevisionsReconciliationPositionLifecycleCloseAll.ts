import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * - #1529: append-only conditional order revisions
 * - #1531: pending-order chain reconciliation evidence + review queue
 * - #1534: immutable position lifecycle events
 * - #1537: close-all confirmations (idempotent per preview)
 */
export class OrderRevisionsReconciliationPositionLifecycleCloseAll20261123180000 implements MigrationInterface {
  name = 'OrderRevisionsReconciliationPositionLifecycleCloseAll20261123180000';

  private static readonly APPEND_ONLY_TABLES = [
    'conditional_order_revisions',
    'order_reconciliation_evidence',
    'position_lifecycle_events',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // #1529
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conditional_order_revisions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "revision_number" int NOT NULL CHECK ("revision_number" > 0),
        "actor_id" varchar(128) NOT NULL,
        "actor_roles" jsonb NOT NULL DEFAULT '[]',
        "reason" text NOT NULL CHECK (length(btrim("reason")) >= 3),
        "changed_fields" jsonb NOT NULL,
        "requested_values" jsonb NOT NULL,
        "order_version_before" int NOT NULL,
        "order_version_after" int NOT NULL,
        "amended_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_conditional_order_revisions_order_revision"
        ON "conditional_order_revisions" ("order_id", "revision_number")`);

    // #1531
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_reconciliation_evidence" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "trade_id" uuid NOT NULL,
        "run_id" uuid NULL,
        "tx_hash" varchar(128) NOT NULL,
        "from_status" varchar(32) NOT NULL,
        "to_status" varchar(32) NOT NULL,
        "rule" varchar(64) NOT NULL,
        "policy_version" varchar(32) NOT NULL,
        "actor_id" varchar(128) NOT NULL,
        "note" text NULL,
        "observations" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_reconciliation_evidence_trade"
        ON "order_reconciliation_evidence" ("trade_id", "created_at")`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_reconciliation_reviews" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "trade_id" uuid NOT NULL,
        "tx_hash" varchar(128) NOT NULL,
        "reason" varchar(64) NOT NULL,
        "detail" text NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'open',
        "observations" jsonb NOT NULL,
        "first_run_id" uuid NULL,
        "last_run_id" uuid NULL,
        "occurrences" int NOT NULL DEFAULT 1,
        "resolution" varchar(16) NULL,
        "resolved_by" varchar(128) NULL,
        "resolution_note" text NULL,
        "resolved_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_reconciliation_reviews_open_trade"
        ON "order_reconciliation_reviews" ("trade_id") WHERE "status" = 'open'`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_reconciliation_reviews_status"
        ON "order_reconciliation_reviews" ("status", "created_at")`);

    // #1534
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "position_lifecycle_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "position_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "event_type" varchar(32) NOT NULL,
        "sequence" int NOT NULL CHECK ("sequence" > 0),
        "occurred_at" timestamptz NOT NULL,
        "recorded_at" timestamptz NOT NULL DEFAULT now(),
        "quantity_before" decimal(18,8) NULL,
        "quantity_after" decimal(18,8) NULL,
        "source" varchar(32) NOT NULL,
        "idempotency_key" varchar(200) NOT NULL,
        "inferred" boolean NOT NULL DEFAULT false,
        "metadata" jsonb NULL
      )`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_position_lifecycle_events_position_sequence"
        ON "position_lifecycle_events" ("position_id", "sequence")`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_position_lifecycle_events_idempotency"
        ON "position_lifecycle_events" ("idempotency_key")`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_position_lifecycle_events_user_occurred"
        ON "position_lifecycle_events" ("user_id", "occurred_at")`);

    // #1537
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "close_all_confirmations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "preview_id" uuid NOT NULL,
        "fingerprint" varchar(64) NOT NULL,
        "status" varchar(32) NOT NULL,
        "positions" jsonb NOT NULL,
        "results" jsonb NOT NULL DEFAULT '[]',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "completed_at" timestamptz NULL
      )`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_close_all_confirmations_preview"
        ON "close_all_confirmations" ("preview_id")`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_close_all_confirmations_user"
        ON "close_all_confirmations" ("user_id", "created_at")`);

    // Append-only enforcement for audit tables.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION append_only_audit_row() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
      END;
      $$ LANGUAGE plpgsql`);
    for (const table of OrderRevisionsReconciliationPositionLifecycleCloseAll20261123180000.APPEND_ONLY_TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_${table}_append_only" ON "${table}"`);
      await queryRunner.query(`
        CREATE TRIGGER "trg_${table}_append_only" BEFORE UPDATE OR DELETE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION append_only_audit_row()`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "close_all_confirmations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "position_lifecycle_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_reconciliation_reviews"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_reconciliation_evidence"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conditional_order_revisions"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS append_only_audit_row()`);
  }
}
