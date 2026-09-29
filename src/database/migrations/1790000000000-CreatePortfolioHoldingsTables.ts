import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePortfolioHoldingsTables1790000000000 implements MigrationInterface {
  name = 'CreatePortfolioHoldingsTables1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "portfolios" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "base_currency" varchar(12) NOT NULL,
        "name" varchar(120),
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "source_event_id" varchar(128) NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_portfolios_user_id" UNIQUE ("user_id"),
        CONSTRAINT "UQ_portfolios_source_event_id" UNIQUE ("source_event_id")
      )`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "portfolio_holdings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "asset" varchar(100) NOT NULL,
        "quantity" numeric(28,8) NOT NULL DEFAULT 0,
        "cost_basis" numeric(28,8) NOT NULL DEFAULT 0,
        "last_trade_at" timestamptz,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_portfolio_holdings_user_asset" UNIQUE ("user_id", "asset")
      )`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "portfolio_applied_trades" (
        "idempotency_key" varchar(200) PRIMARY KEY,
        "trade_id" varchar(128) NOT NULL,
        "user_id" uuid NOT NULL,
        "applied_at" timestamp NOT NULL DEFAULT now()
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "portfolio_applied_trades"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "portfolio_holdings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "portfolios"`);
  }
}
