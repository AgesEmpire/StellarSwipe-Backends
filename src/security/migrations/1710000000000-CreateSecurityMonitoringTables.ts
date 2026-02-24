import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateSecurityMonitoringTables1710000000000 implements MigrationInterface {
  name = 'CreateSecurityMonitoringTables1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enums
    await queryRunner.query(`
      CREATE TYPE "security_alerts_type_enum" AS ENUM (
        'FAILED_LOGIN',
        'NEW_LOCATION',
        'UNUSUAL_TRADE_VOLUME',
        'RAPID_WALLET_CHANGES',
        'API_RATE_ABUSE',
        'ACCOUNT_LOCKED',
        'SUSPICIOUS_ACTIVITY',
        'MULTIPLE_SESSIONS'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "security_alerts_severity_enum" AS ENUM ('info', 'warning', 'critical')
    `);

    await queryRunner.query(`
      CREATE TYPE "security_incidents_status_enum" AS ENUM (
        'open', 'investigating', 'contained', 'resolved', 'false_positive'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "security_incidents_severity_enum" AS ENUM ('low', 'medium', 'high', 'critical')
    `);

    // security_alerts table
    await queryRunner.createTable(
      new Table({
        name: 'security_alerts',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid', isNullable: false },
          {
            name: 'type',
            type: 'security_alerts_type_enum',
            isNullable: false,
          },
          {
            name: 'severity',
            type: 'security_alerts_severity_enum',
            default: "'info'",
          },
          { name: 'details', type: 'jsonb', default: "'{}'" },
          { name: 'resolved', type: 'boolean', default: false },
          { name: 'resolvedBy', type: 'uuid', isNullable: true },
          { name: 'resolvedAt', type: 'timestamp', isNullable: true },
          { name: 'resolutionNote', type: 'text', isNullable: true },
          { name: 'notificationSent', type: 'boolean', default: false },
          { name: 'falsePositive', type: 'boolean', default: false },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'security_alerts',
      new TableIndex({
        name: 'IDX_security_alerts_userId_createdAt',
        columnNames: ['userId', 'createdAt'],
      }),
    );
    await queryRunner.createIndex(
      'security_alerts',
      new TableIndex({
        name: 'IDX_security_alerts_severity_resolved',
        columnNames: ['severity', 'resolved'],
      }),
    );

    // security_incidents table
    await queryRunner.createTable(
      new Table({
        name: 'security_incidents',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid', isNullable: false },
          { name: 'title', type: 'varchar', length: '255' },
          { name: 'description', type: 'text', isNullable: true },
          {
            name: 'status',
            type: 'security_incidents_status_enum',
            default: "'open'",
          },
          {
            name: 'severity',
            type: 'security_incidents_severity_enum',
            default: "'medium'",
          },
          { name: 'alertIds', type: 'jsonb', default: "'[]'" },
          { name: 'timeline', type: 'jsonb', default: "'[]'" },
          { name: 'assignedTo', type: 'uuid', isNullable: true },
          { name: 'accountLocked', type: 'boolean', default: false },
          { name: 'requires2FAReeset', type: 'boolean', default: false },
          { name: 'metadata', type: 'jsonb', default: "'{}'" },
          { name: 'resolvedAt', type: 'timestamp', isNullable: true },
          { name: 'resolvedBy', type: 'uuid', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'security_incidents',
      new TableIndex({
        name: 'IDX_security_incidents_userId_status',
        columnNames: ['userId', 'status'],
      }),
    );
    await queryRunner.createIndex(
      'security_incidents',
      new TableIndex({
        name: 'IDX_security_incidents_status_severity',
        columnNames: ['status', 'severity'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('security_incidents');
    await queryRunner.dropTable('security_alerts');
    await queryRunner.query(`DROP TYPE "security_incidents_severity_enum"`);
    await queryRunner.query(`DROP TYPE "security_incidents_status_enum"`);
    await queryRunner.query(`DROP TYPE "security_alerts_severity_enum"`);
    await queryRunner.query(`DROP TYPE "security_alerts_type_enum"`);
  }
}
