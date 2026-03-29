import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFunnelsTable1705000000251 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "funnels" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(100) NOT NULL UNIQUE,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "funnel_steps" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "funnel_id" uuid NOT NULL REFERENCES "funnels"("id") ON DELETE CASCADE,
        "key" varchar(100) NOT NULL,
        "name" varchar(100) NOT NULL,
        "step_order" int NOT NULL,
        "description" varchar(255),
        UNIQUE ("funnel_id", "step_order")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "funnel_steps"`);
    await queryRunner.query(`DROP TABLE "funnels"`);
  }
}
