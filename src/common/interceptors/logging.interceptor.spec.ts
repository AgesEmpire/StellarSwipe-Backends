import { Test, TestingModule } from '@nestjs/testing';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';
import { LoggerService } from '../logger';
import { CorrelationIdStore } from '../correlation/correlation-id.store';

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let logger: { info: jest.Mock; error: jest.Mock; setContext: jest.Mock };
  let correlationIdStore: { getCorrelationId: jest.Mock };

  const buildExecutionContext = (request: any, response: any): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    logger = { info: jest.fn(), error: jest.fn(), setContext: jest.fn() };
    correlationIdStore = { getCorrelationId: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoggingInterceptor,
        { provide: LoggerService, useValue: logger },
        { provide: CorrelationIdStore, useValue: correlationIdStore },
      ],
    }).compile();

    interceptor = module.get<LoggingInterceptor>(LoggingInterceptor);
  });

  it('logs the incoming request with the correlation ID from the store', (done) => {
    correlationIdStore.getCorrelationId.mockReturnValue('corr-123');
    const request = {
      method: 'GET',
      url: '/api/v1/signals',
      query: {},
      params: {},
      get: () => 'jest-agent',
      ip: '127.0.0.1',
    };
    const response = { statusCode: 200 };
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    interceptor.intercept(buildExecutionContext(request, response), handler).subscribe(() => {
      expect(logger.info).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({ correlationId: 'corr-123', method: 'GET', url: '/api/v1/signals' }),
      );
      done();
    });
  });

  it('includes userId in logs when the request is authenticated', (done) => {
    correlationIdStore.getCorrelationId.mockReturnValue('corr-123');
    const request = {
      method: 'GET',
      url: '/api/v1/portfolio',
      query: {},
      params: {},
      get: () => 'jest-agent',
      ip: '127.0.0.1',
      user: { id: 'user-42' },
    };
    const response = { statusCode: 200 };
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    interceptor.intercept(buildExecutionContext(request, response), handler).subscribe(() => {
      expect(logger.info).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({ userId: 'user-42' }),
      );
      done();
    });
  });

  it('logs request completion with status code and latency', (done) => {
    correlationIdStore.getCorrelationId.mockReturnValue('corr-456');
    const request = {
      method: 'POST',
      url: '/api/v1/trades',
      query: {},
      params: {},
      get: () => 'jest-agent',
      ip: '127.0.0.1',
    };
    const response = { statusCode: 201 };
    const handler: CallHandler = { handle: () => of({ id: 1 }) };

    interceptor.intercept(buildExecutionContext(request, response), handler).subscribe(() => {
      expect(logger.info).toHaveBeenCalledWith(
        'Request completed',
        expect.objectContaining({
          correlationId: 'corr-456',
          statusCode: 201,
          duration: expect.stringMatching(/^\d+ms$/),
        }),
      );
      done();
    });
  });

  it('logs request failures with the same correlation ID', (done) => {
    correlationIdStore.getCorrelationId.mockReturnValue('corr-789');
    const request = {
      method: 'POST',
      url: '/api/v1/trades',
      query: {},
      params: {},
      get: () => 'jest-agent',
      ip: '127.0.0.1',
    };
    const response = { statusCode: 500 };
    const error = new Error('boom');
    const handler: CallHandler = { handle: () => throwError(() => error) };

    interceptor.intercept(buildExecutionContext(request, response), handler).subscribe({
      error: (err) => {
        expect(err).toBe(error);
        expect(logger.error).toHaveBeenCalledWith(
          'Request failed',
          error,
          expect.objectContaining({ correlationId: 'corr-789' }),
        );
        done();
      },
    });
  });
});
