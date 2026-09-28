import * as http from 'http';
import { Test, TestingModule } from '@nestjs/testing';
import { RetryExhaustedError, RetryPolicyService } from './retry-policy.service';

// Keep tests fast and deterministic: no jitter, 1ms delays regardless of
// integration-name env overrides.
const FAST_POLICY = { baseDelayMs: 1, maxDelayMs: 1, jitter: 'none' as const };

describe('RetryPolicyService', () => {
  let service: RetryPolicyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RetryPolicyService],
    }).compile();

    service = module.get(RetryPolicyService);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  describe('timeout errors', () => {
    it('retries a timeout and succeeds once the transient failure clears', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce({ code: 'ETIMEDOUT' })
        .mockResolvedValueOnce('ok');

      const result = await service.execute('test-integration', fn, {
        ...FAST_POLICY,
        maxAttempts: 3,
      });

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('rate-limit (429) errors', () => {
    it('retries a 429 and honors the Retry-After header delay', async () => {
      const sleepSpy = jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
      const fn = jest
        .fn()
        .mockRejectedValueOnce({ response: { status: 429, headers: { 'retry-after': '3' } } })
        .mockResolvedValueOnce('ok');

      const result = await service.execute('test-integration', fn, {
        ...FAST_POLICY,
        maxAttempts: 3,
      });

      expect(result).toBe('ok');
      expect(sleepSpy).toHaveBeenCalledWith(3000);
    });
  });

  describe('temporary server errors (5xx)', () => {
    it('retries repeated 503s and eventually succeeds', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce({ status: 503 })
        .mockRejectedValueOnce({ status: 503 })
        .mockResolvedValueOnce('ok');

      const result = await service.execute('test-integration', fn, {
        ...FAST_POLICY,
        maxAttempts: 4,
      });

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws RetryExhaustedError once max attempts are used up on a persistent 5xx', async () => {
      const fn = jest.fn().mockRejectedValue({ status: 500 });

      await expect(
        service.execute('test-integration', fn, { ...FAST_POLICY, maxAttempts: 3 }),
      ).rejects.toThrow(RetryExhaustedError);
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('non-retryable errors', () => {
    it('rethrows a 4xx client error immediately without retrying', async () => {
      const fn = jest.fn().mockRejectedValue({ status: 400 });

      await expect(
        service.execute('test-integration', fn, { ...FAST_POLICY, maxAttempts: 3 }),
      ).rejects.toEqual({ status: 400 });
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('per-integration configurability', () => {
    it('respects an override maxAttempts of 1 (no retries at all)', async () => {
      const fn = jest.fn().mockRejectedValue({ status: 503 });

      await expect(
        service.execute('single-attempt-integration', fn, { ...FAST_POLICY, maxAttempts: 1 }),
      ).rejects.toThrow(RetryExhaustedError);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('idempotency-aware retries (Issue #1061)', () => {
    it('retries a transient failure when method is omitted (preserves existing GET caller behavior)', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce({ status: 503 })
        .mockResolvedValueOnce('ok');

      const result = await service.execute('test-integration', fn, {
        ...FAST_POLICY,
        maxAttempts: 3,
      });

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries a transient failure when method is explicitly GET', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce({ status: 503 })
        .mockResolvedValueOnce('ok');

      const result = await service.execute(
        'test-integration',
        fn,
        { ...FAST_POLICY, maxAttempts: 3 },
        'GET',
      );

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry a transient failure when method is POST (non-idempotent)', async () => {
      const fn = jest.fn().mockRejectedValue({ status: 503 });

      await expect(
        service.execute('test-integration', fn, { ...FAST_POLICY, maxAttempts: 3 }, 'POST'),
      ).rejects.toEqual({ status: 503 });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry a transient failure when method is PATCH (non-idempotent)', async () => {
      const fn = jest.fn().mockRejectedValue({ status: 503 });

      await expect(
        service.execute('test-integration', fn, { ...FAST_POLICY, maxAttempts: 3 }, 'PATCH'),
      ).rejects.toEqual({ status: 503 });
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});

describe('RetryPolicyService — stub server integration (Issue #1061)', () => {
  let server: http.Server;
  let service: RetryPolicyService;

  afterEach(() => {
    if (server) server.close();
  });

  async function startServer(handler: http.RequestListener): Promise<string> {
    server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return `http://127.0.0.1:${port}`;
  }

  function getJson(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      http
        .get(url, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              const err: any = new Error(`HTTP ${res.statusCode}`);
              err.status = res.statusCode;
              reject(err);
            } else {
              resolve({ status: res.statusCode ?? 0, body });
            }
          });
        })
        .on('error', reject);
    });
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RetryPolicyService],
    }).compile();

    service = module.get(RetryPolicyService);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  it('retries a real HTTP GET against a flaky server and eventually succeeds', async () => {
    let requestCount = 0;
    const baseUrl = await startServer((req, res) => {
      requestCount++;
      if (requestCount < 3) {
        res.writeHead(503);
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    });

    const result = await service.execute(
      'stub-server-test',
      () => getJson(baseUrl),
      { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 50, jitter: 'none' },
      'GET',
    );

    expect(JSON.parse(result.body)).toEqual({ ok: true });
    expect(requestCount).toBe(3);
  }, 10_000);
});
