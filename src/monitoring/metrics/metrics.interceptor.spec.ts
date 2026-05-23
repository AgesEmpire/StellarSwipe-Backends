import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { MetricsInterceptor } from './metrics.interceptor';

const mockObserve = jest.fn();
const mockPrometheus = { observeHttpRequest: mockObserve } as any;

function makeContext(method: string, path: string, routePath?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, path, route: routePath ? { path: routePath } : undefined }),
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as any;
}

function makeHandler(obs = of(null)): CallHandler {
  return { handle: () => obs } as any;
}

describe('MetricsInterceptor', () => {
  let interceptor: MetricsInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new MetricsInterceptor(mockPrometheus);
  });

  it('calls observeHttpRequest after a successful response', (done) => {
    const ctx = makeContext('GET', '/api/v1/trades', '/api/v1/trades');
    interceptor.intercept(ctx, makeHandler()).subscribe({
      complete: () => {
        expect(mockObserve).toHaveBeenCalledTimes(1);
        const [method, route, status, duration, serviceType] = mockObserve.mock.calls[0];
        expect(method).toBe('GET');
        expect(route).toBe('/api/v1/trades');
        expect(status).toBe(200);
        expect(duration).toBeGreaterThanOrEqual(0);
        expect(serviceType).toBe('trades');
        done();
      },
    });
  });

  it('calls observeHttpRequest with error status on exception', (done) => {
    const ctx = makeContext('POST', '/api/v1/auth/login');
    const err = Object.assign(new Error('bad'), { status: 401 });

    interceptor.intercept(ctx, makeHandler(throwError(() => err))).subscribe({
      error: () => {
        expect(mockObserve).toHaveBeenCalledWith('POST', '/api/v1/auth/login', 401, expect.any(Number), 'auth');
        done();
      },
    });
  });

  it('falls back to 500 when error has no status', (done) => {
    const ctx = makeContext('GET', '/api/v1/signals');
    interceptor.intercept(ctx, makeHandler(throwError(() => new Error('boom')))).subscribe({
      error: () => {
        const [, , status] = mockObserve.mock.calls[0];
        expect(status).toBe(500);
        done();
      },
    });
  });

  it('resolves service_type=health for /health paths', (done) => {
    const ctx = makeContext('GET', '/health/readiness');
    interceptor.intercept(ctx, makeHandler()).subscribe({
      complete: () => {
        const [, , , , serviceType] = mockObserve.mock.calls[0];
        expect(serviceType).toBe('health');
        done();
      },
    });
  });

  it('defaults service_type to api for unknown paths', (done) => {
    const ctx = makeContext('GET', '/some/unknown/path');
    interceptor.intercept(ctx, makeHandler()).subscribe({
      complete: () => {
        const [, , , , serviceType] = mockObserve.mock.calls[0];
        expect(serviceType).toBe('api');
        done();
      },
    });
  });
});
