import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the two_factor_auth table backing TOTP enrollment, verification,
 * and bcrypt-hashed recovery (backup) codes.
 */
export class CreateTwoFactorAuthTable20260825000000 implements MigrationInterface {
  name = 'CreateTwoFactorAuthTable20260825000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "two_factor_auth" (
        "id"                    uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "userId"                uuid          NOT NULL,
        "secret"                text          NOT NULL DEFAULT '',
        "backupCodes"           text[]        NOT NULL DEFAULT '{}',
        "enabled"               boolean       NOT NULL DEFAULT false,
        "enabledAt"             TIMESTAMP,
        "lastSecurityChangeAt"  TIMESTAMP,
        "recoveryCodesGeneratedAt" TIMESTAMP,
        "recoveryCodesUsedCount"   integer      NOT NULL DEFAULT 0,
        "createdAt"             TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"             TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_two_factor_auth" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_two_factor_auth_user_id"
        ON "two_factor_auth" ("userId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_two_factor_auth_user_id"
        ON "two_factor_auth" ("userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_two_factor_auth_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_two_factor_auth_user_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "two_factor_auth"`);
  }
}
