import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateKycTables1710000002000 implements MigrationInterface {
  name = 'CreateKycTables1710000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enums
    await queryRunner.query(`
      CREATE TYPE "kyc_status_enum" AS ENUM (
        'pending', 'under_review', 'approved', 'rejected', 'expired', 'requires_action'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "kyc_provider_enum" AS ENUM ('persona', 'onfido')
    `);
    await queryRunner.query(`
      CREATE TYPE "kyc_audit_action_enum" AS ENUM (
        'initiated', 'document_submitted', 'status_changed',
        'level_upgraded', 'level_downgraded', 'expired',
        'renewal_started', 'webhook_received', 'limit_checked', 'limit_exceeded'
      )
    `);

    // kyc_verifications
    await queryRunner.createTable(
      new Table({
        name: 'kyc_verifications',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid', isNullable: false },
          { name: 'level', type: 'int', default: 0 },
          { name: 'status', type: 'kyc_status_enum', default: "'pending'" },
          { name: 'provider', type: 'kyc_provider_enum', default: "'persona'" },
          {
            name: 'verificationId',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'inquiryId',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'sessionToken',
            type: 'varchar',
            length: '1000',
            isNullable: true,
          },
          { name: 'approvedAt', type: 'timestamp', isNullable: true },
          { name: 'expiresAt', type: 'timestamp', isNullable: true },
          { name: 'rejectionReason', type: 'text', isNullable: true },
          { name: 'providerMetadata', type: 'jsonb', default: "'{}'" },
          { name: 'attemptCount', type: 'int', default: 1 },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'kyc_verifications',
      new TableIndex({
        name: 'IDX_kyc_verifications_userId_level',
        columnNames: ['userId', 'level'],
      }),
    );
    await queryRunner.createIndex(
      'kyc_verifications',
      new TableIndex({
        name: 'IDX_kyc_verifications_status_expiresAt',
        columnNames: ['status', 'expiresAt'],
      }),
    );
    await queryRunner.createIndex(
      'kyc_verifications',
      new TableIndex({
        name: 'IDX_kyc_verifications_inquiryId',
        columnNames: ['inquiryId'],
      }),
    );

    // kyc_audit_logs
    await queryRunner.createTable(
      new Table({
        name: 'kyc_audit_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid', isNullable: false },
          { name: 'verificationId', type: 'uuid', isNullable: true },
          { name: 'action', type: 'kyc_audit_action_enum' },
          { name: 'details', type: 'jsonb', default: "'{}'" },
          {
            name: 'ipAddress',
            type: 'varchar',
            length: '45',
            isNullable: true,
          },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'kyc_audit_logs',
      new TableIndex({
        name: 'IDX_kyc_audit_userId_createdAt',
        columnNames: ['userId', 'createdAt'],
      }),
    );
    await queryRunner.createIndex(
      'kyc_audit_logs',
      new TableIndex({
        name: 'IDX_kyc_audit_action_createdAt',
        columnNames: ['action', 'createdAt'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('kyc_audit_logs');
    await queryRunner.dropTable('kyc_verifications');
    await queryRunner.query(`DROP TYPE "kyc_audit_action_enum"`);
    await queryRunner.query(`DROP TYPE "kyc_provider_enum"`);
    await queryRunner.query(`DROP TYPE "kyc_status_enum"`);
  }
}
