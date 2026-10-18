import { RetryBudgetService } from './retry-budget.service';

describe('RetryBudgetService', () => {
  let service: RetryBudgetService;

  beforeEach(() => {
    service = new RetryBudgetService();
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('allows retries up to the configured capacity', () => {
    for (let i = 0; i < 5; i++) {
      expect(service.tryConsume('provider-a', { capacity: 5, refillPerSecond: 0 })).toBe(true);
    }
  });

  it('denies a retry once the budget is exhausted', () => {
    for (let i = 0; i < 3; i++) {
      service.tryConsume('provider-b', { capacity: 3, refillPerSecond: 0 });
    }
    expect(service.tryConsume('provider-b', { capacity: 3, refillPerSecond: 0 })).toBe(false);
  });

  it('isolates budgets per key', () => {
    for (let i = 0; i < 3; i++) {
      service.tryConsume('provider-c', { capacity: 3, refillPerSecond: 0 });
    }
    expect(service.tryConsume('provider-c', { capacity: 3, refillPerSecond: 0 })).toBe(false);
    // A different key has its own, untouched budget.
    expect(service.tryConsume('provider-d', { capacity: 3, refillPerSecond: 0 })).toBe(true);
  });

  it('refills tokens over time at the configured rate', () => {
    jest.useFakeTimers().setSystemTime(0);
    for (let i = 0; i < 4; i++) {
      service.tryConsume('provider-e', { capacity: 4, refillPerSecond: 2 });
    }
    expect(service.tryConsume('provider-e', { capacity: 4, refillPerSecond: 2 })).toBe(false);

    // 1 second later, 2 tokens/sec should have refilled.
    jest.setSystemTime(1000);
    expect(service.getTokens('provider-e', { capacity: 4, refillPerSecond: 2 })).toBeCloseTo(2, 5);
    expect(service.tryConsume('provider-e', { capacity: 4, refillPerSecond: 2 })).toBe(true);
    expect(service.tryConsume('provider-e', { capacity: 4, refillPerSecond: 2 })).toBe(true);
    expect(service.tryConsume('provider-e', { capacity: 4, refillPerSecond: 2 })).toBe(false);

    jest.useRealTimers();
  });

  it('never refills past capacity', () => {
    jest.useFakeTimers().setSystemTime(0);
    service.tryConsume('provider-f', { capacity: 2, refillPerSecond: 10 });
    jest.setSystemTime(100_000); // way more than enough to overflow
    expect(service.getTokens('provider-f', { capacity: 2, refillPerSecond: 10 })).toBe(2);
    jest.useRealTimers();
  });

  it('reset() restores a key to full capacity', () => {
    service.tryConsume('provider-g', { capacity: 1, refillPerSecond: 0 });
    expect(service.tryConsume('provider-g', { capacity: 1, refillPerSecond: 0 })).toBe(false);
    service.reset('provider-g');
    expect(service.tryConsume('provider-g', { capacity: 1, refillPerSecond: 0 })).toBe(true);
  });
});
