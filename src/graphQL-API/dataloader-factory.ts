import DataLoader from 'dataloader';

/**
 * Generic DataLoader factory.
 *
 * Usage:
 *   const loader = createDataLoader<string, ProviderEntity>(
 *     async (ids) => providerService.findByIds(ids as string[]),
 *     (entity) => entity.id,
 *   );
 */
export function createDataLoader<K, V>(
  batchFn: (keys: readonly K[]) => Promise<(V | Error)[]>,
  keyFn: (item: V) => K,
  options?: DataLoader.Options<K, V>,
): DataLoader<K, V> {
  return new DataLoader<K, V>(
    async (keys) => {
      const results = await batchFn(keys);
      // Map results back to the request order, returning Error for misses
      const resultMap = new Map<K, V | Error>();
      results.forEach((item) => {
        if (item instanceof Error) return;
        resultMap.set(keyFn(item), item);
      });
      return keys.map(
        (key) => resultMap.get(key) ?? new Error(`Record not found for key: ${String(key)}`),
      );
    },
    {
      cache: true,
      ...options,
    },
  );
}

/**
 * DataLoader that groups records by a foreign key (one-to-many).
 *
 * Usage:
 *   const loader = createGroupedDataLoader<string, SignalEntity>(
 *     async (providerIds) => signalService.findByProviderIds(providerIds as string[]),
 *     (signal) => signal.providerId,
 *   );
 */
export function createGroupedDataLoader<K, V>(
  batchFn: (keys: readonly K[]) => Promise<V[]>,
  groupKeyFn: (item: V) => K,
  options?: DataLoader.Options<K, V[]>,
): DataLoader<K, V[]> {
  return new DataLoader<K, V[]>(
    async (keys) => {
      const results = await batchFn(keys);
      const grouped = new Map<K, V[]>();
      keys.forEach((key) => grouped.set(key, []));
      results.forEach((item) => {
        const key = groupKeyFn(item);
        const bucket = grouped.get(key);
        if (bucket) bucket.push(item);
      });
      return keys.map((key) => grouped.get(key) ?? []);
    },
    {
      cache: true,
      ...options,
    },
  );
}

/** Convenience type exported for resolver injection */
export interface DataLoaderSet {
  providerById: DataLoader<string, any>;
  signalsByProviderId: DataLoader<string, any[]>;
}
