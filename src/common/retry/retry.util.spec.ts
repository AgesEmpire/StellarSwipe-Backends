import {
  computeBackoffDelayMs,
  extractRetryAfterMs,
  isIdempotentMethod,
  isPermanentJobError,
  isRetryableError,
  PermanentError,
  RetryableError,
} from './retry.util';

describe('isRetryableError', () => {
  it('treats connection timeouts as retryable', () => {
    expect(isRetryableError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isRetryableError({ code: 'ECONNABORTED' })).toBe(true);
    expect(isRetryableError({ code: 'ECONNRESET' })).toBe(true);
  });

  it('treats named timeout/abort errors as retryable', () => {
    expect(isRetryableError({ name: 'TimeoutError' })).toBe(true);
    expect(isRetryableError({ name: 'AbortError' })).toBe(true);
  });

  it('treats HTTP 429 rate limiting as retryable', () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ response: { status: 429 } })).toBe(true);
  });

  it('treats 5xx server errors as retryable', () => {
    expect(isRetryableError({ status: 500 })).toBe(true);
    expect(isRetryableError({ statusCode: 503 })).toBe(true);
    expect(isRetryableError({ response: { status: 502 } })).toBe(true);
  });

  it('does not treat 4xx client errors (other than 429) as retryable', () => {
    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError({ status: 401 })).toBe(false);
    expect(isRetryableError({ status: 404 })).toBe(false);
  });

  it('does not treat unrecognized errors as retryable', () => {
    expect(isRetryableError(new Error('validation failed'))).toBe(false);
    expect(isRetryableError({})).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});

describe('extractRetryAfterMs', () => {
  it('parses a delay-seconds Retry-After header', () => {
    const ms = extractRetryAfterMs({ response: { headers: { 'retry-after': '2' } } });
    expect(ms).toBe(2000);
  });

  it('parses an HTTP-date Retry-After header', () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = extractRetryAfterMs({ response: { headers: { 'retry-after': future } } });
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(5000);
  });

  it('returns undefined when no header is present', () => {
    expect(extractRetryAfterMs({ response: { headers: {} } })).toBeUndefined();
    expect(extractRetryAfterMs({})).toBeUndefined();
  });

  it('returns undefined for an unparsable header value', () => {
    const ms = extractRetryAfterMs({ response: { headers: { 'retry-after': 'not-a-date' } } });
    expect(ms).toBeUndefined();
  });
});

describe('computeBackoffDelayMs', () => {
  it('doubles the base delay per attempt with jitter disabled', () => {
    expect(computeBackoffDelayMs(1, 100, 10_000, 'none')).toBe(100);
    expect(computeBackoffDelayMs(2, 100, 10_000, 'none')).toBe(200);
    expect(computeBackoffDelayMs(3, 100, 10_000, 'none')).toBe(400);
    expect(computeBackoffDelayMs(4, 100, 10_000, 'none')).toBe(800);
  });

  it('caps the delay at maxDelayMs', () => {
    expect(computeBackoffDelayMs(10, 100, 1_000, 'none')).toBe(1_000);
  });

  it('applies full jitter within [0, cappedDelay]', () => {
    const samples = Array.from({ length: 50 }, () =>
      computeBackoffDelayMs(3, 100, 10_000, 'full'),
    );
    for (const sample of samples) {
      expect(sample).toBeGreaterThanOrEqual(0);
      expect(sample).toBeLessThan(400); // base(100) * 2^2 = 400
    }
    // With jitter enabled, repeated calls should not all collapse to the
    // same value (extremely unlikely across 50 samples if jitter works).
    expect(new Set(samples).size).toBeGreaterThan(1);
  });
});

describe('isPermanentJobError (Issue #1075)', () => {
  it('honors an explicit PermanentError marker', () => {
    expect(isPermanentJobError(new PermanentError('will never work'))).toBe(true);
  });

  it('honors an explicit RetryableError marker even if the message looks permanent', () => {
    expect(isPermanentJobError(new RetryableError('validation failed but retry anyway'))).toBe(
      false,
    );
  });

  it.each([
    'Unauthorized request',
    'Forbidden resource',
    'Not found',
    'Validation failed: amount',
    'Invalid input provided',
  ])('classifies "%s" as permanent', (message) => {
    expect(isPermanentJobError(new Error(message))).toBe(true);
  });

  it('classifies a non-429 4xx status as permanent', () => {
    expect(isPermanentJobError({ status: 400 })).toBe(true);
    expect(isPermanentJobError({ statusCode: 404 })).toBe(true);
  });

  it('classifies 429 and 5xx statuses as retryable (not permanent)', () => {
    expect(isPermanentJobError({ status: 429 })).toBe(false);
    expect(isPermanentJobError({ status: 503 })).toBe(false);
  });

  it('defaults an unrecognized/generic error to retryable — jobs assume transient unless proven otherwise', () => {
    expect(isPermanentJobError(new Error('connection reset'))).toBe(false);
    expect(isPermanentJobError(new Error('boom'))).toBe(false);
    expect(isPermanentJobError({})).toBe(false);
  });
});

describe('isIdempotentMethod', () => {
  it.each(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'])(
    'treats %s as idempotent',
    (method) => {
      expect(isIdempotentMethod(method)).toBe(true);
    },
  );

  it.each(['get', 'head', 'put', 'delete', 'options'])(
    'is case-insensitive for %s',
    (method) => {
      expect(isIdempotentMethod(method)).toBe(true);
    },
  );

  it.each(['POST', 'PATCH'])('treats %s as non-idempotent', (method) => {
    expect(isIdempotentMethod(method)).toBe(false);
  });

  it('treats an unknown/omitted method as idempotent (preserves prior behavior)', () => {
    expect(isIdempotentMethod(undefined)).toBe(true);
  });
});
