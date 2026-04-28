import { TracingService, TracingMiddleware, TRACE_ID_HEADER } from '../src/tracing/tracing.service';
import { ConfigService as NestConfigService } from '@nestjs/config';

const makeConfig = () => ({ get: jest.fn() } as unknown as NestConfigService);

const makeReqRes = (existingTraceId?: string) => {
  const req: any = { headers: {}, method: 'GET', path: '/health' };
  if (existingTraceId) req.headers[TRACE_ID_HEADER] = existingTraceId;
  const res: any = { setHeader: jest.fn() };
  const next = jest.fn();
  return { req, res, next };
};

describe('TracingService (#367)', () => {
  afterEach(() => {
    delete process.env.TRACING_ENABLED;
    delete process.env.TRACING_SERVICE_NAME;
  });

  it('isEnabled is true when TRACING_ENABLED=true', () => {
    process.env.TRACING_ENABLED = 'true';
    expect(new TracingService(makeConfig()).isEnabled).toBe(true);
  });

  it('isEnabled is false when TRACING_ENABLED is absent', () => {
    expect(new TracingService(makeConfig()).isEnabled).toBe(false);
  });

  it('fromRequest() extracts trace ID from header', () => {
    const svc = new TracingService(makeConfig());
    const req: any = { headers: { [TRACE_ID_HEADER]: 'abc-123' } };
    expect(svc.fromRequest(req)).toBe('abc-123');
  });

  it('fromRequest() returns undefined when header is absent', () => {
    const svc = new TracingService(makeConfig());
    expect(svc.fromRequest({ headers: {} } as any)).toBeUndefined();
  });

  it('outboundHeaders() includes trace ID and service name', () => {
    process.env.TRACING_SERVICE_NAME = 'my-service';
    const svc = new TracingService(makeConfig());
    const headers = svc.outboundHeaders('trace-xyz');
    expect(headers[TRACE_ID_HEADER]).toBe('trace-xyz');
    expect(headers['x-service-name']).toBe('my-service');
  });

  it('serviceName falls back to default', () => {
    expect(new TracingService(makeConfig()).serviceName).toBe('stellarswipe-backend');
  });
});

describe('TracingMiddleware (#367)', () => {
  afterEach(() => {
    delete process.env.TRACING_ENABLED;
  });

  it('propagates an existing trace ID from the request header', () => {
    process.env.TRACING_ENABLED = 'true';
    const svc = new TracingService(makeConfig());
    const mw = new TracingMiddleware(svc);
    const { req, res, next } = makeReqRes('existing-id');

    mw.use(req, res, next);

    expect(req.headers[TRACE_ID_HEADER]).toBe('existing-id');
    expect(res.setHeader).toHaveBeenCalledWith(TRACE_ID_HEADER, 'existing-id');
    expect(next).toHaveBeenCalled();
  });

  it('generates a UUID v4 when no trace ID is present', () => {
    process.env.TRACING_ENABLED = 'true';
    const svc = new TracingService(makeConfig());
    const mw = new TracingMiddleware(svc);
    const { req, res, next } = makeReqRes();

    mw.use(req, res, next);

    const traceId = req.headers[TRACE_ID_HEADER] as string;
    expect(traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(res.setHeader).toHaveBeenCalledWith(TRACE_ID_HEADER, traceId);
    expect(next).toHaveBeenCalled();
  });

  it('skips tracing and calls next() when TRACING_ENABLED is false', () => {
    const svc = new TracingService(makeConfig());
    const mw = new TracingMiddleware(svc);
    const { req, res, next } = makeReqRes();

    mw.use(req, res, next);

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(req.headers[TRACE_ID_HEADER]).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('assigns unique trace IDs to concurrent requests', () => {
    process.env.TRACING_ENABLED = 'true';
    const svc = new TracingService(makeConfig());
    const mw = new TracingMiddleware(svc);
    const r1 = makeReqRes();
    const r2 = makeReqRes();

    mw.use(r1.req, r1.res, r1.next);
    mw.use(r2.req, r2.res, r2.next);

    expect(r1.req.headers[TRACE_ID_HEADER]).not.toBe(r2.req.headers[TRACE_ID_HEADER]);
  });
});
