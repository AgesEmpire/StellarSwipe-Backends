import { HealthCheckError } from '@nestjs/terminus';
import { TransactionReadinessIndicator } from './transaction-readiness.indicator';

describe('TransactionReadinessIndicator (Issue #1372)', () => {
  const makeQueryRunner = (overrides: Partial<{ query: jest.Mock; failOn: string }> = {}) => {
    const query = overrides.query ?? jest.fn().mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT id FROM')) {
        return Promise.resolve([{ id: 1 }]);
      }
      return Promise.resolve(undefined);
    });

    return {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query,
    };
  };

  const makeIndicator = (queryRunner: ReturnType<typeof makeQueryRunner>) => {
    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as any;
    return new TransactionReadinessIndicator(dataSource);
  };

  it('reports healthy when the probe transaction writes and reads back successfully', async () => {
    const queryRunner = makeQueryRunner();
    const indicator = makeIndicator(queryRunner);

    const result = await indicator.isHealthy('database_transaction');

    expect(result.database_transaction.status).toBe('up');
    expect(result.database_transaction).toMatchObject({ transactional: true });
  });

  it('always rolls back the probe transaction, even on success (never persists)', async () => {
    const queryRunner = makeQueryRunner();
    const indicator = makeIndicator(queryRunner);

    await indicator.isHealthy('database_transaction');

    expect(queryRunner.startTransaction).toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('cleans up (rollback + release) even when the probe write fails', async () => {
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.startsWith('INSERT')) {
        return Promise.reject(new Error('relation is read-only'));
      }
      return Promise.resolve(undefined);
    });
    const queryRunner = makeQueryRunner({ query });
    const indicator = makeIndicator(queryRunner);

    await expect(indicator.isHealthy('database_transaction')).rejects.toBeInstanceOf(HealthCheckError);

    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('throws HealthCheckError with transactional:false when the write is not visible in a read-back', async () => {
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT id FROM')) {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });
    const queryRunner = makeQueryRunner({ query });
    const indicator = makeIndicator(queryRunner);

    try {
      await indicator.isHealthy('database_transaction');
      fail('expected isHealthy to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HealthCheckError);
      expect((err as HealthCheckError).causes).toMatchObject({
        database_transaction: { status: 'down', transactional: false },
      });
    }
  });

  it('throws HealthCheckError and still releases the connection when startTransaction itself fails', async () => {
    const queryRunner = makeQueryRunner();
    queryRunner.startTransaction.mockRejectedValue(new Error('database is in recovery mode'));
    const indicator = makeIndicator(queryRunner);

    await expect(indicator.isHealthy('database_transaction')).rejects.toBeInstanceOf(HealthCheckError);
    expect(queryRunner.release).toHaveBeenCalled();
    // Transaction never started, so there is nothing to roll back.
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('includes the error message in the down result without leaking it on success', async () => {
    const query = jest.fn().mockRejectedValue(new Error('could not serialize access'));
    const queryRunner = makeQueryRunner({ query });
    const indicator = makeIndicator(queryRunner);

    try {
      await indicator.isHealthy('database_transaction');
      fail('expected isHealthy to throw');
    } catch (err) {
      expect((err as HealthCheckError).causes).toMatchObject({
        database_transaction: { error: 'could not serialize access' },
      });
    }
  });
});
