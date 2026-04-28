import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateRoutingRulesTable1705000000274 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE routing_rule_type_enum AS ENUM ('language', 'timezone', 'skill', 'region', 'load_balance')`);

    await queryRunner.createTable(
      new Table({
        name: 'routing_rules',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'name', type: 'varchar', length: '100' },
          { name: 'priority', type: 'integer', default: 0 },
          { name: 'rule_type', type: 'enum', enumName: 'routing_rule_type_enum' },
          { name: 'conditions', type: 'jsonb', default: "'{}'" },
          { name: 'target_team_id', type: 'uuid' },
          { name: 'is_active', type: 'boolean', default: true },
          { name: 'metadata', type: 'jsonb', default: "'{}'" },
          { name: 'created_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp with time zone', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'routing_rules',
      new TableForeignKey({
        columnNames: ['target_team_id'],
        referencedTableName: 'support_teams',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex('routing_rules', new TableIndex({ name: 'IDX_routing_rules_active_priority', columnNames: ['is_active', 'priority'] }));
    await queryRunner.createIndex('routing_rules', new TableIndex({ name: 'IDX_routing_rules_type', columnNames: ['rule_type'] }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('routing_rules', true);
    await queryRunner.query(`DROP TYPE IF EXISTS routing_rule_type_enum`);
  }
}
