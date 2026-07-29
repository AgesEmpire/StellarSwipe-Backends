// Mock the tracing.service module to avoid the pre-existing class-ordering TDZ
// issue in tracing.service.ts (TracingMiddleware declared before TracingService).
jest.mock('../src/tracing/tracing.service', () => {
  const TRACE_ID_HEADER = 'x-trace-id';

  class TracingService {
    get isEnabled(): boolean { return false; }
    get serviceName(): string { return 'stellarswipe-backend'; }
    fromRequest(_req: any) { return undefined; }
    outboundHeaders(traceId: string) { return { [TRACE_ID_HEADER]: traceId }; }
    log(_traceId: string, _message: string) {}
  }

  class TracingMiddleware {
    constructor(private readonly tracingService: TracingService) {}
    use(_req: any, _res: any, next: () => void) { next(); }
  }

  return { TracingService, TracingMiddleware, TRACE_ID_HEADER };
});

import { TracingService, TRACE_ID_HEADER } from '../src/tracing/tracing.service';
import { WorkerTracingService, WORKER_TRACE_ID_KEY } from '../src/tracing/worker-tracing.service';

// ── helpers ──────────────────────────────────────────────────────────────────

const makeJob = (data: Record<string, unknown> = {}, name = 'test-job') =>
  ({
    id: 'job-1',
    name,
    data,
    queue: { name: 'test-queue' },
  }) as any;

const makeTracingService = (enabled: boolean): TracingService => {
  const svc = new (TracingService as any)();
  jest.spyOn(svc, 'isEnabled', 'get').mockReturnValue(enabled);
  jest.spyOn(svc, 'log').mockImplementation(() => undefined);
  return svc;
};

// ── WorkerTracingService ──────────────────────────────────────────────────────

describe('WorkerTracingService', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('start()', () => {
    it('returns empty string when tracing is disabled', () => {
      const svc = new WorkerTracingService(makeTracingService(false));
      expect(svc.start(makeJob())).toBe('');
    });

    it('propagates traceId from job.data[WORKER_TRACE_ID_KEY]', () => {
      const ts = makeTracingService(true);
      const svc = new WorkerTracingService(ts);
      const job = makeJob({ [WORKER_TRACE_ID_KEY]: 'existing-trace' });

      const traceId = svc.start(job);

      expect(traceId).toBe('existing-trace');
      expect(ts.log).toHaveBeenCalledWith(
        'existing-trace',
        expect.stringContaining('worker:start'),
      );
    });

    it('propagates traceId from legacy x-trace-id key in job data', () => {
      const ts = makeTracingService(true);
      const svc = new WorkerTracingService(ts);
      const job = makeJob({ [TRACE_ID_HEADER]: 'http-trace' });

      expect(svc.start(job)).toBe('http-trace');
    });

    it('generates a UUID v4 when no trace ID is present in job data', () => {
      const ts = makeTracingService(true);
      const svc = new WorkerTracingService(ts);

      const traceId = svc.start(makeJob());

      expect(traceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('assigns unique trace IDs to concurrent jobs without a pre-set ID', () => {
      const ts = makeTracingService(true);
      const svc = new WorkerTracingService(ts);

      const id1 = svc.start(makeJob());
      const id2 = svc.start(makeJob());

      expect(id1).not.toBe(id2);
    });

    it('logs the queue name and job id on start', () => {
      const ts = makeTracingService(true);
      const svc = new WorkerTracingService(ts);
      const job = makeJob({ [WORKER_TRACE_ID_KEY]: 'trace-abc' });

      svc.start(job);

      expect(ts.log).toHaveBeenCalledWith(
        'trace-abc',
        expect.stringContaining('test-queue'),
      );
      expect(ts.log).toHaveBeenCalledWith(
        'trace-abc',
        expect.stringContaining('job-1'),
      );
    });
  });

  describe('finish()', () => {
    it('is a no-op when tracing is disabled', () => {
      const ts = makeTracingService(false);
      const svc = new WorkerTracingService(ts);
      svc.finish('trace-id', makeJob());
      expect(ts.log).not.toHaveBeenCalled();
    });

    it('is a no-op when traceId is empty', () => {
      const ts = makeTracingService(true);
      const svc = new WorkerTracingService(ts);
      svc.finish('', makeJob());
      expect(ts.log).not.toHaveBeenCalled();
    });

    it('logs finish with trace ID and job details', () => {
      const ts = makeTracingService(true);
      const svc = new WorkerTracingService(ts);

      svc.finish('trace-xyz', makeJob());

      expect(ts.log).toHaveBeenCalledWith(
        'trace-xyz',
        expect.stringContaining('worker:finish'),
      );
    });
  });

  describe('error()', () => {
    it('is a no-op when tracing is disabled', () => {
      const ts = makeTracingService(false);
      const svc = new WorkerTracingService(ts);
      const logSpy = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
      svc.error('trace-id', makeJob(), new Error('boom'));
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('is a no-op when traceId is empty', () => {
      const ts = makeTracingService(true);
      const svc = new WorkerTracingService(ts);
      const logSpy = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
      svc.error('', makeJob(), new Error('boom'));
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('logs the error message with trace ID', () => {
      const ts = makeTracingService(true);
      const svc = new WorkerTracingService(ts);
      const logSpy = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);

      svc.error('trace-err', makeJob(), new Error('something went wrong'));

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('trace-err'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('something went wrong'),
      );
    });
  });

  describe('injectTraceId()', () => {
    it('merges traceId into the payload without mutating the original', () => {
      const ts = makeTracingService(true);
      const svc = new WorkerTracingService(ts);
      const original = { userId: 'u1' };

      const result = svc.injectTraceId(original, 'trace-inject');

      expect(result[WORKER_TRACE_ID_KEY]).toBe('trace-inject');
      expect(result['userId']).toBe('u1');
      expect(original).not.toHaveProperty(WORKER_TRACE_ID_KEY);
    });

    it('overwrites an existing traceId in the payload', () => {
      const ts = makeTracingService(true);
      const svc = new WorkerTracingService(ts);
      const payload = { [WORKER_TRACE_ID_KEY]: 'old-trace' };

      const result = svc.injectTraceId(payload, 'new-trace');

      expect(result[WORKER_TRACE_ID_KEY]).toBe('new-trace');
    });
  });
});
