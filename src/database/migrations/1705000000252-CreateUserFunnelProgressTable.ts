import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserFunnelProgressTable1705000000252 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_funnel_progress" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "funnel_id" uuid NOT NULL REFERENCES "funnels"("id") ON DELETE CASCADE,
        "current_step" int NOT NULL DEFAULT 0,
        "completed_steps" jsonb NOT NULL DEFAULT '[]',
        "completed_at" timestamptz,
        "dropped_at_step" int,
        "entered_at" timestamptz NOT NULL DEFAULT now(),
        "last_activity_at" timestamptz,
        UNIQUE ("user_id", "funnel_id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_ufp_user_id" ON "user_funnel_progress" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "idx_ufp_funnel_id" ON "user_funnel_progress" ("funnel_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_funnel_progress"`);
  }
}
