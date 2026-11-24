import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * - #1515: versioned, append-only signal source attribution
 * - #1516: signal categories + per-user muted category preferences
 * - #1518: explicit, append-only signal correction events
 */
export class SignalAttributionCategoryMutesCorrections20261123140000 implements MigrationInterface {
  name = 'SignalAttributionCategoryMutesCorrections20261123140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Shared guard that makes audit tables append-only.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "prevent_append_only_mutation"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
      END;
      $$ LANGUAGE plpgsql`);

    // #1515
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "signal_source_attributions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "signal_id" uuid NOT NULL,
        "signal_version" int NOT NULL CHECK ("signal_version" > 0),
        "source_id" varchar(128) NOT NULL,
        "source_type" varchar(64) NOT NULL,
        "public_label" varchar(128),
        "is_public" boolean NOT NULL DEFAULT false,
        "contribution_weight" decimal(7,6) NOT NULL CHECK ("contribution_weight" > 0 AND "contribution_weight" <= 1),
        "contribution_metadata" jsonb,
        "recorded_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_signal_source_attribution_version_source" UNIQUE ("signal_id", "signal_version", "source_id")
      )`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_signal_source_attribution_signal_version"
        ON "signal_source_attributions" ("signal_id", "signal_version")`);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_signal_source_attributions_append_only" ON "signal_source_attributions"`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_signal_source_attributions_append_only"
        BEFORE UPDATE ON "signal_source_attributions"
        FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"()`);

    // #1516
    await queryRunner.query(`ALTER TABLE "signals" ADD COLUMN IF NOT EXISTS "category" varchar(32)`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_signals_category" ON "signals" ("category")`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_signal_category_preferences" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "muted_categories" text[] NOT NULL DEFAULT '{}',
        "version" int NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_user_signal_category_preferences_user" UNIQUE ("user_id")
      )`);

    // #1518
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "signal_correction_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_type" varchar(32) NOT NULL DEFAULT 'signal.corrected',
        "signal_id" uuid NOT NULL,
        "provider_id" uuid NOT NULL,
        "sequence" int NOT NULL,
        "previous_version_id" uuid NOT NULL REFERENCES "signal_versions"("id") ON DELETE RESTRICT,
        "previous_version_number" int NOT NULL,
        "replacement_version_id" uuid NOT NULL REFERENCES "signal_versions"("id") ON DELETE RESTRICT,
        "replacement_version_number" int NOT NULL,
        "reason" text NOT NULL,
        "changes" jsonb NOT NULL,
        "idempotency_key" varchar(128),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_signal_correction_sequence" UNIQUE ("signal_id", "sequence"),
        CONSTRAINT "uq_signal_correction_idempotency" UNIQUE ("signal_id", "idempotency_key"),
        CONSTRAINT "chk_signal_correction_version_order"
          CHECK ("replacement_version_number" > "previous_version_number")
      )`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_signal_correction_signal_sequence"
        ON "signal_correction_events" ("signal_id", "sequence")`);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_signal_correction_events_append_only" ON "signal_correction_events"`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_signal_correction_events_append_only"
        BEFORE UPDATE ON "signal_correction_events"
        FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "signal_correction_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_signal_category_preferences"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_signals_category"`);
    await queryRunner.query(`ALTER TABLE "signals" DROP COLUMN IF EXISTS "category"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "signal_source_attributions"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "prevent_append_only_mutation"()`);
  }
}
