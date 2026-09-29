import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ImportValidationService } from './import-validation.service';

describe('ImportValidationService (PostgreSQL rollback)', () => {
  let dataSource: DataSource;
  let service: ImportValidationService;
  const suffix = randomUUID().replace(/-/g, '');
  const accountsTable = `import_accounts_${suffix}`;
  const positionsTable = `import_positions_${suffix}`;

  beforeAll(async () => {
    const database =
      process.env.TEST_DATABASE_NAME ||
      process.env.DATABASE_NAME ||
      'stellarswipe_test';
    if (process.env.NODE_ENV !== 'test' || !database.endsWith('_test')) {
      throw new Error('PostgreSQL rollback tests require NODE_ENV=test and a *_test database');
    }

    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.TEST_DATABASE_HOST || process.env.DATABASE_HOST || 'localhost',
      port: parseInt(
        process.env.TEST_DATABASE_PORT || process.env.DATABASE_PORT || '5432',
        10,
      ),
      username:
        process.env.TEST_DATABASE_USER || process.env.DATABASE_USER || 'test',
      password:
        process.env.TEST_DATABASE_PASSWORD || process.env.DATABASE_PASSWORD || 'test',
      database,
      entities: [],
      synchronize: false,
    });
    await dataSource.initialize();
    service = new ImportValidationService(dataSource);

    await dataSource.query(
      `CREATE TABLE "${accountsTable}" (id text PRIMARY KEY, name text NOT NULL)`,
    );
    await dataSource.query(
      `CREATE TABLE "${positionsTable}" (id text PRIMARY KEY, account_id text NOT NULL REFERENCES "${accountsTable}"(id), asset text NOT NULL)`,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;

    try {
      await dataSource.query(`DROP TABLE IF EXISTS "${positionsTable}"`);
      await dataSource.query(`DROP TABLE IF EXISTS "${accountsTable}"`);
    } finally {
      await dataSource.destroy();
    }
  });

  it('rolls back every entity write when a later workflow item fails', async () => {
    const rows = [
      { id: 'account-1', name: 'Alice', asset: 'XLM' },
      { id: 'account-2', name: 'Bob', asset: 'USDC' },
    ];

    const result = await service.importWithRollback(
      rows,
      [ImportValidationService.requiredFields(['id', 'name', 'asset'])],
      async (row, queryRunner) => {
        await queryRunner.query(
          `INSERT INTO "${accountsTable}" (id, name) VALUES ($1, $2)`,
          [row.id, row.name],
        );
        await queryRunner.query(
          `INSERT INTO "${positionsTable}" (id, account_id, asset) VALUES ($1, $2, $3)`,
          [`position-${row.id}`, row.id, row.asset],
        );

        if (row.id === 'account-2') {
          throw new Error('injected failure after entity writes');
        }
      },
    );

    expect(result).toMatchObject({ imported: 0, failed: rows.length, rolledBack: true });
    expect(result.errors).toContainEqual({
      row: 1,
      field: 'persist',
      message: 'injected failure after entity writes',
    });

    const [accounts, positions] = await Promise.all([
      dataSource.query(`SELECT id FROM "${accountsTable}"`),
      dataSource.query(`SELECT id FROM "${positionsTable}"`),
    ]);
    expect(accounts).toHaveLength(0);
    expect(positions).toHaveLength(0);
  });
});