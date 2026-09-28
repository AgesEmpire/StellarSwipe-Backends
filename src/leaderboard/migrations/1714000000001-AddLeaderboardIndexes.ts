import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds partial and covering indexes that back the leaderboard aggregation
 * queries in LeaderboardRepository.
 *
 * All indexes are created CONCURRENTLY so they do not lock the table during
 * deployment on a live database.  Note: CONCURRENTLY cannot run inside an
 * explicit transaction, so each statement is executed individually.
 */
export class AddLeaderboardIndexes1714000000001 implements MigrationInterface {
  name = 'AddLeaderboardIndexes1714000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Partial index: covers the WHERE + GROUP BY + ORDER BY columns for
    // closed-signal aggregation.  The WHERE clause matches the query filter
    // so PostgreSQL can use an index-only scan.
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_leaderboard
        ON signals (provider_address, status, created_at)
        WHERE status = 'closed'
    `);

    // Covering index for win-rate and PnL aggregation columns.
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_pnl_outcome
        ON signals (provider_address, outcome, pnl)
        WHERE status = 'closed'
    `);

    // Covering index for provider metadata lookups — INCLUDE avoids a heap
    // fetch when only name/avatar/bio are needed.
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_providers_address
        ON providers (address)
        INCLUDE (name, avatar, bio)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_signals_leaderboard`);
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_signals_pnl_outcome`);
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_providers_address`);
  }
}
