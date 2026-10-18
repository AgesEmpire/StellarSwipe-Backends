import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the search_reindex_checkpoints table backing durable progress
 * tracking for full search reindex jobs, so an interrupted job can resume
 * from its last processed offset instead of restarting from zero.
 */
export class CreateSearchReindexCheckpointsTable20261018060000 implements MigrationInterface {
  name = 'CreateSearchReindexCheckpointsTable20261018060000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "search_reindex_checkpoints" (
        "job_name"     varchar(128) NOT NULL,
        "processed"    integer      NOT NULL DEFAULT 0,
        "total"        integer      NOT NULL DEFAULT 0,
        "completed_at" TIMESTAMP,
        "updated_at"   TIMESTAMP    NOT NULL DEFAULT now(),
        CONSTRAINT "PK_search_reindex_checkpoints" PRIMARY KEY ("job_name")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "search_reindex_checkpoints"`);
  }
}
