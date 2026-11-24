import { MigrationInterface, QueryRunner } from 'typeorm';

/** Creates the tenant-scoped legal_holds table that retention jobs consult before deleting. */
export class CreateLegalHoldsTable20261122000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "legal_holds" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" varchar(36) NOT NULL,
        "policy_name" varchar(100) NOT NULL,
        "record_id" varchar(64),
        "reason" text NOT NULL,
        "created_by" varchar(36) NOT NULL,
        "expires_at" timestamp,
        "released_at" timestamp,
        "released_by" varchar(36),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_legal_holds_tenant_id_policy_name" ON "legal_holds" ("tenant_id", "policy_name")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "legal_holds"`);
  }
}
