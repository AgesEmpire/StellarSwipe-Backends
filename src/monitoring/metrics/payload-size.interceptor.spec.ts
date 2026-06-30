import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { Registry } from 'prom-client';
import { PayloadSizeInterceptor } from './payload-size.interceptor';
import { PrometheusService } from './prometheus.service';

function makePrometheus(): PrometheusService {
  const registry = new Registry();
  return { registry } as unknown as PrometheusService;
}

function makeContext(
  contentLength: string | undefined,
  path = '/api/v1/test',
  method = 'POST',
): ExecutionContext {
  const headers: Record<string, string> = {};
  if (contentLength !== undefined) {
    headers['content-length'] = contentLength;
  }

  const req = { method, path, route: { path }, headers };
  const chunks: Buffer[] = [];

  const res = {
    write(chunk: any) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end(chunk?: any) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return this;
    },
  };

  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

function makeHandler(responseBody = '{"ok":true}'): CallHandler {
  return {
    handle: () =>
      of(responseBody).pipe(),
  } as unknown as CallHandler;
}

describe('PayloadSizeInterceptor', () => {
  let interceptor: PayloadSizeInterceptor;
  let prometheus: PrometheusService;

  beforeEach(() => {
    prometheus = makePrometheus();
    interceptor = new PayloadSizeInterceptor(prometheus);
  });

  it('registers http_request_body_bytes and http_response_body_bytes histograms', async () => {
    const names = prometheus.registry.getMetricsAsJSON().map((m: any) => m.name);
    expect(names).toContain('http_request_body_bytes');
    expect(names).toContain('http_response_body_bytes');
  });

  it('records request body size from Content-Length header', async () => {
    const ctx = makeContext('512');
    const handler = makeHandler();

    await new Promise<void>((resolve) => {
      interceptor.intercept(ctx, handler).subscribe({ complete: resolve });
    });

    const metrics = prometheus.registry.getMetricsAsJSON();
    const reqMetric = metrics.find((m: any) => m.name === 'http_request_body_bytes');
    const sum = (reqMetric as any).values.find((v: any) =>
      v.metricName === 'http_request_body_bytes_sum',
    );
    expect(sum?.value).toBe(512);
  });

  it('defaults request size to 0 when Content-Length is absent', async () => {
    const ctx = makeContext(undefined);
    const handler = makeHandler();

    await new Promise<void>((resolve) => {
      interceptor.intercept(ctx, handler).subscribe({ complete: resolve });
    });

    const metrics = prometheus.registry.getMetricsAsJSON();
    const reqMetric = metrics.find((m: any) => m.name === 'http_request_body_bytes');
    const sum = (reqMetric as any).values.find((v: any) =>
      v.metricName === 'http_request_body_bytes_sum',
    );
    expect(sum?.value).toBe(0);
  });

  it('records response body size matching actual payload', async () => {
    const responseBody = JSON.stringify({ data: 'hello world' });
    const expectedBytes = Buffer.byteLength(responseBody, 'utf8');

    const ctx = makeContext('0', '/api/v1/items', 'GET');
    const res = ctx.switchToHttp().getResponse() as any;

    const handler: CallHandler = {
      handle: () =>
        of(null).pipe(),
    } as unknown as CallHandler;

    await new Promise<void>((resolve) => {
      interceptor.intercept(ctx, handler).subscribe({
        next: () => {
          // Simulate framework writing the serialized response
          res.end(responseBody);
        },
        complete: resolve,
      });
    });

    const metrics = prometheus.registry.getMetricsAsJSON();
    const resMetric = metrics.find((m: any) => m.name === 'http_response_body_bytes');
    const sum = (resMetric as any).values.find((v: any) =>
      v.metricName === 'http_response_body_bytes_sum',
    );
    expect(sum?.value).toBe(expectedBytes);
  });
});
