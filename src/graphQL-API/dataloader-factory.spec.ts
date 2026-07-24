import { BatchLoader, createDataLoader, createGroupedDataLoader } from './dataloader-factory';

describe('BatchLoader', () => {
  it('batches concurrent loads for different keys into a single batchFn call', async () => {
    const batchFn = jest.fn(async (keys: readonly string[]) => keys.map((k) => `value-${k}`));
    const loader = new BatchLoader<string, string>(batchFn);

    const [a, b, c] = await Promise.all([loader.load('1'), loader.load('2'), loader.load('3')]);

    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn).toHaveBeenCalledWith(['1', '2', '3']);
    expect([a, b, c]).toEqual(['value-1', 'value-2', 'value-3']);
  });

  it('caches results so a repeated key is not re-fetched', async () => {
    const batchFn = jest.fn(async (keys: readonly string[]) => keys.map((k) => `value-${k}`));
    const loader = new BatchLoader<string, string>(batchFn);

    await Promise.all([loader.load('1'), loader.load('1')]);
    await loader.load('1');

    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn).toHaveBeenCalledWith(['1']);
  });

  it('rejects only the keys that resolved to an Error', async () => {
    const batchFn = jest.fn(async (keys: readonly string[]) =>
      keys.map((k) => (k === 'missing' ? new Error('not found') : `value-${k}`)),
    );
    const loader = new BatchLoader<string, string>(batchFn);

    const results = await Promise.allSettled([loader.load('1'), loader.load('missing')]);

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'value-1' });
    expect(results[1].status).toBe('rejected');
  });
});

describe('createDataLoader', () => {
  it('resolves a single query into a batched lookup keyed by keyFn', async () => {
    type Provider = { id: string; name: string };
    const providers: Provider[] = [
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Beta' },
    ];
    const findByIds = jest.fn(async (ids: readonly string[]) =>
      providers.filter((p) => ids.includes(p.id)),
    );
    const loader = createDataLoader<string, Provider>(findByIds, (p) => p.id);

    // Simulates 20 signals referencing only 2 distinct providers.
    const signalProviderIds = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 'p1' : 'p2'));
    const resolved = await Promise.all(signalProviderIds.map((id) => loader.load(id)));

    expect(findByIds).toHaveBeenCalledTimes(1);
    expect(resolved.map((p) => p.name)).toEqual(
      signalProviderIds.map((id) => (id === 'p1' ? 'Alpha' : 'Beta')),
    );
  });
});

describe('createGroupedDataLoader', () => {
  it('groups batched records by foreign key, including empty results', async () => {
    type Signal = { id: string; providerId: string };
    const signals: Signal[] = [
      { id: 's1', providerId: 'p1' },
      { id: 's2', providerId: 'p1' },
      { id: 's3', providerId: 'p2' },
    ];
    const findByProviderIds = jest.fn(async (providerIds: readonly string[]) =>
      signals.filter((s) => providerIds.includes(s.providerId)),
    );
    const loader = createGroupedDataLoader<string, Signal>(
      findByProviderIds,
      (s) => s.providerId,
    );

    const [forP1, forP2, forP3] = await Promise.all([
      loader.load('p1'),
      loader.load('p2'),
      loader.load('p3'),
    ]);

    expect(findByProviderIds).toHaveBeenCalledTimes(1);
    expect(forP1.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(forP2.map((s) => s.id)).toEqual(['s3']);
    expect(forP3).toEqual([]);
  });
});
