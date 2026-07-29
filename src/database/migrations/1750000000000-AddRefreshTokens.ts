import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * #643 — Adds the refresh_tokens table for rotation-based auth (#644).
 * Up/down are both fully reversible.
 */
export class AddRefreshTokens1750000000000 implements MigrationInterface {
  name = 'AddRefreshTokens1750000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refresh_tokens" (
        "id"          uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "token_hash"  varchar     NOT NULL,
        "user_id"     uuid        NOT NULL,
        "session_id"  varchar     NOT NULL,
        "revoked"     boolean     NOT NULL DEFAULT false,
        "expires_at"  TIMESTAMP   NOT NULL,
        "created_at"  TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_refresh_tokens_hash" UNIQUE ("token_hash")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_user_id"
        ON "refresh_tokens" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_refresh_tokens_user_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
  }
}
