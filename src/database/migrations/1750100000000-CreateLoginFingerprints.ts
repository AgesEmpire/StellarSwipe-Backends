import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * #683 — Adds the login_fingerprints table backing
 * SessionFingerprintService, which hashes IP + user-agent (+ optional
 * signals) at each successful login and compares against a user's
 * recent history to flag anomalous (new device/IP) sign-ins.
 *
 * Up/down are both fully reversible.
 */
export class CreateLoginFingerprints1750100000000
  implements MigrationInterface
{
  name = 'CreateLoginFingerprints1750100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "login_fingerprints" (
        "id"                uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"           uuid        NOT NULL,
        "fingerprint_hash"  varchar(64) NOT NULL,
        "ip_address"        varchar     NULL,
        "user_agent"        text        NULL,
        "accept_language"   varchar     NULL,
        "created_at"        TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_login_fingerprints" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_login_fingerprints_user_hash"
        ON "login_fingerprints" ("user_id", "fingerprint_hash")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_login_fingerprints_user_created"
        ON "login_fingerprints" ("user_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_login_fingerprints_user_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_login_fingerprints_user_hash"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "login_fingerprints"`);
  }
}
