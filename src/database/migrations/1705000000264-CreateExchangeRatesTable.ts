import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExchangeRatesTable1705000000264 implements MigrationInterface {
  name = 'CreateExchangeRatesTable1705000000264';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "exchange_rates" (
        "id"            UUID              NOT NULL DEFAULT uuid_generate_v4(),
        "baseCurrency"  VARCHAR(10)       NOT NULL,
        "quoteCurrency" VARCHAR(10)       NOT NULL,
        "rate"          DECIMAL(24,10)    NOT NULL,
        "provider"      VARCHAR(50)       NOT NULL,
        "fetchedAt"     TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_exchange_rates" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_exchange_rates_pair_provider"
        ON "exchange_rates" ("baseCurrency", "quoteCurrency", "provider")
    `);

    await queryRunner.query(`
      CREATE TABLE "currency_preferences" (
        "id"                UUID        NOT NULL DEFAULT uuid_generate_v4(),
        "userId"            UUID        NOT NULL,
        "preferredCurrency" VARCHAR(10) NOT NULL DEFAULT 'USD',
        "updatedAt"         TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_currency_preferences" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_currency_preferences_userId" UNIQUE ("userId")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "currency_preferences"`);
    await queryRunner.query(`DROP INDEX "IDX_exchange_rates_pair_provider"`);
    await queryRunner.query(`DROP TABLE "exchange_rates"`);
  }
}
