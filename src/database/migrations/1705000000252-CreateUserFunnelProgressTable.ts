import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserFunnelProgressTable1705000000252 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_funnel_progress" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "funnel_name" varchar(100) NOT NULL,
        "current_step" varchar(100) NOT NULL,
        "completed_steps" jsonb NOT NULL DEFAULT '[]',
        "is_converted" boolean NOT NULL DEFAULT false,
        "converted_at" TIMESTAMP WITH TIME ZONE,
        "dropped_at_step" varchar(100),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_funnel_progress" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_funnel_progress_user_funnel" UNIQUE ("user_id", "funnel_name")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_user_funnel_progress_user_id" ON "user_funnel_progress" ("user_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_funnel_progress"`);
  }
}
