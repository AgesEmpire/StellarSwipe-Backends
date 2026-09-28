import * as http from 'http';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpModule, HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { HttpRetryService } from './http-retry.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function axiosError(status: number, message = `HTTP ${status}`) {
  const err: any = new Error(message);
  err.response = { status };
  return err;
}

function networkError(code = 'ECONNRESET') {
  const err: any = new Error(code);
  err.code = code;
  // No err.response — simulates a network-level failure
  return err;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HttpRetryService', () => {
  let service: HttpRetryService;
  let httpService: jest.Mocked<HttpService>;

  beforeEach(async () => {
    httpService = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HttpRetryService,
        { provide: HttpService, useValue: httpService },
      ],
    }).compile();

    service = module.get<HttpRetryService>(HttpRetryService);

    // Suppress logger output in tests
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});

    // Make sleep a no-op so tests run instantly
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // get()
  // -------------------------------------------------------------------------

  describe('get()', () => {
    it('returns response on first successful attempt', async () => {
      const mockResponse = { data: { price: 1.5 }, status: 200 };
      httpService.get.mockReturnValue(of(mockResponse as any));

      const result = await service.get('https://api.example.com/price');

      expect(result).toEqual(mockResponse);
      expect(httpService.get).toHaveBeenCalledTimes(1);
    });

    it('retries on 503 and succeeds on second attempt', async () => {
      const mockResponse = { data: { price: 1.5 }, status: 200 };
      httpService.get
        .mockReturnValueOnce(throwError(() => axiosError(503)))
        .mockReturnValueOnce(of(mockResponse as any));

      const result = await service.get('https://api.example.com/price');

      expect(result).toEqual(mockResponse);
      expect(httpService.get).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all attempts', async () => {
      httpService.get.mockReturnValue(throwError(() => axiosError(503)));

      await expect(
        service.get('https://api.example.com/price', {}, { maxAttempts: 3 }),
      ).rejects.toThrow('HTTP 503');

      expect(httpService.get).toHaveBeenCalledTimes(3);
    });
  });

  // -------------------------------------------------------------------------
  // post()
  // -------------------------------------------------------------------------

  describe('post()', () => {
    it('does NOT retry on 502 by default (POST is non-idempotent)', async () => {
      httpService.post.mockReturnValueOnce(throwError(() => axiosError(502)));

      await expect(
        service.post('https://api.example.com/data', { x: 1 }),
      ).rejects.toThrow('HTTP 502');

      expect(httpService.post).toHaveBeenCalledTimes(1);
    });

    it('retries on 502 when caller explicitly opts in via idempotent: true', async () => {
      const mockResponse = { data: { ok: true }, status: 200 };
      httpService.post
        .mockReturnValueOnce(throwError(() => axiosError(502)))
        .mockReturnValueOnce(of(mockResponse as any));

      const result = await service.post(
        'https://api.example.com/data',
        { x: 1 },
        {},
        { idempotent: true },
      );

      expect(result).toEqual(mockResponse);
      expect(httpService.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('put()', () => {
    it('retries on 503 by default (PUT is idempotent)', async () => {
      const mockResponse = { data: { ok: true }, status: 200 };
      httpService.put
        .mockReturnValueOnce(throwError(() => axiosError(503)))
        .mockReturnValueOnce(of(mockResponse as any));

      const result = await service.put('https://api.example.com/data', { x: 1 });

      expect(result).toEqual(mockResponse);
      expect(httpService.put).toHaveBeenCalledTimes(2);
    });
  });

  describe('patch()', () => {
    it('does NOT retry on 503 by default (PATCH is non-idempotent)', async () => {
      httpService.patch.mockReturnValueOnce(throwError(() => axiosError(503)));

      await expect(
        service.patch('https://api.example.com/data', { x: 1 }),
      ).rejects.toThrow('HTTP 503');

      expect(httpService.patch).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // executeWithRetry()
  // -------------------------------------------------------------------------

  describe('executeWithRetry()', () => {
    it('does NOT retry on 400 Bad Request (non-transient)', async () => {
      const fn = jest.fn().mockRejectedValue(axiosError(400));

      await expect(
        service.executeWithRetry(fn, 'test', { maxAttempts: 3 }),
      ).rejects.toThrow('HTTP 400');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on 401 Unauthorized (preserves auth semantics)', async () => {
      const fn = jest.fn().mockRejectedValue(axiosError(401));

      await expect(
        service.executeWithRetry(fn, 'test', { maxAttempts: 3 }),
      ).rejects.toThrow('HTTP 401');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on 403 Forbidden (preserves auth semantics)', async () => {
      const fn = jest.fn().mockRejectedValue(axiosError(403));

      await expect(
        service.executeWithRetry(fn, 'test', { maxAttempts: 3 }),
      ).rejects.toThrow('HTTP 403');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on 429 Too Many Requests', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(axiosError(429))
        .mockResolvedValueOnce({ data: 'ok' });

      const result = await service.executeWithRetry(fn, 'test');

      expect(result).toEqual({ data: 'ok' });
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries on network-level error (no response)', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(networkError('ECONNRESET'))
        .mockResolvedValueOnce({ data: 'ok' });

      const result = await service.executeWithRetry(fn, 'test');

      expect(result).toEqual({ data: 'ok' });
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries on ETIMEDOUT network error', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(networkError('ETIMEDOUT'))
        .mockResolvedValueOnce({ data: 'ok' });

      const result = await service.executeWithRetry(fn, 'test');

      expect(result).toEqual({ data: 'ok' });
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('respects maxAttempts option', async () => {
      const fn = jest.fn().mockRejectedValue(axiosError(500));

      await expect(
        service.executeWithRetry(fn, 'test', { maxAttempts: 5 }),
      ).rejects.toThrow();

      expect(fn).toHaveBeenCalledTimes(5);
    });

    it('uses custom retryableStatuses', async () => {
      // 404 is not retryable by default, but we add it here
      const fn = jest
        .fn()
        .mockRejectedValueOnce(axiosError(404))
        .mockResolvedValueOnce({ data: 'ok' });

      const result = await service.executeWithRetry(fn, 'test', {
        retryableStatuses: [404, 500],
      });

      expect(result).toEqual({ data: 'ok' });
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries a retryable status when idempotent is not specified (unchanged default)', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(axiosError(503))
        .mockResolvedValueOnce({ data: 'ok' });

      const result = await service.executeWithRetry(fn, 'test');

      expect(result).toEqual({ data: 'ok' });
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry a retryable status when idempotent: false is set, even for a retryable status code', async () => {
      const fn = jest.fn().mockRejectedValue(axiosError(503));

      await expect(
        service.executeWithRetry(fn, 'test', { idempotent: false, maxAttempts: 5 }),
      ).rejects.toThrow('HTTP 503');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries a retryable status when idempotent: true is explicitly set', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(axiosError(503))
        .mockResolvedValueOnce({ data: 'ok' });

      const result = await service.executeWithRetry(fn, 'test', { idempotent: true });

      expect(result).toEqual({ data: 'ok' });
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // isRetryableError()
  // -------------------------------------------------------------------------

  describe('isRetryableError()', () => {
    const retryable = [429, 500, 502, 503, 504];

    it.each([429, 500, 502, 503, 504])(
      'returns true for status %i',
      (status) => {
        expect(service.isRetryableError(axiosError(status), retryable)).toBe(true);
      },
    );

    it.each([400, 401, 403, 404, 422])(
      'returns false for status %i',
      (status) => {
        expect(service.isRetryableError(axiosError(status), retryable)).toBe(false);
      },
    );

    it('returns true for network errors (no response)', () => {
      expect(service.isRetryableError(networkError(), retryable)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // computeDelay()
  // -------------------------------------------------------------------------

  describe('computeDelay()', () => {
    const opts = {
      baseDelayMs: 500,
      maxDelayMs: 10_000,
      jitter: false,
      maxAttempts: 3,
      retryableStatuses: [],
    };

    it('doubles delay on each attempt (exponential backoff)', () => {
      expect(service.computeDelay(1, opts)).toBe(500);   // 500 * 2^0
      expect(service.computeDelay(2, opts)).toBe(1000);  // 500 * 2^1
      expect(service.computeDelay(3, opts)).toBe(2000);  // 500 * 2^2
    });

    it('caps delay at maxDelayMs', () => {
      expect(service.computeDelay(10, opts)).toBe(10_000);
    });

    it('applies jitter within ±20% of computed delay', () => {
      const jitterOpts = { ...opts, jitter: true };
      for (let i = 0; i < 20; i++) {
        const delay = service.computeDelay(1, jitterOpts); // base = 500
        expect(delay).toBeGreaterThanOrEqual(400);  // 500 * 0.8
        expect(delay).toBeLessThanOrEqual(600);     // 500 * 1.2
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Stub-server integration tests (Issue #1061)
//
// The suites above mock HttpService entirely, so they never exercise real
// network timing (timeouts, actual inter-attempt delays). These tests spin
// up a real local HTTP server via Node's built-in `http` module and drive a
// real HttpService/axios client against it.
// ---------------------------------------------------------------------------

describe('HttpRetryService — stub server integration (Issue #1061)', () => {
  let server: http.Server;
  let service: HttpRetryService;

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

  async function buildService(): Promise<HttpRetryService> {
    const moduleRef = await Test.createTestingModule({
      imports: [HttpModule.register({ timeout: 500 })],
      providers: [HttpRetryService],
    }).compile();
    return moduleRef.get(HttpRetryService);
  }

  it('enforces a finite timeout against a hanging server', async () => {
    const baseUrl = await startServer(() => {
      // never respond — simulates a hung upstream
    });
    service = await buildService();
    await expect(service.get(baseUrl, {}, { maxAttempts: 1 })).rejects.toThrow();
  }, 10_000);

  it('retries a GET on 503 with growing backoff delay, then succeeds', async () => {
    let requestCount = 0;
    const timestamps: number[] = [];
    const baseUrl = await startServer((req, res) => {
      timestamps.push(Date.now());
      requestCount++;
      if (requestCount < 3) {
        res.writeHead(503);
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    });
    service = await buildService();
    const response = await service.get(
      baseUrl,
      {},
      {
        maxAttempts: 5,
        baseDelayMs: 50,
        jitter: false,
      },
    );
    expect(response.data).toEqual({ ok: true });
    expect(requestCount).toBe(3);
    // second gap should be roughly double the first (exponential backoff),
    // allow generous slack for CI jitter/scheduling noise
    const gap1 = timestamps[1] - timestamps[0];
    const gap2 = timestamps[2] - timestamps[1];
    expect(gap2).toBeGreaterThan(gap1 * 1.3);
  }, 10_000);

  it('does NOT retry a POST on 503 by default (non-idempotent)', async () => {
    let requestCount = 0;
    const baseUrl = await startServer((req, res) => {
      requestCount++;
      res.writeHead(503);
      res.end();
    });
    service = await buildService();
    await expect(
      service.post(baseUrl, { amount: 1 }, {}, { maxAttempts: 5, baseDelayMs: 10 }),
    ).rejects.toThrow();
    expect(requestCount).toBe(1); // no retries happened
  }, 10_000);
});
