import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVersionColumnToPositions1751200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "positions"
      ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "positions" DROP COLUMN IF EXISTS "version"
    `);
  }
}
