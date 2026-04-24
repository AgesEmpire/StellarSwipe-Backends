import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateCampaignsTable1705000000270 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE campaign_status_enum AS ENUM ('draft', 'active', 'paused', 'completed', 'cancelled')`);
    await queryRunner.query(`CREATE TYPE campaign_type_enum AS ENUM ('promotional', 'educational', 'engagement', 'retention', 'acquisition')`);
    await queryRunner.query(`CREATE TYPE target_type_enum AS ENUM ('country', 'region', 'userSegment', 'language', 'userTier')`);

    await queryRunner.createTable(
      new Table({
        name: 'campaigns',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'name', type: 'varchar', length: '200' },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'region', type: 'varchar', length: '10' },
          { name: 'status', type: 'enum', enumName: 'campaign_status_enum', default: "'draft'" },
          { name: 'type', type: 'enum', enumName: 'campaign_type_enum' },
          { name: 'start_date', type: 'timestamp with time zone' },
          { name: 'end_date', type: 'timestamp with time zone' },
          { name: 'budget', type: 'decimal', precision: 18, scale: 2, default: 0 },
          { name: 'spent_budget', type: 'decimal', precision: 18, scale: 2, default: 0 },
          { name: 'localized_content', type: 'jsonb', default: "'{}'" },
          { name: 'localized_pricing', type: 'jsonb', default: "'{}'" },
          { name: 'metadata', type: 'jsonb', default: "'{}'" },
          { name: 'created_by', type: 'varchar', length: '36', isNullable: true },
          { name: 'created_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'campaign_targets',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'campaign_id', type: 'uuid' },
          { name: 'target_type', type: 'enum', enumName: 'target_type_enum' },
          { name: 'target_value', type: 'varchar', length: '100' },
          { name: 'weight', type: 'decimal', precision: 5, scale: 2, default: 1 },
          { name: 'criteria', type: 'jsonb', default: "'{}'" },
          { name: 'created_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'campaign_performance',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'campaign_id', type: 'uuid' },
          { name: 'date', type: 'date' },
          { name: 'impressions', type: 'integer', default: 0 },
          { name: 'clicks', type: 'integer', default: 0 },
          { name: 'conversions', type: 'integer', default: 0 },
          { name: 'revenue', type: 'decimal', precision: 18, scale: 2, default: 0 },
          { name: 'spend', type: 'decimal', precision: 18, scale: 2, default: 0 },
          { name: 'ctr', type: 'decimal', precision: 8, scale: 4, default: 0 },
          { name: 'conversion_rate', type: 'decimal', precision: 8, scale: 4, default: 0 },
          { name: 'metadata', type: 'jsonb', default: "'{}'" },
          { name: 'created_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'campaign_targets',
      new TableForeignKey({
        columnNames: ['campaign_id'],
        referencedTableName: 'campaigns',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'campaign_performance',
      new TableForeignKey({
        columnNames: ['campaign_id'],
        referencedTableName: 'campaigns',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex('campaigns', new TableIndex({ name: 'IDX_campaigns_region_status', columnNames: ['region', 'status'] }));
    await queryRunner.createIndex('campaigns', new TableIndex({ name: 'IDX_campaigns_start_end', columnNames: ['start_date', 'end_date'] }));
    await queryRunner.createIndex('campaign_targets', new TableIndex({ name: 'IDX_campaign_targets_campaign_id', columnNames: ['campaign_id'] }));
    await queryRunner.createIndex('campaign_performance', new TableIndex({ name: 'IDX_campaign_performance_campaign_date', columnNames: ['campaign_id', 'date'] }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('campaign_performance', true);
    await queryRunner.dropTable('campaign_targets', true);
    await queryRunner.dropTable('campaigns', true);
    await queryRunner.query(`DROP TYPE IF EXISTS target_type_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS campaign_type_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS campaign_status_enum`);
  }
}
