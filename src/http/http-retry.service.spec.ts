import * as http from 'http';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpModule, HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { HttpRetryService } from './http-retry.service';
import { ProviderConcurrencyService } from './provider-concurrency.service';
import { RetryBudgetService } from './retry-budget.service';
import { BulkheadRejectedError } from '../stellar/bulkhead/bulkhead';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function axiosError(status: number, message = `HTTP ${status}`) {
  const err: any = new Error(message);
  err.response = { status };
  return err;
}

function axios429WithRetryAfter(retryAfter: string) {
  const err: any = new Error('HTTP 429');
  err.response = { status: 429, headers: { 'retry-after': retryAfter } };
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

describe('HttpRetryService — per-provider concurrency limits (Issue #1235)', () => {
  let service: HttpRetryService;
  let providerConcurrency: ProviderConcurrencyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HttpRetryService,
        ProviderConcurrencyService,
        { provide: HttpService, useValue: {} },
      ],
    }).compile();

    service = module.get(HttpRetryService);
    providerConcurrency = module.get(ProviderConcurrencyService);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
  });

  it('runs each attempt inside the named provider limit', async () => {
    const executeSpy = jest.spyOn(providerConcurrency, 'execute');
    const fn = jest
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValue('ok');

    await expect(
      service.executeWithRetry(fn, 'label', {
        provider: 'coingecko',
        maxAttempts: 2,
      }),
    ).resolves.toBe('ok');
    expect(executeSpy).toHaveBeenCalledTimes(2);
    expect(executeSpy).toHaveBeenCalledWith('coingecko', fn);
  });

  it('does not use a provider limit when no provider is named', async () => {
    const executeSpy = jest.spyOn(providerConcurrency, 'execute');
    await service.executeWithRetry(jest.fn().mockResolvedValue('ok'));
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('fails fast without retrying when the provider is saturated', async () => {
    jest
      .spyOn(providerConcurrency, 'execute')
      .mockRejectedValue(new BulkheadRejectedError('coingecko'));
    const fn = jest.fn();

    await expect(
      service.executeWithRetry(fn, 'label', {
        provider: 'coingecko',
        maxAttempts: 3,
      }),
    ).rejects.toBeInstanceOf(BulkheadRejectedError);
    expect(providerConcurrency.execute).toHaveBeenCalledTimes(1);
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

// ---------------------------------------------------------------------------
// Per-provider rate-limit (429) response handling (Issue #1374)
// ---------------------------------------------------------------------------

describe('HttpRetryService — per-provider rate limit response handling (Issue #1374)', () => {
  let service: HttpRetryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HttpRetryService, { provide: HttpService, useValue: {} }],
    }).compile();
    service = module.get(HttpRetryService);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.OUTBOUND_COINGECKO_MAX_RETRY_AFTER_MS;
    delete process.env.OUTBOUND_DEFAULT_MAX_RETRY_AFTER_MS;
  });

  it('computeDelay() honours a Retry-After header (seconds form) over exponential backoff', () => {
    const opts = { baseDelayMs: 500, maxDelayMs: 10_000, jitter: false, maxAttempts: 3, retryableStatuses: [429] };
    const delay = service.computeDelay(1, opts, axios429WithRetryAfter('7'));
    expect(delay).toBe(7000);
  });

  it('computeDelay() clamps a Retry-After hint to the provider-configured cap', () => {
    process.env.OUTBOUND_COINGECKO_MAX_RETRY_AFTER_MS = '2000';
    const opts = { baseDelayMs: 500, maxDelayMs: 10_000, jitter: false, maxAttempts: 3, retryableStatuses: [429] };
    const delay = service.computeDelay(1, opts, axios429WithRetryAfter('60'), 'coingecko');
    expect(delay).toBe(2000);
  });

  it('computeDelay() falls back to exponential backoff when 429 has no Retry-After header', () => {
    const opts = { baseDelayMs: 500, maxDelayMs: 10_000, jitter: false, maxAttempts: 3, retryableStatuses: [429] };
    const delay = service.computeDelay(2, opts, axiosError(429));
    expect(delay).toBe(1000); // unaffected — same as plain exponential backoff
  });

  it('computeDelay() ignores Retry-After for non-429 errors', () => {
    const opts = { baseDelayMs: 500, maxDelayMs: 10_000, jitter: false, maxAttempts: 3, retryableStatuses: [503] };
    const err: any = axiosError(503);
    err.response.headers = { 'retry-after': '99' };
    const delay = service.computeDelay(1, opts, err);
    expect(delay).toBe(500);
  });

  it('executeWithRetry() sleeps for the Retry-After duration on a 429 and then succeeds', async () => {
    const sleepSpy = jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    const fn = jest
      .fn()
      .mockRejectedValueOnce(axios429WithRetryAfter('3'))
      .mockResolvedValueOnce('ok');

    const result = await service.executeWithRetry(fn, 'test', { provider: 'coingecko' });

    expect(result).toBe('ok');
    expect(sleepSpy).toHaveBeenCalledWith(3000);
  });

  it('still fails immediately for permanent (non-retryable) errors even with provider set', async () => {
    const fn = jest.fn().mockRejectedValue(axiosError(404));
    await expect(
      service.executeWithRetry(fn, 'test', { provider: 'coingecko', maxAttempts: 3 }),
    ).rejects.toThrow('HTTP 404');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Shared retry budgets to prevent retry storms (Issue #1376)
// ---------------------------------------------------------------------------

describe('HttpRetryService — shared retry budget (Issue #1376)', () => {
  let service: HttpRetryService;
  let retryBudget: RetryBudgetService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HttpRetryService,
        RetryBudgetService,
        { provide: HttpService, useValue: {} },
      ],
    }).compile();
    service = module.get(HttpRetryService);
    retryBudget = module.get(RetryBudgetService);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((retryBudget as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  it('retries normally while the shared budget has tokens', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(axiosError(503))
      .mockResolvedValueOnce('ok');

    await expect(
      service.executeWithRetry(fn, 'test', { provider: 'coingecko', maxAttempts: 5 }),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('fails fast once the shared retry budget for a provider is exhausted', async () => {
    // Drain the budget for "coingecko" directly.
    for (let i = 0; i < 10; i++) {
      retryBudget.tryConsume('coingecko');
    }

    const fn = jest
      .fn()
      .mockRejectedValueOnce(axiosError(503))
      .mockResolvedValueOnce('ok');

    await expect(
      service.executeWithRetry(fn, 'test', { provider: 'coingecko', maxAttempts: 5 }),
    ).rejects.toThrow('HTTP 503');
    // Only the first attempt ran — the retry was denied by the exhausted budget.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('isolates retry budgets per provider — one exhausted provider does not affect another', async () => {
    for (let i = 0; i < 10; i++) {
      retryBudget.tryConsume('coingecko');
    }

    const fn = jest
      .fn()
      .mockRejectedValueOnce(axiosError(503))
      .mockResolvedValueOnce('ok');

    await expect(
      service.executeWithRetry(fn, 'test', { provider: 'stellar-expert', maxAttempts: 3 }),
    ).resolves.toBe('ok');
  });

  it('shares a single "default" budget across calls with no provider specified', async () => {
    for (let i = 0; i < 10; i++) {
      retryBudget.tryConsume('default');
    }

    const fn = jest
      .fn()
      .mockRejectedValueOnce(axiosError(503))
      .mockResolvedValueOnce('ok');

    await expect(
      service.executeWithRetry(fn, 'test', { maxAttempts: 3 }),
    ).rejects.toThrow('HTTP 503');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('works unchanged when no RetryBudgetService is provided (optional dependency)', async () => {
    const bareModule: TestingModule = await Test.createTestingModule({
      providers: [HttpRetryService, { provide: HttpService, useValue: {} }],
    }).compile();
    const bareService = bareModule.get(HttpRetryService);
    jest.spyOn((bareService as any).logger, 'error').mockImplementation(() => {});
    jest.spyOn((bareService as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn(bareService as any, 'sleep').mockResolvedValue(undefined);

    const fn = jest
      .fn()
      .mockRejectedValueOnce(axiosError(503))
      .mockResolvedValueOnce('ok');

    await expect(bareService.executeWithRetry(fn, 'test')).resolves.toBe('ok');
  });
});
