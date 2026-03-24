import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateSlaAgreementsTable1705000000229 implements MigrationInterface {
  name = 'CreateSlaAgreementsTable1705000000229';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "sla_tier_name_enum" AS ENUM ('bronze', 'silver', 'gold', 'platinum')`);
    await queryRunner.query(`CREATE TYPE "sla_agreement_status_enum" AS ENUM ('active', 'suspended', 'expired', 'terminated')`);
    await queryRunner.query(`CREATE TYPE "sla_metric_type_enum" AS ENUM ('uptime', 'response_time', 'error_rate', 'throughput')`);
    await queryRunner.query(`CREATE TYPE "sla_violation_severity_enum" AS ENUM ('warning', 'breach', 'critical')`);

    await queryRunner.createTable(
      new Table({
        name: 'sla_agreements',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'user_id', type: 'varchar' },
          { name: 'client_name', type: 'varchar', length: '255' },
          { name: 'tier', type: 'enum', enumName: 'sla_tier_name_enum' },
          { name: 'uptime_percent', type: 'decimal', precision: 5, scale: 2 },
          { name: 'max_response_time_ms', type: 'int' },
          { name: 'max_error_rate_percent', type: 'decimal', precision: 5, scale: 2 },
          { name: 'min_throughput_rpm', type: 'int' },
          { name: 'support_response_hours', type: 'int' },
          { name: 'priority_routing', type: 'boolean', default: false },
          { name: 'status', type: 'enum', enumName: 'sla_agreement_status_enum', default: "'active'" },
          { name: 'starts_at', type: 'timestamp' },
          { name: 'ends_at', type: 'timestamp', isNullable: true },
          { name: 'metadata', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'sla_metrics',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'agreement_id', type: 'uuid' },
          { name: 'type', type: 'enum', enumName: 'sla_metric_type_enum' },
          { name: 'value', type: 'decimal', precision: 12, scale: 4 },
          { name: 'window_minutes', type: 'int' },
          { name: 'sample_count', type: 'int', default: 0 },
          { name: 'recorded_at', type: 'timestamp' },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'sla_violations',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'agreement_id', type: 'uuid' },
          { name: 'metric_type', type: 'enum', enumName: 'sla_metric_type_enum' },
          { name: 'severity', type: 'enum', enumName: 'sla_violation_severity_enum' },
          { name: 'threshold_value', type: 'decimal', precision: 12, scale: 4 },
          { name: 'actual_value', type: 'decimal', precision: 12, scale: 4 },
          { name: 'message', type: 'text', isNullable: true },
          { name: 'resolved_at', type: 'timestamp', isNullable: true },
          { name: 'alert_sent', type: 'boolean', default: false },
          { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.query(`CREATE INDEX "IDX_sla_agreements_user_status" ON "sla_agreements" ("user_id", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_sla_agreements_tier" ON "sla_agreements" ("tier")`);
    await queryRunner.query(`CREATE INDEX "IDX_sla_metrics_agreement_type" ON "sla_metrics" ("agreement_id", "type", "recorded_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_sla_violations_agreement" ON "sla_violations" ("agreement_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_sla_violations_severity" ON "sla_violations" ("severity")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('sla_violations');
    await queryRunner.dropTable('sla_metrics');
    await queryRunner.dropTable('sla_agreements');
    await queryRunner.query(`DROP TYPE "sla_violation_severity_enum"`);
    await queryRunner.query(`DROP TYPE "sla_metric_type_enum"`);
    await queryRunner.query(`DROP TYPE "sla_agreement_status_enum"`);
    await queryRunner.query(`DROP TYPE "sla_tier_name_enum"`);
  }
}
