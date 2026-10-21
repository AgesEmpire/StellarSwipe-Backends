import { DataSource, QueryRunner } from 'typeorm';
import { AdvisoryLockService } from '../../src/common/database/advisory-lock.service';
import { MigrationRunnerService } from '../../src/database/migration-runner.service';
import {
  CriticalConstraintExpectation,
  validateCriticalDatabaseConstraints,
} from '../../src/app.module';

/**
 * Issue #1369 — Prevent concurrent execution of TypeORM migration runners.
 *
 * Simulates two separate application instances (two independent Postgres
 * connections, exactly like two pods/processes racing during a deploy)
 * both attempting to run migrations at the same moment. Only one may hold
 * the `stellarswipe:migrations` advisory lock and actually proceed; the
 * other must observe the lock as held and back off immediately rather than
 * touching the schema.
 *
 * Requires a reachable Postgres instance (same convention as the other
 * specs under test/integration), configured via DATABASE_* env vars.
 */
describe('Migration runner concurrency (Issue #1369)', () => {
  let dataSourceA: DataSource;
  let dataSourceB: DataSource;

  const connectionOptions = {
    type: 'postgres' as const,
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    username: process.env.DATABASE_USER || 'test',
    password: process.env.DATABASE_PASSWORD || 'test',
    database: process.env.DATABASE_NAME || 'test',
    synchronize: false,
  };

  beforeAll(async () => {
    dataSourceA = new DataSource({ ...connectionOptions, name: 'runner-a' });
    dataSourceB = new DataSource({ ...connectionOptions, name: 'runner-b' });
    await dataSourceA.initialize();
    await dataSourceB.initialize();
  });

  describe('Critical database constraints', () => {
    let dataSource: DataSource;
    let queryRunner: QueryRunner;
    let schemaName: string;
    const tableName = 'critical_constraint_probe';

    const expectations = (): CriticalConstraintExpectation[] => [
      {
        schemaName,
        tableName,
        constraintName: 'uq_critical_probe_parent',
        kind: 'unique',
        columns: ['parent_id'],
        migration: 'test-unique-migration',
      },
      {
        schemaName,
        tableName,
        constraintName: 'uq_critical_probe_external_key',
        kind: 'unique',
        columns: ['external_key'],
        migration: 'test-unique-index-migration',
      },
      {
        schemaName,
        tableName,
        constraintName: 'fk_critical_probe_parent',
        kind: 'foreign',
        columns: ['parent_id'],
        referencedSchema: schemaName,
        referencedTable: 'critical_constraint_parent',
        referencedColumns: ['id'],
        migration: 'test-foreign-key-migration',
      },
    ];

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        host: process.env.DATABASE_HOST || 'localhost',
        port: parseInt(process.env.DATABASE_PORT || '5432', 10),
        username: process.env.DATABASE_USER || 'test',
        password: process.env.DATABASE_PASSWORD || 'test',
        database: process.env.DATABASE_NAME || 'test',
        synchronize: false,
      });
      await dataSource.initialize();
      queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();
    });

    afterAll(async () => {
      if (queryRunner?.isReleased === false) {
        await queryRunner.release();
      }
      if (dataSource?.isInitialized) {
        await dataSource.destroy();
      }
    });

    beforeEach(async () => {
      await queryRunner.query(
        'CREATE TEMP TABLE critical_constraint_parent (id integer PRIMARY KEY)',
      );
      await queryRunner.query(
        `CREATE TEMP TABLE ${tableName} (
           parent_id integer,
           external_key text,
           CONSTRAINT uq_critical_probe_parent UNIQUE (parent_id),
           CONSTRAINT fk_critical_probe_parent
             FOREIGN KEY (parent_id)
             REFERENCES critical_constraint_parent (id)
         )`,
      );
      await queryRunner.query(
        `CREATE UNIQUE INDEX uq_critical_probe_external_key
           ON ${tableName} (external_key)`,
      );
      const [tempSchema] = await queryRunner.query(
        'SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()',
      );
      schemaName = tempSchema.nspname;
    });

    afterEach(async () => {
      await queryRunner.query(`DROP TABLE IF EXISTS ${tableName}`);
      await queryRunner.query(
        'DROP TABLE IF EXISTS critical_constraint_parent',
      );
    });

    it('accepts the expected unique and foreign-key constraints', async () => {
      await expect(
        validateCriticalDatabaseConstraints(
          (sql, parameters) => queryRunner.query(sql, parameters),
          expectations(),
        ),
      ).resolves.toBeUndefined();
    });

    it('reports a missing uniqueness constraint and its migration', async () => {
      await queryRunner.query(
        `ALTER TABLE ${tableName} DROP CONSTRAINT uq_critical_probe_parent`,
      );

      await expect(
        validateCriticalDatabaseConstraints(
          (sql, parameters) => queryRunner.query(sql, parameters),
          expectations(),
        ),
      ).rejects.toThrow(
        /uq_critical_probe_parent.*test-unique-migration/,
      );
    });

    it('reports a missing foreign key and its migration', async () => {
      await queryRunner.query(
        `ALTER TABLE ${tableName} DROP CONSTRAINT fk_critical_probe_parent`,
      );

      await expect(
        validateCriticalDatabaseConstraints(
          (sql, parameters) => queryRunner.query(sql, parameters),
          expectations(),
        ),
      ).rejects.toThrow(
        /fk_critical_probe_parent.*test-foreign-key-migration/,
      );
    });

    it('reports a missing standalone unique index and its migration', async () => {
      await queryRunner.query(`DROP INDEX uq_critical_probe_external_key`);

      await expect(
        validateCriticalDatabaseConstraints(
          (sql, parameters) => queryRunner.query(sql, parameters),
          expectations(),
        ),
      ).rejects.toThrow(
        /uq_critical_probe_external_key.*test-unique-index-migration/,
      );
    });
  });

  afterAll(async () => {
    await dataSourceA?.isInitialized && dataSourceA.destroy();
    await dataSourceB?.isInitialized && dataSourceB.destroy();
  });

  it('only one of two concurrently-started runners acquires the lock and proceeds', async () => {
    // Two independent AdvisoryLockService instances, each backed by its own
    // Postgres session — this is what two separate application instances
    // would actually have in production.
    const lockServiceA = new AdvisoryLockService(dataSourceA as any);
    const lockServiceB = new AdvisoryLockService(dataSourceB as any);

    const runnerA = new MigrationRunnerService(dataSourceA as any, lockServiceA);
    const runnerB = new MigrationRunnerService(dataSourceB as any, lockServiceB);

    // No real migrations to apply — the assertion is purely about lock
    // contention, not schema changes, so this is safe against any test DB.
    (dataSourceA as any).migrations = [];
    (dataSourceB as any).migrations = [];

    const [resultA, resultB] = await Promise.all([
      runnerA.runMigrations(),
      runnerB.runMigrations(),
    ]);

    const results = [resultA, resultB];
    const blocked = results.filter(
      (r) => r.failed === 'Another migration run is already in progress',
    );
    const proceeded = results.filter((r) => r.failed === undefined);

    expect(blocked).toHaveLength(1);
    expect(proceeded).toHaveLength(1);
  });

  it('releases the lock so a subsequent run is not blocked by an abandoned holder', async () => {
    const lockServiceA = new AdvisoryLockService(dataSourceA as any);
    const runnerA = new MigrationRunnerService(dataSourceA as any, lockServiceA);
    (dataSourceA as any).migrations = [];

    const first = await runnerA.runMigrations();
    expect(first.failed).toBeUndefined();

    // A second run against the same connection, after the first released
    // its lock, must be able to acquire it again immediately (bounded
    // recovery — no leftover lock state blocks future runs).
    const second = await runnerA.runMigrations();
    expect(second.failed).toBeUndefined();
  });
});
