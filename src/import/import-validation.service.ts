import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

export interface ImportRecord {
  [key: string]: unknown;
}

export interface ImportValidationResult {
  valid: boolean;
  errors: { row: number; field: string; message: string }[];
}

export interface BulkImportResult {
  imported: number;
  failed: number;
  errors: { row: number; field: string; message: string }[];
  rolledBack: boolean;
}

export type RowValidator<T extends ImportRecord> = (
  row: T,
  index: number,
) => { field: string; message: string }[] | null;

@Injectable()
export class ImportValidationService {
  private readonly logger = new Logger(ImportValidationService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Validate all rows before any DB writes.
   * Returns a result with all validation errors across every row.
   */
  validate<T extends ImportRecord>(
    rows: T[],
    validators: RowValidator<T>[],
  ): ImportValidationResult {
    const errors: ImportValidationResult['errors'] = [];

    for (let i = 0; i < rows.length; i++) {
      for (const validator of validators) {
        const rowErrors = validator(rows[i], i);
        if (rowErrors?.length) {
          errors.push(...rowErrors.map((e) => ({ row: i, ...e })));
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate then persist rows inside a single transaction.
   * On any error the entire batch is rolled back.
   */
  async importWithRollback<T extends ImportRecord>(
    rows: T[],
    validators: RowValidator<T>[],
    persistFn: (row: T, queryRunner: QueryRunner) => Promise<void>,
  ): Promise<BulkImportResult> {
    const validation = this.validate(rows, validators);

    if (!validation.valid) {
      return {
        imported: 0,
        failed: rows.length,
        errors: validation.errors,
        rolledBack: false,
      };
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let imported = 0;
    const errors: BulkImportResult['errors'] = [];

    try {
      for (let i = 0; i < rows.length; i++) {
        try {
          await persistFn(rows[i], queryRunner);
          imported++;
        } catch (err) {
          errors.push({
            row: i,
            field: 'persist',
            message: (err as Error).message,
          });
          throw err; // trigger rollback
        }
      }

      await queryRunner.commitTransaction();
      this.logger.log(`Bulk import committed: ${imported} rows`);

      return { imported, failed: 0, errors: [], rolledBack: false };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.warn(`Bulk import rolled back after row error: ${(err as Error).message}`);

      return {
        imported: 0,
        failed: rows.length,
        errors,
        rolledBack: true,
      };
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Built-in required-field validator factory.
   */
  static requiredFields<T extends ImportRecord>(
    fields: (keyof T)[],
  ): RowValidator<T> {
    return (row, _index) => {
      const errors: { field: string; message: string }[] = [];
      for (const field of fields) {
        if (row[field as string] === undefined || row[field as string] === null || row[field as string] === '') {
          errors.push({ field: field as string, message: `${String(field)} is required` });
        }
      }
      return errors.length ? errors : null;
    };
  }

  /**
   * Built-in max-length validator factory.
   */
  static maxLength<T extends ImportRecord>(
    field: keyof T,
    max: number,
  ): RowValidator<T> {
    return (row, _index) => {
      const val = row[field as string];
      if (typeof val === 'string' && val.length > max) {
        return [{ field: field as string, message: `${String(field)} exceeds max length of ${max}` }];
      }
      return null;
    };
  }
}
