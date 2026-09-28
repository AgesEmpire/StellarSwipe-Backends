import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

/**
 * Wraps a critical multi-step DB write flow in a single ACID transaction so
 * that a failure partway through rolls back all prior operations instead of
 * leaving the database in a partially-updated state.
 */
@Injectable()
export class AtomicTransactionHelper {
  constructor(private readonly dataSource: DataSource) {}

  async run<T>(work: (queryRunner: QueryRunner) => Promise<T>): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const result = await work(queryRunner);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
