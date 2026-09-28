import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { MigrationService } from '../../../src/database/migration/migration.service';

describe('MigrationService', () => {
  let service: MigrationService;
  let dataSource: jest.Mocked<DataSource>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockDataSource = {
      runMigrations: jest.fn(),
      undoLastMigration: jest.fn(),
      showMigrations: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigrationService,
        {
          provide: getDataSourceToken(),
          useValue: mockDataSource,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<MigrationService>(MigrationService);
    dataSource = module.get(getDataSourceToken());
    configService = module.get(ConfigService);
  });

  describe('runMigrations', () => {
    it('should run migrations successfully', async () => {
      const mockMigrations = [{ name: 'test-migration' }];
      dataSource.runMigrations.mockResolvedValue(mockMigrations);

      await service.runMigrations();

      expect(dataSource.runMigrations).toHaveBeenCalled();
    });

    it('should handle migration errors', async () => {
      const error = new Error('Migration failed');
      dataSource.runMigrations.mockRejectedValue(error);

      await expect(service.runMigrations()).rejects.toThrow('Migration failed');
    });
  });

  describe('revertMigration', () => {
    it('should revert last migration successfully', async () => {
      dataSource.undoLastMigration.mockResolvedValue(undefined);

      await service.revertMigration();

      expect(dataSource.undoLastMigration).toHaveBeenCalled();
    });
  });

  describe('getMigrationStatus', () => {
    it('should return correct migration status', async () => {
      const mockMigrations = [
        { name: 'migration1', timestamp: 123456 },
        { name: 'migration2', timestamp: null },
      ];
      dataSource.showMigrations.mockResolvedValue(mockMigrations);

      const result = await service.getMigrationStatus();

      expect(result).toEqual({ pending: 1, executed: 1 });
    });
  });
});