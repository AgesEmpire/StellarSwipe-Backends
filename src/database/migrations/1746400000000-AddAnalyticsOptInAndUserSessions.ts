import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds analytics_opt_in to user_preferences and creates user_sessions_analytics table.
 * Supports zero-downtime: new column has a default value.
 */
export class AddAnalyticsOptInAndUserSessions1746400000000 implements MigrationInterface {
  name = 'AddAnalyticsOptInAndUserSessions1746400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add analytics opt-in column with default true (opt-in by default, users can opt out)
    await queryRunner.query(`
      ALTER TABLE user_preferences
      ADD COLUMN IF NOT EXISTS analytics_opt_in boolean NOT NULL DEFAULT true
    `);

    // Create user sessions analytics table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_sessions_analytics (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       uuid,
        session_id    varchar(128) NOT NULL,
        started_at    timestamptz NOT NULL,
        ended_at      timestamptz,
        duration_seconds int,
        event_count   int NOT NULL DEFAULT 0,
        metadata      jsonb,
        created_at    timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_analytics_user_started
      ON user_sessions_analytics (user_id, started_at)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_analytics_session_id
      ON user_sessions_analytics (session_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_sessions_analytics`);
    await queryRunner.query(`
      ALTER TABLE user_preferences DROP COLUMN IF EXISTS analytics_opt_in
    `);
  }
}
