import { ProviderConcurrencyService } from './provider-concurrency.service';
import { resolveProviderConcurrency } from './provider-concurrency.config';
import { BulkheadRejectedError } from '../stellar/bulkhead/bulkhead';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const ENV_KEYS = [
  'OUTBOUND_DEFAULT_MAX_CONCURRENT',
  'OUTBOUND_DEFAULT_MAX_QUEUE',
  'OUTBOUND_COINGECKO_MAX_CONCURRENT',
  'OUTBOUND_COINGECKO_MAX_QUEUE',
  'OUTBOUND_STELLAR_EXPERT_MAX_CONCURRENT',
];

describe('resolveProviderConcurrency', () => {
  afterEach(() => ENV_KEYS.forEach((key) => delete process.env[key]));

  it('falls back to the built-in defaults', () => {
    expect(resolveProviderConcurrency('coingecko')).toEqual({
      maxConcurrent: 10,
      maxQueue: 50,
    });
  });

  it('prefers provider-specific overrides over the shared defaults', () => {
    process.env.OUTBOUND_DEFAULT_MAX_CONCURRENT = '4';
    process.env.OUTBOUND_DEFAULT_MAX_QUEUE = '8';
    process.env.OUTBOUND_COINGECKO_MAX_CONCURRENT = '2';

    expect(resolveProviderConcurrency('coingecko')).toEqual({
      maxConcurrent: 2,
      maxQueue: 8,
    });
    expect(resolveProviderConcurrency('kyc')).toEqual({
      maxConcurrent: 4,
      maxQueue: 8,
    });
  });

  it('normalizes provider names into env var keys', () => {
    process.env.OUTBOUND_STELLAR_EXPERT_MAX_CONCURRENT = '3';
    expect(resolveProviderConcurrency('stellar-expert').maxConcurrent).toBe(3);
  });

  it.each([
    ['OUTBOUND_COINGECKO_MAX_CONCURRENT', '0'],
    ['OUTBOUND_COINGECKO_MAX_CONCURRENT', 'lots'],
    ['OUTBOUND_COINGECKO_MAX_QUEUE', '-1'],
    ['OUTBOUND_COINGECKO_MAX_QUEUE', '1.5'],
  ])('rejects an invalid %s=%s', (key, value) => {
    process.env[key] = value;
    expect(() => resolveProviderConcurrency('coingecko')).toThrow(key);
  });
});

describe('ProviderConcurrencyService', () => {
  let service: ProviderConcurrencyService;

  beforeEach(() => {
    process.env.OUTBOUND_COINGECKO_MAX_CONCURRENT = '1';
    process.env.OUTBOUND_COINGECKO_MAX_QUEUE = '1';
    service = new ProviderConcurrencyService();
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => ENV_KEYS.forEach((key) => delete process.env[key]));

  it('queues calls beyond the limit and runs them once a slot frees up', async () => {
    const first = deferred<string>();
    const running = service.execute('coingecko', () => first.promise);
    const queuedTask = jest.fn().mockResolvedValue('second');
    const queued = service.execute('coingecko', queuedTask);

    expect(queuedTask).not.toHaveBeenCalled();
    expect(service.getAllMetrics()[0]).toMatchObject({ active: 1, queued: 1 });

    first.resolve('first');
    await expect(running).resolves.toBe('first');
    await expect(queued).resolves.toBe('second');
    expect(queuedTask).toHaveBeenCalledTimes(1);
  });

  it('fails fast once both the slots and the queue are full', async () => {
    const blocker = deferred();
    const running = service.execute('coingecko', () => blocker.promise);
    const queued = service.execute('coingecko', async () => undefined);
    const rejectedTask = jest.fn();

    await expect(
      service.execute('coingecko', rejectedTask),
    ).rejects.toBeInstanceOf(BulkheadRejectedError);
    expect(rejectedTask).not.toHaveBeenCalled();

    blocker.resolve();
    await Promise.all([running, queued]);
  });

  it('keeps unrelated providers available while one is saturated', async () => {
    const blocker = deferred();
    const running = service.execute('coingecko', () => blocker.promise);
    const queued = service.execute('coingecko', async () => undefined);
    await expect(
      service.execute('coingecko', async () => 'x'),
    ).rejects.toBeInstanceOf(BulkheadRejectedError);

    await expect(
      service.execute('stellar-expert', async () => 'ok'),
    ).resolves.toBe('ok');

    blocker.resolve();
    await Promise.all([running, queued]);
  });

  it('releases the slot when a request fails', async () => {
    await expect(
      service.execute('coingecko', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    await expect(
      service.execute('coingecko', async () => 'next'),
    ).resolves.toBe('next');
  });
});
