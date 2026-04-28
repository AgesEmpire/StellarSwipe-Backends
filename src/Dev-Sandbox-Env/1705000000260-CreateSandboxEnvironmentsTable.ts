import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSandboxEnvironmentsTable1705000000260
  implements MigrationInterface
{
  name = 'CreateSandboxEnvironmentsTable1705000000260';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Enums ────────────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TYPE "public"."sandbox_status_enum" AS ENUM(
        'initializing',
        'active',
        'resetting',
        'suspended',
        'destroyed'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."sandbox_tier_enum" AS ENUM(
        'basic',
        'standard',
        'full'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."snapshot_type_enum" AS ENUM(
        'manual',
        'pre_reset',
        'scheduled',
        'seeded'
      )
    `);

    // ─── sandbox_environments ─────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "sandbox_environments" (
        "id"                UUID              NOT NULL DEFAULT gen_random_uuid(),
        "name"              VARCHAR(100)      NOT NULL,
        "owner_id"          VARCHAR(36)       NOT NULL,
        "status"            "public"."sandbox_status_enum"
                                              NOT NULL DEFAULT 'initializing',
        "tier"              "public"."sandbox_tier_enum"
                                              NOT NULL DEFAULT 'standard',
        "description"       VARCHAR(100),
        "stellar_public_key" VARCHAR(56),
        "stellar_secret_key" TEXT,
        "schema_prefix"     VARCHAR(30)       NOT NULL,
        "active_snapshot_id" UUID,
        "feature_flags"     JSONB             NOT NULL DEFAULT '{}',
        "mock_config"       JSONB             NOT NULL DEFAULT '{}',
        "reset_count"       INTEGER           NOT NULL DEFAULT 0,
        "last_reset_at"     TIMESTAMP,
        "ttl_seconds"       INTEGER,
        "expires_at"        TIMESTAMP,
        "metadata"          JSONB             NOT NULL DEFAULT '{}',
        "created_at"        TIMESTAMP         NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMP         NOT NULL DEFAULT now(),

        CONSTRAINT "PK_sandbox_environments" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_sandbox_environments_name"
        ON "sandbox_environments" ("name")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_sandbox_environments_schema_prefix"
        ON "sandbox_environments" ("schema_prefix")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_sandbox_environments_owner_status"
        ON "sandbox_environments" ("owner_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_sandbox_environments_owner_id"
        ON "sandbox_environments" ("owner_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_sandbox_environments_expires_at"
        ON "sandbox_environments" ("expires_at")
        WHERE "expires_at" IS NOT NULL
    `);

    // ─── test_data_snapshots ──────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "test_data_snapshots" (
        "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
        "environment_id"      UUID        NOT NULL,
        "label"               VARCHAR(100) NOT NULL,
        "type"                "public"."snapshot_type_enum"
                                          NOT NULL DEFAULT 'manual',
        "tables"              JSONB       NOT NULL DEFAULT '[]',
        "stellar_state"       JSONB,
        "dump_reference"      TEXT,
        "diff_from_previous"  JSONB,
        "total_rows"          INTEGER     NOT NULL DEFAULT 0,
        "is_restorable"       BOOLEAN     NOT NULL DEFAULT true,
        "created_by_user_id"  VARCHAR(36),
        "metadata"            JSONB       NOT NULL DEFAULT '{}',
        "created_at"          TIMESTAMP   NOT NULL DEFAULT now(),

        CONSTRAINT "PK_test_data_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "FK_snapshots_environment"
          FOREIGN KEY ("environment_id")
          REFERENCES "sandbox_environments" ("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_snapshots_environment_created"
        ON "test_data_snapshots" ("environment_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_snapshots_environment_type"
        ON "test_data_snapshots" ("environment_id", "type")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_snapshots_environment_id"
        ON "test_data_snapshots" ("environment_id")
    `);

    // ─── Trigger: auto-update updated_at on sandbox_environments ─────────────

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_sandbox_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER "trg_sandbox_environments_updated_at"
      BEFORE UPDATE ON "sandbox_environments"
      FOR EACH ROW EXECUTE FUNCTION update_sandbox_updated_at()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_sandbox_environments_updated_at" ON "sandbox_environments"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS update_sandbox_updated_at()`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_snapshots_environment_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_snapshots_environment_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_snapshots_environment_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "test_data_snapshots"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sandbox_environments_expires_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sandbox_environments_owner_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sandbox_environments_owner_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_sandbox_environments_schema_prefix"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_sandbox_environments_name"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sandbox_environments"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "public"."snapshot_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."sandbox_tier_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."sandbox_status_enum"`);
  }
}
