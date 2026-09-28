import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: Add tenant_id columns to core tables and enable PostgreSQL
 * Row-Level Security (RLS) policies for multi-tenant data isolation.
 *
 * Resolves: #451 – Add backend support for multi-tenant database isolation
 */
export class AddTenantIdColumns1745000000001 implements MigrationInterface {
  name = 'AddTenantIdColumns1745000000001';

  // Tables that require tenant isolation
  private readonly tenantTables = [
    'users',
    'trades',
    'signals',
    'audit_logs',
    'portfolios',
    'contests',
    'subscriptions',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add tenant_id column to each table (nullable initially for migration safety)
    for (const table of this.tenantTables) {
      const exists = await queryRunner.hasColumn(table, 'tenant_id');
      if (!exists) {
        await queryRunner.query(
          `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "tenant_id" VARCHAR(36)`,
        );
        await queryRunner.query(
          `CREATE INDEX IF NOT EXISTS "IDX_${table}_tenant_id" ON "${table}" ("tenant_id")`,
        );
      }
    }

    // 2. Enable RLS on each table
    for (const table of this.tenantTables) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);

      // Drop existing policy if re-running
      await queryRunner.query(
        `DROP POLICY IF EXISTS "tenant_isolation_policy" ON "${table}"`,
      );

      // Policy: rows are visible/modifiable only when tenant_id matches the
      // session-level setting current_setting('app.tenant_id').
      // SUPER_ADMIN bypass is handled at the application layer via unscopedQuery().
      await queryRunner.query(`
        CREATE POLICY "tenant_isolation_policy" ON "${table}"
          USING (
            tenant_id IS NULL
            OR tenant_id = current_setting('app.tenant_id', true)
          )
          WITH CHECK (
            tenant_id = current_setting('app.tenant_id', true)
          )
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tenantTables) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS "tenant_isolation_policy" ON "${table}"`,
      );
      await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_${table}_tenant_id"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "tenant_id"`,
      );
    }
  }
}
