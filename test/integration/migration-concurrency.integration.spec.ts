import { DataSource, QueryRunner } from 'typeorm';
import { AdvisoryLockService } from '../../src/common/database/advisory-lock.service';
import { MigrationRunnerService } from '../../src/database/migration-runner.service';
import { validateDatabaseTimestampSettings } from '../../src/app.module';

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

  describe('Database timestamp settings', () => {
    let dataSource: DataSource;

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        host: process.env.DATABASE_HOST || 'localhost',
        port: parseInt(process.env.DATABASE_PORT || '5432', 10),
        username: process.env.DATABASE_USER || 'test',
        password: process.env.DATABASE_PASSWORD || 'test',
        database: process.env.DATABASE_NAME || 'test',
      });
      await dataSource.initialize();
    });

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.destroy();
      }
    });

    const validateSession = async (timeZone: string) => {
      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();
      try {
        await queryRunner.query(`SET TIME ZONE '${timeZone}'`);
        await validateDatabaseTimestampSettings(
          (sql, parameters) => queryRunner.query(sql, parameters),
          'UTC',
        );
      } finally {
        await queryRunner.release();
      }
    };

    it('accepts the supported UTC session and millisecond-capable schema', async () => {
      await expect(validateSession('UTC')).resolves.toBeUndefined();
    });

    it('rejects a session time zone that differs from the application setting', async () => {
      await expect(validateSession('America/Los_Angeles')).rejects.toThrow(
        /session time zone.*expected "UTC"/,
      );
    });

    it('rejects persisted timestamp columns with insufficient precision', async () => {
      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();
      try {
        await queryRunner.query(
          'CREATE TEMP TABLE timestamp_precision_probe (created_at timestamp(0))',
        );
        await queryRunner.query(`SET TIME ZONE 'UTC'`);

        await expect(
          validateDatabaseTimestampSettings(
            (sql, parameters) => queryRunner.query(sql, parameters),
            'UTC',
          ),
        ).rejects.toThrow(
          /precision must be at least 3 digits.*timestamp_precision_probe\.created_at/,
        );
      } finally {
        await queryRunner.query('DROP TABLE IF EXISTS timestamp_precision_probe');
        await queryRunner.release();
      }
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
