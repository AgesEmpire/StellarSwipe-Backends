import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateDexRoutesTable1705000000240 implements MigrationInterface {
  name = 'CreateDexRoutesTable1705000000240';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── dex_routes ───────────────────────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'dex_routes',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'dex_id', type: 'varchar', length: '50', isNullable: false },
          { name: 'dex_name', type: 'varchar', length: '100', isNullable: false },
          { name: 'source_asset_code', type: 'varchar', length: '12', isNullable: false },
          { name: 'source_asset_issuer', type: 'varchar', length: '60', isNullable: true },
          { name: 'destination_asset_code', type: 'varchar', length: '12', isNullable: false },
          { name: 'destination_asset_issuer', type: 'varchar', length: '60', isNullable: true },
          { name: 'source_amount', type: 'decimal', precision: 20, scale: 7, isNullable: false },
          { name: 'destination_amount', type: 'decimal', precision: 20, scale: 7, isNullable: false },
          { name: 'price', type: 'decimal', precision: 20, scale: 7, isNullable: false },
          { name: 'fee', type: 'decimal', precision: 10, scale: 6, isNullable: false },
          { name: 'path', type: 'jsonb', isNullable: true },
          { name: 'estimated_slippage', type: 'decimal', precision: 10, scale: 4, isNullable: false },
          { name: 'confidence', type: 'decimal', precision: 5, scale: 4, isNullable: false },
          { name: 'is_optimal', type: 'boolean', default: false },
          { name: 'expires_at', type: 'timestamptz', isNullable: false },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'dex_routes',
      new TableIndex({
        name: 'IDX_dex_routes_pair_dex',
        columnNames: ['source_asset_code', 'destination_asset_code', 'dex_id'],
      }),
    );

    await queryRunner.createIndex(
      'dex_routes',
      new TableIndex({
        name: 'IDX_dex_routes_created_at',
        columnNames: ['created_at'],
      }),
    );

    await queryRunner.createIndex(
      'dex_routes',
      new TableIndex({
        name: 'IDX_dex_routes_optimal',
        columnNames: ['is_optimal', 'source_asset_code', 'destination_asset_code'],
      }),
    );

    // ─── liquidity_pools ──────────────────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'liquidity_pools',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'pool_id', type: 'varchar', length: '100', isNullable: false, isUnique: true },
          { name: 'dex_id', type: 'varchar', length: '50', isNullable: false },
          { name: 'asset_code_a', type: 'varchar', length: '12', isNullable: false },
          { name: 'asset_issuer_a', type: 'varchar', length: '60', isNullable: true },
          { name: 'asset_code_b', type: 'varchar', length: '12', isNullable: false },
          { name: 'asset_issuer_b', type: 'varchar', length: '60', isNullable: true },
          { name: 'total_value_locked', type: 'decimal', precision: 20, scale: 7, default: 0 },
          { name: 'volume_24h', type: 'decimal', precision: 20, scale: 7, default: 0 },
          { name: 'fee', type: 'decimal', precision: 10, scale: 6, isNullable: false },
          { name: 'reserve_a', type: 'decimal', precision: 20, scale: 7, default: 0 },
          { name: 'reserve_b', type: 'decimal', precision: 20, scale: 7, default: 0 },
          { name: 'last_synced_at', type: 'timestamptz', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'liquidity_pools',
      new TableIndex({
        name: 'IDX_liquidity_pools_dex_pair',
        columnNames: ['dex_id', 'asset_code_a', 'asset_code_b'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('liquidity_pools', true);
    await queryRunner.dropTable('dex_routes', true);
  }
}
