import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the ingestion_checkpoints table backing durable Horizon cursors:
 * the on-chain sync cursor and the per-account stream cursors used to
 * backfill missed events after a Horizon stream reconnect.
 */
export class CreateIngestionCheckpointsTable20260929000000 implements MigrationInterface {
  name = 'CreateIngestionCheckpointsTable20260929000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ingestion_checkpoints" (
        "key"        varchar(128)  NOT NULL,
        "cursor"     varchar(128),
        "updated_at" TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ingestion_checkpoints" PRIMARY KEY ("key")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ingestion_checkpoints"`);
  }
}
