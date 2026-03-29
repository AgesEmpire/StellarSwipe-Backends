import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFunnelsTable1705000000251 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "funnels" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(100) NOT NULL,
        "steps" jsonb NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_funnels_name" UNIQUE ("name"),
        CONSTRAINT "PK_funnels" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "funnel_steps" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "funnel_id" uuid NOT NULL,
        "step_key" varchar(100) NOT NULL,
        "step_name" varchar(100) NOT NULL,
        "step_order" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_funnel_steps" PRIMARY KEY ("id"),
        CONSTRAINT "FK_funnel_steps_funnel" FOREIGN KEY ("funnel_id")
          REFERENCES "funnels"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_funnel_steps_funnel_step" ON "funnel_steps" ("funnel_id", "step_key")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "funnel_steps"`);
    await queryRunner.query(`DROP TABLE "funnels"`);
  }
}
