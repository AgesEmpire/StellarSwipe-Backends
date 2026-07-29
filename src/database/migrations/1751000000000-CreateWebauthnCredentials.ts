import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * #684 — Adds the webauthn_credentials table backing passkey
 * registration/login as an alternative to wallet-signature auth.
 */
export class CreateWebauthnCredentials1751000000000 implements MigrationInterface {
  name = 'CreateWebauthnCredentials1751000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
        "id"            uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "userId"        uuid          NOT NULL,
        "credentialId"  varchar(512)  NOT NULL,
        "publicKey"     text          NOT NULL,
        "counter"       bigint        NOT NULL DEFAULT 0,
        "transports"    text,
        "deviceName"    varchar(100),
        "lastUsedAt"    TIMESTAMP,
        "createdAt"     TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"     TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webauthn_credentials" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_webauthn_credentials_credential_id" UNIQUE ("credentialId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_webauthn_credentials_user_id"
        ON "webauthn_credentials" ("userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_webauthn_credentials_user_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "webauthn_credentials"`);
  }
}
