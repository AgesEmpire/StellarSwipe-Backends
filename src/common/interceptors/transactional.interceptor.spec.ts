import { Test } from '@nestjs/testing';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, throwError } from 'rxjs';
import { QueryRunner } from 'typeorm';
import { TransactionalInterceptor } from './transactional.interceptor';
import { TRANSACTIONAL_KEY } from '../decorators/transactional.decorator';

describe('TransactionalInterceptor', () => {
  let interceptor: TransactionalInterceptor;
  let reflector: Reflector;
  let tenantConnectionProvider: any;
  let queryRunner: Partial<QueryRunner>;
  let dataSource: any;

  beforeEach(async () => {
    queryRunner = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      isTransactionActive: true,
    };

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    tenantConnectionProvider = {
      getDataSource: jest.fn().mockResolvedValue(dataSource),
    };

    reflector = {
      getAllAndOverride: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [TransactionalInterceptor],
    })
      .overrideProvider('TenantConnectionProvider')
      .useValue(tenantConnectionProvider)
      .compile();

    interceptor = module.get<TransactionalInterceptor>(
      TransactionalInterceptor,
    );
    (interceptor as any).reflector = reflector;
  });

  it('should pass through when @Transactional is not applied', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);

    const mockHandler: CallHandler = {
      handle: jest.fn().mockReturnValue(of({ result: 'success' })),
    };

    const result = await interceptor.intercept(
      {} as ExecutionContext,
      mockHandler,
    );

    expect(mockHandler.handle).toHaveBeenCalled();
    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
  });

  it('should wrap handler in transaction when @Transactional is applied', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);

    const mockHandler: CallHandler = {
      handle: jest.fn().mockReturnValue(of({ result: 'success' })),
    };

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;

    await interceptor.intercept(context, mockHandler);

    expect(queryRunner.startTransaction).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('should rollback on handler error', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);

    const error = new Error('Handler failed');
    const mockHandler: CallHandler = {
      handle: jest.fn().mockReturnValue(throwError(() => error)),
    };

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;

    const observable = await interceptor.intercept(context, mockHandler);

    expect(observable).toBeDefined();
    expect(queryRunner.startTransaction).toHaveBeenCalled();
  });

  it('should release query runner on completion', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);

    const mockHandler: CallHandler = {
      handle: jest.fn().mockReturnValue(of({ result: 'success' })),
    };

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;

    await interceptor.intercept(context, mockHandler);

    expect(queryRunner.release).toHaveBeenCalled();
  });
});
