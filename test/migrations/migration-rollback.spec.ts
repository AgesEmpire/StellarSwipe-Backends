import { DataSource } from 'typeorm';

/**
 * Validates that every migration under src/database/migrations can be
 * applied and reverted cleanly against a throwaway sqlite database,
 * so schema drift or broken `down()` methods are caught before deploy.
 */
describe('database migrations - apply and rollback', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      migrations: ['src/database/migrations/*.ts'],
      entities: [],
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('applies all pending migrations without error', async () => {
    await expect(dataSource.runMigrations()).resolves.not.toThrow();
  });

  it('reports no pending migrations after running them', async () => {
    const pending = await dataSource.showMigrations();
    expect(pending).toBe(false);
  });

  it('reverts the last migration cleanly', async () => {
    await expect(dataSource.undoLastMigration()).resolves.not.toThrow();
  });
});
