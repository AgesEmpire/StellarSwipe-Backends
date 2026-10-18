import { parseRetryAfterMs, resolveMaxRetryAfterMs } from './rate-limit-response.config';

describe('parseRetryAfterMs()', () => {
  it('parses a delay-seconds value', () => {
    expect(parseRetryAfterMs('120')).toBe(120_000);
  });

  it('parses an HTTP-date value relative to now', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const future = new Date(Date.now() + 5000).toUTCString();
    expect(parseRetryAfterMs(future)).toBe(5000);
    jest.useRealTimers();
  });

  it('clamps a past HTTP-date to 0 rather than negative', () => {
    const past = new Date(Date.now() - 5000).toUTCString();
    expect(parseRetryAfterMs(past)).toBe(0);
  });

  it('returns undefined for missing or unparsable values', () => {
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs('not-a-value')).toBeUndefined();
  });

  it('takes the first value when given an array (duplicate headers)', () => {
    expect(parseRetryAfterMs(['30', '60'])).toBe(30_000);
  });
});

describe('resolveMaxRetryAfterMs()', () => {
  const ENV_KEYS = [
    'OUTBOUND_COINGECKO_MAX_RETRY_AFTER_MS',
    'OUTBOUND_DEFAULT_MAX_RETRY_AFTER_MS',
  ];

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('falls back to the hard-coded default when unset', () => {
    expect(resolveMaxRetryAfterMs('coingecko')).toBe(30_000);
  });

  it('honours a provider-specific override', () => {
    process.env.OUTBOUND_COINGECKO_MAX_RETRY_AFTER_MS = '5000';
    expect(resolveMaxRetryAfterMs('coingecko')).toBe(5000);
  });

  it('falls back to the shared default override when no provider-specific one is set', () => {
    process.env.OUTBOUND_DEFAULT_MAX_RETRY_AFTER_MS = '15000';
    expect(resolveMaxRetryAfterMs('some-other-provider')).toBe(15000);
  });

  it('throws when the configured value is invalid', () => {
    process.env.OUTBOUND_COINGECKO_MAX_RETRY_AFTER_MS = 'not-a-number';
    expect(() => resolveMaxRetryAfterMs('coingecko')).toThrow();
  });
});
