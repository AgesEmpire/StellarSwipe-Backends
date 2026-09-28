import { Test, TestingModule } from '@nestjs/testing';
import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { of } from 'rxjs';
import { NPlus1DetectionInterceptor } from './nplus1-detection.interceptor';
import { ConfigService } from '@nestjs/config';
import { CorrelationIdStore } from '../correlation/correlation-id.store';
import { queryCounterStore } from './query-counter.store';

describe('NPlus1DetectionInterceptor – Regression', () => {
  let interceptor: NPlus1DetectionInterceptor;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  const configValues: Record<string, any> = {
    NPLUS1_MAX_QUERIES: 25,
    NPLUS1_MAX_QUERY_TIME_MS: 1000,
    NPLUS1_LOG_IN_PRODUCTION: false,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NPlus1DetectionInterceptor,
        {
          provide: ConfigService,
          useValue: { get: (key: string, def?: any) => configValues[key] ?? def },
        },
        {
          provide: CorrelationIdStore,
          useValue: { getCorrelationId: () => 'test-id' },
        },
      ],
    }).compile();

    interceptor = module.get(NPlus1DetectionInterceptor);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.NODE_ENV;
  });

  function makeContext(url = '/api/v1/signals', method = 'GET'): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ url, method }),
      }),
      getHandler: () => ({}),
    } as any;
  }

  it('should trigger N+1 warning when query count exceeds threshold', (done) => {
    const handler: CallHandler = {
      handle: () => {
        // Simulate 30 queries within the request lifecycle
        for (let i = 0; i < 30; i++) {
          queryCounterStore.increment(1, 10);
        }
        return of({ data: 'ok' });
      },
    };

    interceptor.intercept(makeContext(), handler).subscribe({
      complete: () => {
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('N+1 query pattern detected'),
        );
        done();
      },
    });
  });

  it('should not warn when query count is within threshold', (done) => {
    const handler: CallHandler = {
      handle: () => {
        for (let i = 0; i < 5; i++) {
          queryCounterStore.increment(1, 50);
        }
        return of({ data: 'ok' });
      },
    };

    interceptor.intercept(makeContext(), handler).subscribe({
      complete: () => {
        expect(warnSpy).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('should warn on slow aggregate even under query count threshold', (done) => {
    const handler: CallHandler = {
      handle: () => {
        // 10 queries, each 150ms = 1500ms total > 1000ms threshold
        for (let i = 0; i < 10; i++) {
          queryCounterStore.increment(1, 150);
        }
        return of({ data: 'ok' });
      },
    };

    interceptor.intercept(makeContext('/api/v1/trades'), handler).subscribe({
      complete: () => {
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Slow query aggregate'),
        );
        done();
      },
    });
  });

  it('should report as error in production when logInProduction is true', (done) => {
    process.env.NODE_ENV = 'production';
    configValues.NPLUS1_LOG_IN_PRODUCTION = true;

    const handler: CallHandler = {
      handle: () => {
        for (let i = 0; i < 30; i++) {
          queryCounterStore.increment(1, 10);
        }
        return of({ data: 'ok' });
      },
    };

    interceptor.intercept(makeContext(), handler).subscribe({
      complete: () => {
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('N+1 query pattern detected'),
          undefined,
          'NPlus1Detection',
        );
        done();
      },
    });
  });

  it('should not report in production when logInProduction is false', (done) => {
    process.env.NODE_ENV = 'production';
    configValues.NPLUS1_LOG_IN_PRODUCTION = false;

    const handler: CallHandler = {
      handle: () => {
        for (let i = 0; i < 30; i++) {
          queryCounterStore.increment(1, 10);
        }
        return of({ data: 'ok' });
      },
    };

    interceptor.intercept(makeContext(), handler).subscribe({
      complete: () => {
        expect(warnSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
        done();
      },
    });
  });
});
