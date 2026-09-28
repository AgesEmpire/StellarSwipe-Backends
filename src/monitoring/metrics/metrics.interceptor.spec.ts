import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { MetricsInterceptor } from './metrics.interceptor';
import { PrometheusService } from './prometheus.service';

/**
 * Issue #1076 — RED metrics for HTTP handlers.
 *
 * Uses a real PrometheusService (backed by an isolated prom-client Registry)
 * so the metric names/labels asserted here are exactly what a Prometheus
 * scrape of GET /metrics would return in production, not a re-implementation
 * of the interceptor's own logic.
 */
function makePrometheus(): PrometheusService {
  // PrometheusService only touches the DataSource inside onModuleInit
  // (a setInterval poll), which this test never calls.
  const fakeDataSource = { query: jest.fn() } as unknown as DataSource;
  return new PrometheusService(fakeDataSource);
}

function makeContext(
  routePath: string,
  rawPath: string,
  method = 'GET',
): { context: ExecutionContext; res: { statusCode: number } } {
  const req = { method, path: rawPath, route: { path: routePath } };
  const res = { statusCode: 200 };

  const context = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;

  return { context, res };
}

function successHandler(body: unknown = { ok: true }): CallHandler {
  return { handle: () => of(body) } as unknown as CallHandler;
}

function errorHandler(err: unknown): CallHandler {
  return { handle: () => throwError(() => err) } as unknown as CallHandler;
}

async function run(interceptor: MetricsInterceptor, context: ExecutionContext, handler: CallHandler): Promise<void> {
  await new Promise<void>((resolve) => {
    interceptor.intercept(context, handler).subscribe({
      next: () => undefined,
      error: () => resolve(),
      complete: () => resolve(),
    });
  });
}

function metricValue(
  prometheus: PrometheusService,
  name: string,
  labels: Record<string, string>,
): number | undefined {
  const metric = prometheus.registry.getMetricsAsJSON().find((m: any) => m.name === name) as any;
  const entry = metric?.values.find((v: any) =>
    Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  );
  return entry?.value;
}

describe('MetricsInterceptor (#1076)', () => {
  let prometheus: PrometheusService;
  let interceptor: MetricsInterceptor;

  beforeEach(() => {
    prometheus = makePrometheus();
    interceptor = new MetricsInterceptor(prometheus);
  });

  it('records http_requests_total and http_request_duration_seconds for a successful request', async () => {
    const { context, res } = makeContext('/signals', '/signals', 'GET');
    res.statusCode = 200;

    await run(interceptor, context, successHandler());

    const labels = { method: 'GET', route: '/signals', status_code: '200' };
    expect(metricValue(prometheus, 'http_requests_total', labels)).toBe(1);

    const durationMetric = prometheus.registry
      .getMetricsAsJSON()
      .find((m: any) => m.name === 'http_request_duration_seconds') as any;
    const countEntry = durationMetric.values.find(
      (v: any) =>
        v.metricName === 'http_request_duration_seconds_count' &&
        v.labels.method === 'GET' &&
        v.labels.route === '/signals' &&
        v.labels.status_code === '200',
    );
    expect(countEntry?.value).toBe(1);

    // Successful requests must not increment the error counter.
    expect(metricValue(prometheus, 'http_requests_errors_total', labels)).toBeUndefined();
  });

  it('records http_requests_total and http_requests_errors_total for a failed request', async () => {
    const { context } = makeContext('/trades', '/trades', 'POST');

    await run(interceptor, context, errorHandler({ status: 422, message: 'Unprocessable' }));

    const labels = { method: 'POST', route: '/trades', status_code: '422' };
    expect(metricValue(prometheus, 'http_requests_total', labels)).toBe(1);
    expect(metricValue(prometheus, 'http_requests_errors_total', labels)).toBe(1);
  });

  it('defaults to status_code 500 when a thrown error has no status', async () => {
    const { context } = makeContext('/trades', '/trades', 'POST');

    await run(interceptor, context, errorHandler(new Error('boom')));

    const labels = { method: 'POST', route: '/trades', status_code: '500' };
    expect(metricValue(prometheus, 'http_requests_errors_total', labels)).toBe(1);
  });

  it('labels metrics with the normalized route template, not the raw URL', async () => {
    // Nest/Express resolves req.route.path to the matched route pattern
    // ("/users/:id") even though the raw request URL contains a real ID.
    const { context } = makeContext('/users/:id', '/users/123', 'GET');

    await run(interceptor, context, successHandler());

    const templateLabels = { method: 'GET', route: '/users/:id', status_code: '200' };
    const rawLabels = { method: 'GET', route: '/users/123', status_code: '200' };

    expect(metricValue(prometheus, 'http_requests_total', templateLabels)).toBe(1);
    expect(metricValue(prometheus, 'http_requests_total', rawLabels)).toBeUndefined();
  });

  it('falls back to req.path when req.route is unavailable, without leaking query strings', async () => {
    const req = { method: 'GET', path: '/watchlist', route: undefined };
    const res = { statusCode: 200 };
    const context = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext;

    await run(interceptor, context, successHandler());

    const labels = { method: 'GET', route: '/watchlist', status_code: '200' };
    expect(metricValue(prometheus, 'http_requests_total', labels)).toBe(1);
  });

  it('does not instrument the health endpoint to avoid recursive metrics noise', async () => {
    const { context } = makeContext('/api/v1/health', '/api/v1/health', 'GET');

    await run(interceptor, context, successHandler());

    const metric = prometheus.registry
      .getMetricsAsJSON()
      .find((m: any) => m.name === 'http_requests_total') as any;
    const anyHealthEntry = metric?.values.some((v: any) => String(v.labels.route).includes('/health'));
    expect(anyHealthEntry).toBeFalsy();
  });

  it('does not instrument the metrics endpoint to avoid recursive metrics noise', async () => {
    const { context } = makeContext('/api/v1/metrics', '/api/v1/metrics', 'GET');

    await run(interceptor, context, successHandler());

    const metric = prometheus.registry
      .getMetricsAsJSON()
      .find((m: any) => m.name === 'http_requests_total') as any;
    const anyMetricsEntry = metric?.values.some((v: any) => String(v.labels.route).includes('/metrics'));
    expect(anyMetricsEntry).toBeFalsy();
  });
});
