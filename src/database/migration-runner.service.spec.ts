import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { MigrationRunnerService } from './migration-runner.service';
import { AdvisoryLockService } from '../common/database/advisory-lock.service';

const mockDataSource = () => ({
  migrations: [],
  runMigrations: jest.fn(),
  undoLastMigration: jest.fn(),
  query: jest.fn(),
  createQueryRunner: jest.fn(),
});

const mockAdvisoryLockService = () => ({
  tryAcquire: jest.fn().mockResolvedValue(true),
  release: jest.fn().mockResolvedValue(undefined),
  runExclusive: jest.fn(),
});

describe('MigrationRunnerService', () => {
  let service: MigrationRunnerService;
  let dataSource: ReturnType<typeof mockDataSource>;
  let advisoryLockService: ReturnType<typeof mockAdvisoryLockService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigrationRunnerService,
        { provide: getDataSourceToken(), useFactory: mockDataSource },
        { provide: AdvisoryLockService, useFactory: mockAdvisoryLockService },
      ],
    }).compile();

    service = module.get(MigrationRunnerService);
    dataSource = module.get(getDataSourceToken());
    advisoryLockService = module.get(AdvisoryLockService);
  });

  describe('runMigrations', () => {
    it('returns empty result when no pending migrations', async () => {
      dataSource.migrations = [];
      dataSource.createQueryRunner.mockReturnValue({ hasTable: jest.fn().mockResolvedValue(true), release: jest.fn() });
      dataSource.query.mockResolvedValue([]);

      const result = await service.runMigrations();
      expect(result.executed).toHaveLength(0);
      expect(result.failed).toBeUndefined();
    });

    it('runs pending migrations and returns their names', async () => {
      const migration = { constructor: { name: 'CreateUsers1700000000000' }, up: jest.fn(), down: jest.fn() };
      dataSource.migrations = [migration];
      dataSource.createQueryRunner.mockReturnValue({ hasTable: jest.fn().mockResolvedValue(true), release: jest.fn() });
      dataSource.query.mockResolvedValue([]); // no executed migrations
      dataSource.runMigrations.mockResolvedValue([{ name: 'CreateUsers1700000000000' }]);

      const result = await service.runMigrations();
      expect(result.executed).toContain('CreateUsers1700000000000');
    });

    it('returns failed message on error', async () => {
      const migration = { constructor: { name: 'CreateUsers1700000000000' }, up: jest.fn(), down: jest.fn() };
      dataSource.migrations = [migration];
      dataSource.createQueryRunner.mockReturnValue({ hasTable: jest.fn().mockResolvedValue(true), release: jest.fn() });
      dataSource.query.mockResolvedValue([]);
      dataSource.runMigrations.mockRejectedValue(new Error('DB error'));

      const result = await service.runMigrations();
      expect(result.failed).toBe('DB error');
    });

    it('rejects incompatible pending migrations before execution', async () => {
      const pendingMigration = { constructor: { name: 'CreateUsers1690000000000' }, up: jest.fn(), down: jest.fn() };
      dataSource.migrations = [pendingMigration];
      dataSource.createQueryRunner.mockReturnValue({ hasTable: jest.fn().mockResolvedValue(true), release: jest.fn() });
      dataSource.query.mockResolvedValue([
        { name: 'CreateUsers1700000000000', timestamp: 1700000000000 },
      ]);

      const result = await service.runMigrations();

      expect(result.failed).toContain('Incompatible pending migrations detected');
      expect(dataSource.runMigrations).not.toHaveBeenCalled();
    });
  });

  describe('concurrency protection (Issue #1369)', () => {
    it('acquires the shared migrations advisory lock before running', async () => {
      dataSource.migrations = [];
      dataSource.createQueryRunner.mockReturnValue({ hasTable: jest.fn().mockResolvedValue(true), release: jest.fn() });
      dataSource.query.mockResolvedValue([]);

      await service.runMigrations();

      expect(advisoryLockService.tryAcquire).toHaveBeenCalledWith('stellarswipe:migrations');
      expect(advisoryLockService.release).toHaveBeenCalledWith('stellarswipe:migrations');
    });

    it('skips the migration run without touching the schema when the lock is already held', async () => {
      advisoryLockService.tryAcquire.mockResolvedValue(false);

      const result = await service.runMigrations();

      expect(result.failed).toBe('Another migration run is already in progress');
      expect(dataSource.runMigrations).not.toHaveBeenCalled();
      expect(advisoryLockService.release).not.toHaveBeenCalled();
    });

    it('releases the lock even when the migration run throws', async () => {
      const migration = { constructor: { name: 'CreateUsers1700000000000' }, up: jest.fn(), down: jest.fn() };
      dataSource.migrations = [migration];
      dataSource.createQueryRunner.mockReturnValue({ hasTable: jest.fn().mockResolvedValue(true), release: jest.fn() });
      dataSource.query.mockResolvedValue([]);
      dataSource.runMigrations.mockRejectedValue(new Error('boom'));

      await service.runMigrations();

      expect(advisoryLockService.release).toHaveBeenCalledWith('stellarswipe:migrations');
    });

    it('simulates two concurrent runner instances: only the first proceeds', async () => {
      // Model a single Postgres-backed advisory lock shared across two
      // "instances" of MigrationRunnerService — the first tryAcquire call
      // succeeds, every subsequent one fails until release() is called.
      let locked = false;
      advisoryLockService.tryAcquire.mockImplementation(async () => {
        if (locked) return false;
        locked = true;
        return true;
      });
      advisoryLockService.release.mockImplementation(async () => {
        locked = false;
      });

      dataSource.migrations = [];
      dataSource.createQueryRunner.mockReturnValue({ hasTable: jest.fn().mockResolvedValue(true), release: jest.fn() });
      dataSource.query.mockResolvedValue([]);

      const [first, second] = await Promise.all([
        service.runMigrations(),
        service.runMigrations(),
      ]);

      const results = [first, second];
      const skipped = results.filter((r) => r.failed === 'Another migration run is already in progress');
      const proceeded = results.filter((r) => r.failed === undefined);

      // Exactly one of the two concurrent calls actually ran; the other
      // observed the lock already held and backed off immediately.
      expect(skipped).toHaveLength(1);
      expect(proceeded).toHaveLength(1);
    });
  });

  describe('revertLastMigration', () => {
    it('returns null when no executed migrations', async () => {
      dataSource.createQueryRunner.mockReturnValue({ hasTable: jest.fn().mockResolvedValue(true), release: jest.fn() });
      dataSource.query.mockResolvedValue([]);

      const result = await service.revertLastMigration();
      expect(result.reverted).toBeNull();
    });

    it('reverts the last migration', async () => {
      dataSource.createQueryRunner.mockReturnValue({ hasTable: jest.fn().mockResolvedValue(true), release: jest.fn() });
      dataSource.query.mockResolvedValue([
        { name: 'CreateUsers1700000000000', timestamp: 1700000000000 },
        { name: 'AddIndexes1700000001000', timestamp: 1700000001000 },
      ]);
      dataSource.undoLastMigration.mockResolvedValue(undefined);

      const result = await service.revertLastMigration();
      expect(result.reverted).toBe('AddIndexes1700000001000');
      expect(dataSource.undoLastMigration).toHaveBeenCalled();
    });
  });

  describe('getMigrationStatus', () => {
    it('marks executed migrations correctly', async () => {
      const migration = { constructor: { name: 'CreateUsers1700000000000' }, up: jest.fn(), down: jest.fn() };
      dataSource.migrations = [migration];
      dataSource.createQueryRunner.mockReturnValue({ hasTable: jest.fn().mockResolvedValue(true), release: jest.fn() });
      dataSource.query.mockResolvedValue([{ name: 'CreateUsers1700000000000', timestamp: 1700000000000 }]);

      const status = await service.getMigrationStatus();
      expect(status).toHaveLength(1);
      expect(status[0].executed).toBe(true);
      expect(status[0].name).toBe('CreateUsers1700000000000');
    });
  });
});
