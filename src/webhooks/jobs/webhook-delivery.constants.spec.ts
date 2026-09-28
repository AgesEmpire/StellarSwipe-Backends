import {
  WEBHOOK_BACKOFF_CAP_MS,
  WEBHOOK_BACKOFF_JITTER_MS,
  WEBHOOK_BACKOFF_STRATEGY,
  WEBHOOK_DELIVERY_JOB_OPTIONS,
  WEBHOOK_MAX_ATTEMPTS,
  calculateWebhookBackoffDelay,
  webhookDeliveryBackoffStrategy,
} from './webhook-delivery.constants';

describe('webhook delivery backoff constants', () => {
  it.each([
    [1, 2000],
    [2, 4000],
    [3, 8000],
    [4, 16000],
    [5, 32000],
    [6, 64000],
    [7, 64000],
    [8, 64000],
  ])(
    'calculates min(2^%i * 1000, 64000) plus deterministic jitter',
    (attempt, baseDelay) => {
      expect(calculateWebhookBackoffDelay(attempt, 250)).toBe(baseDelay + 250);
    },
  );

  it('normalizes attempts below one to the first retry delay', () => {
    expect(calculateWebhookBackoffDelay(0, 0)).toBe(2000);
    expect(calculateWebhookBackoffDelay(-4, 0)).toBe(2000);
  });

  it('clamps jitter to the configured zero-to-one-second range', () => {
    expect(calculateWebhookBackoffDelay(2, -100)).toBe(4000);
    expect(
      calculateWebhookBackoffDelay(2, WEBHOOK_BACKOFF_JITTER_MS + 500),
    ).toBe(4000 + WEBHOOK_BACKOFF_JITTER_MS);
  });

  it('caps exponential delay before adding jitter', () => {
    expect(calculateWebhookBackoffDelay(12, 999)).toBe(
      WEBHOOK_BACKOFF_CAP_MS + 999,
    );
  });

  it('exposes a BullMQ custom strategy using the same calculation', () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.123);

    expect(webhookDeliveryBackoffStrategy(3)).toBe(8123);

    randomSpy.mockRestore();
  });

  it('configures BullMQ jobs for eight attempts with the custom strategy', () => {
    expect(WEBHOOK_DELIVERY_JOB_OPTIONS).toEqual(
      expect.objectContaining({
        attempts: WEBHOOK_MAX_ATTEMPTS,
        backoff: { type: WEBHOOK_BACKOFF_STRATEGY },
      }),
    );
  });
});
