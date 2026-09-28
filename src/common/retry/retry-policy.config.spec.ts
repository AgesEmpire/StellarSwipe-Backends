import { resolveRetryPolicy } from './retry-policy.config';

const ENV_KEYS = [
  'RETRY_DEFAULT_MAX_ATTEMPTS',
  'RETRY_DEFAULT_BASE_DELAY_MS',
  'RETRY_DEFAULT_MAX_DELAY_MS',
  'RETRY_DEFAULT_JITTER',
  'RETRY_COINMARKETCAP_MAX_ATTEMPTS',
  'RETRY_COINMARKETCAP_BASE_DELAY_MS',
  'RETRY_ONFIDO_MAX_ATTEMPTS',
];

describe('resolveRetryPolicy', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env = { ...originalEnv };
  });

  it('falls back to hard-coded defaults when no env vars are set', () => {
    const policy = resolveRetryPolicy('coinmarketcap');
    expect(policy).toEqual({
      maxAttempts: 4,
      baseDelayMs: 200,
      maxDelayMs: 10_000,
      jitter: 'full',
    });
  });

  it('applies RETRY_DEFAULT_* overrides to every integration', () => {
    process.env.RETRY_DEFAULT_MAX_ATTEMPTS = '6';
    process.env.RETRY_DEFAULT_JITTER = 'none';

    expect(resolveRetryPolicy('coinmarketcap').maxAttempts).toBe(6);
    expect(resolveRetryPolicy('onfido').maxAttempts).toBe(6);
    expect(resolveRetryPolicy('onfido').jitter).toBe('none');
  });

  it('applies an integration-specific override on top of the shared default (per-integration configurability)', () => {
    process.env.RETRY_DEFAULT_MAX_ATTEMPTS = '6';
    process.env.RETRY_COINMARKETCAP_MAX_ATTEMPTS = '2';

    expect(resolveRetryPolicy('coinmarketcap').maxAttempts).toBe(2);
    // Other integrations still see the shared default, not the override.
    expect(resolveRetryPolicy('onfido').maxAttempts).toBe(6);
  });

  it('normalizes integration names (case + separators) when reading env vars', () => {
    process.env.RETRY_COINMARKETCAP_BASE_DELAY_MS = '50';
    expect(resolveRetryPolicy('CoinMarketCap').baseDelayMs).toBe(50);
    expect(resolveRetryPolicy('coin-market-cap').baseDelayMs).toBe(50);
  });

  it('ignores unparsable numeric env values and falls back to defaults', () => {
    process.env.RETRY_ONFIDO_MAX_ATTEMPTS = 'not-a-number';
    expect(resolveRetryPolicy('onfido').maxAttempts).toBe(4);
  });
});
