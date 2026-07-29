import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { MigrationRunnerService } from './migration-runner.service';

const mockDataSource = () => ({
  migrations: [],
  runMigrations: jest.fn(),
  undoLastMigration: jest.fn(),
  query: jest.fn(),
  createQueryRunner: jest.fn(),
});

describe('MigrationRunnerService', () => {
  let service: MigrationRunnerService;
  let dataSource: ReturnType<typeof mockDataSource>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigrationRunnerService,
        { provide: getDataSourceToken(), useFactory: mockDataSource },
      ],
    }).compile();

    service = module.get(MigrationRunnerService);
    dataSource = module.get(getDataSourceToken());
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
