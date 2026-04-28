import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNftCollectionsTable1705000000243 implements MigrationInterface {
  name = 'CreateNftCollectionsTable1705000000243';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "nft_collections" (
        "id"           UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"         VARCHAR NOT NULL,
        "symbol"       VARCHAR NOT NULL,
        "contractId"   VARCHAR,
        "description"  TEXT,
        "totalMinted"  INTEGER NOT NULL DEFAULT 0,
        "maxSupply"    INTEGER,
        "isActive"     BOOLEAN NOT NULL DEFAULT true,
        "createdAt"    TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"    TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_nft_collections_name" UNIQUE ("name"),
        CONSTRAINT "PK_nft_collections" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "minted_nfts" (
        "id"             UUID NOT NULL DEFAULT uuid_generate_v4(),
        "tokenId"        VARCHAR NOT NULL,
        "collectionId"   UUID NOT NULL,
        "ownerId"        UUID NOT NULL,
        "ownerWallet"    VARCHAR(56) NOT NULL,
        "type"           VARCHAR NOT NULL,
        "rarity"         VARCHAR NOT NULL DEFAULT 'common',
        "metadataUri"    VARCHAR,
        "txHash"         VARCHAR,
        "achievementKey" VARCHAR,
        "mintedAt"       TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_minted_nfts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_minted_nfts_collection"
          FOREIGN KEY ("collectionId") REFERENCES "nft_collections"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_minted_nfts_ownerId" ON "minted_nfts" ("ownerId")`);
    await queryRunner.query(`CREATE INDEX "IDX_minted_nfts_tokenId" ON "minted_nfts" ("tokenId")`);
    await queryRunner.query(`CREATE INDEX "IDX_minted_nfts_collectionId" ON "minted_nfts" ("collectionId")`);

    await queryRunner.query(`
      CREATE TABLE "nft_metadata" (
        "id"        UUID NOT NULL DEFAULT uuid_generate_v4(),
        "tokenId"   VARCHAR NOT NULL,
        "metadata"  JSONB NOT NULL,
        "ipfsHash"  VARCHAR,
        "ipfsUri"   VARCHAR,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_nft_metadata_tokenId" UNIQUE ("tokenId"),
        CONSTRAINT "PK_nft_metadata" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_nft_metadata_tokenId" ON "nft_metadata" ("tokenId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "nft_metadata"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "minted_nfts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "nft_collections"`);
  }
}
