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
});
