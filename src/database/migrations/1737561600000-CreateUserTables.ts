import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserTables1737561600000 implements MigrationInterface {
  name = 'CreateUserTables1737561600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create risk_level enum
    await queryRunner.query(`
      CREATE TYPE "public"."risk_level_enum" AS ENUM('LOW', 'MEDIUM', 'HIGH')
    `);

    // Create users table
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "username" character varying NOT NULL,
        "walletAddress" character varying(56) NOT NULL,
        "email" character varying,
        "displayName" character varying(100),
        "bio" character varying,
        "isActive" boolean NOT NULL DEFAULT true,
        "reputationScore" integer NOT NULL DEFAULT 0,
        "lastLoginAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "UQ_users_username" UNIQUE ("username"),
    `);

    // Create index on wallet address
    await queryRunner.query(`
      CREATE INDEX "idx_users_wallet_address" ON "users" ("walletAddress")
    `);

    // Create user_preferences table
    await queryRunner.query(`
      CREATE TABLE "user_preferences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "emailNotifications" boolean NOT NULL DEFAULT true,
        "pushNotifications" boolean NOT NULL DEFAULT true,
        "tradeNotifications" boolean NOT NULL DEFAULT true,
        "riskLevel" "public"."risk_level_enum" NOT NULL DEFAULT 'MEDIUM',
        "language" character varying(10) NOT NULL DEFAULT 'en',
        "preferredCurrency" character varying(10) NOT NULL DEFAULT 'USD',
        "defaultSlippagePercent" numeric(5,2) NOT NULL DEFAULT 1.0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_preferences" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_preferences_user" FOREIGN KEY ("userId") 
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    // Create sessions table
    await queryRunner.query(`
      CREATE TABLE "sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "token" character varying NOT NULL,
        "deviceInfo" character varying,
        "ipAddress" character varying,
        "isActive" boolean NOT NULL DEFAULT true,
        "expiresAt" TIMESTAMP NOT NULL,
        "lastActivityAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_sessions_token" UNIQUE ("token"),
        CONSTRAINT "PK_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sessions_user" FOREIGN KEY ("userId") 
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    // Create indexes on sessions
    await queryRunner.query(`
      CREATE INDEX "idx_sessions_user_id" ON "sessions" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_sessions_token" ON "sessions" ("token")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX "public"."idx_sessions_token"`);
    await queryRunner.query(`DROP INDEX "public"."idx_sessions_user_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_users_wallet_address"`);

    // Drop tables
    await queryRunner.query(`DROP TABLE "sessions"`);
    await queryRunner.query(`DROP TABLE "user_preferences"`);
    await queryRunner.query(`DROP TABLE "users"`);

    // Drop enum
    await queryRunner.query(`DROP TYPE "public"."risk_level_enum"`);
  }
}
