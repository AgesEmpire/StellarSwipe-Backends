import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { QueryRunner } from 'typeorm';
import { TRANSACTIONAL_KEY } from '../decorators/transactional.decorator';

@Injectable()
export class TransactionalInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject('TenantConnectionProvider')
    private readonly tenantConnectionProvider: any,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const isTransactional = this.reflector.getAllAndOverride<boolean>(
      TRANSACTIONAL_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!isTransactional) {
      return next.handle();
    }

    let queryRunner: QueryRunner | null = null;

    try {
      const dataSource = await this.tenantConnectionProvider.getDataSource();
      queryRunner = dataSource.createQueryRunner();

      await queryRunner.startTransaction();

      return next.handle().pipe(
        catchError(async (error) => {
          if (queryRunner && queryRunner.isTransactionActive) {
            await queryRunner.rollbackTransaction();
          }
          throw error;
        }),
        finalize(async () => {
          if (queryRunner) {
            if (queryRunner.isTransactionActive) {
              await queryRunner.commitTransaction();
            }
            await queryRunner.release();
          }
        }),
      );
    } catch (error) {
      if (queryRunner) {
        if (queryRunner.isTransactionActive) {
          await queryRunner.rollbackTransaction();
        }
        await queryRunner.release();
      }
      throw error;
    }
  }
}
