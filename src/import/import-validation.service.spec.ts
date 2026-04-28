import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, QueryRunner } from 'typeorm';
import {
  ImportValidationService,
  ImportRecord,
  RowValidator,
} from './import-validation.service';

const mockQueryRunner = {
  connect: jest.fn(),
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
} as unknown as QueryRunner;

const mockDataSource = {
  createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
} as unknown as DataSource;

describe('ImportValidationService', () => {
  let service: ImportValidationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportValidationService,
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get(ImportValidationService);
  });

  describe('validate', () => {
    it('returns valid=true when all rows pass', () => {
      const rows = [{ name: 'Alice' }, { name: 'Bob' }];
      const validator = ImportValidationService.requiredFields<ImportRecord>(['name']);
      const result = service.validate(rows, [validator]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns errors for missing required fields', () => {
      const rows = [{ name: '' }, { name: 'Bob' }];
      const validator = ImportValidationService.requiredFields<ImportRecord>(['name']);
      const result = service.validate(rows, [validator]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatchObject({ row: 0, field: 'name' });
    });

    it('collects errors from multiple validators', () => {
      const rows = [{ name: 'A'.repeat(300), code: '' }];
      const validators: RowValidator<ImportRecord>[] = [
        ImportValidationService.requiredFields(['code']),
        ImportValidationService.maxLength('name', 255),
      ];
      const result = service.validate(rows, validators);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('importWithRollback', () => {
    it('commits when all rows are valid and persist succeeds', async () => {
      const rows = [{ name: 'Alice' }];
      const persistFn = jest.fn().mockResolvedValue(undefined);
      const result = await service.importWithRollback(
        rows,
        [ImportValidationService.requiredFields(['name'])],
        persistFn,
      );
      expect(result.imported).toBe(1);
      expect(result.rolledBack).toBe(false);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('rolls back and returns rolledBack=true when persist throws', async () => {
      const rows = [{ name: 'Alice' }];
      const persistFn = jest.fn().mockRejectedValue(new Error('DB error'));
      const result = await service.importWithRollback(
        rows,
        [ImportValidationService.requiredFields(['name'])],
        persistFn,
      );
      expect(result.rolledBack).toBe(true);
      expect(result.imported).toBe(0);
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('skips transaction when validation fails', async () => {
      const rows = [{ name: '' }];
      const persistFn = jest.fn();
      const result = await service.importWithRollback(
        rows,
        [ImportValidationService.requiredFields(['name'])],
        persistFn,
      );
      expect(result.rolledBack).toBe(false);
      expect(persistFn).not.toHaveBeenCalled();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
