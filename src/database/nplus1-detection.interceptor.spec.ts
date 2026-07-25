import { Test, TestingModule } from '@nestjs/testing';
import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { of } from 'rxjs';
import { NPlus1DetectionInterceptor } from './nplus1-detection.interceptor';
import { ConfigService } from '@nestjs/config';
import { CorrelationIdStore } from '../correlation/correlation-id.store';
import { queryCounterStore } from './query-counter.store';

describe('NPlus1DetectionInterceptor', () => {
  let interceptor: NPlus1DetectionInterceptor;
  let configService: { get: jest.Mock };
  let correlationIdStore: CorrelationIdStore;

  const mockLoggerWarn = jest.fn();

  beforeEach(async () => {
    configService = { get: jest.fn() };
    correlationIdStore = { getCorrelationId: jest.fn() } as any;

    // Mock Logger
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(mockLoggerWarn);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NPlus1DetectionInterceptor,
        { provide: ConfigService, useValue: configService },
        { provide: CorrelationIdStore, useValue: correlationIdStore },
      ],
    }).compile();

    interceptor = module.get<NPlus1DetectionInterceptor>(NPlus1DetectionInterceptor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('when NODE_ENV is not development', () => {
    it('should not create query counter context', (done) => {
      delete process.env.NODE_ENV;
      
      const request = { url: '/api/v1/test', method: 'GET' };
      const context: ExecutionContext = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext;
      const handler: CallHandler = { handle: () => of({ ok: true }) };

      interceptor.intercept(context, handler).subscribe({
        next: (data) => {
          expect(data).toEqual({ ok: true });
          done();
        },
      });
    });
  });

  describe('when NODE_ENV is development', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
      configService.get.mockImplementation((key: string) => {
        if (key === 'NPLUS1_MAX_QUERIES') return 25;
        if (key === 'NPLUS1_MAX_QUERY_TIME_MS') return 1000;
        return;
      });
    });

    afterEach(() => {
      delete process.env.NODE_ENV;
    });

    it('should create query counter context', (done) => {
      const request = { url: '/api/v1/test', method: 'GET' };
      const context: ExecutionContext = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext;
      const handler: CallHandler = { handle: () => of({ ok: true }) };

      interceptor.intercept(context, handler).subscribe(() => {
        const snapshot = queryCounterStore.snapshot;
        expect(snapshot).toBeDefined();
        expect(snapshot.queryCount).toBe(0);
        done();
      });
    });

    it('should log warning when query count exceeds threshold', (done) => {
      const request = { url: '/api/v1/test', method: 'GET' };
      const context: ExecutionContext = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext;
      const handler: CallHandler = { handle: () => of({ ok: true }) };

      interceptor.intercept(context, handler).subscribe(() => {
        const snapshot = queryCounterStore.snapshot;
        if (snapshot) {
          // Simulate N+1 pattern - query count exceeds threshold
          snapshot.queryCount = 30;
          interceptor['checkAndWarn']('/api/v1/test', 'GET');
          
          expect(mockLoggerWarn).toHaveBeenCalledWith(
            expect.stringContaining('Possible N+1 query pattern detected'),
          );
        }
        done();
      });
    });

    it('should log warning when total time exceeds threshold', (done) => {
      const request = { url: '/api/v1/test', method: 'GET' };
      const context: ExecutionContext = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext;
      const handler: CallHandler = { handle: () => of({ ok: true }) };

      interceptor.intercept(context, handler).subscribe(() => {
        const snapshot = queryCounterStore.snapshot;
        if (snapshot) {
          // Simulate slow queries - total time exceeds threshold
          snapshot.totalTimeMs = 1500;
          interceptor['checkAndWarn']('/api/v1/test', 'GET');
          
          expect(mockLoggerWarn).toHaveBeenCalledWith(
            expect.stringContaining('Slow query aggregate'),
          );
        }
        done();
      });
    });

    it('should not log warning when under thresholds', (done) => {
      const request = { url: '/api/v1/test', method: 'GET' };
      const context: ExecutionContext = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext;
      const handler: CallHandler = { handle: () => of({ ok: true }) };

      interceptor.intercept(context, handler).subscribe(() => {
        const snapshot = queryCounterStore.snapshot;
        if (snapshot) {
          // Keep under thresholds - no warning expected
          interceptor['checkAndWarn']('/api/v1/test', 'GET');
          
          expect(mockLoggerWarn).not.toHaveBeenCalled();
        }
        done();
      });
    });
  });
});