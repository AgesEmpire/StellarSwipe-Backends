/**
 * Zero-dependency batch loader used to fix the GraphQL N+1 problem on
 * `Signal.provider` / `Provider.recentSignals` field resolution.
 *
 * Each `.load(key)` call is queued and flushed on the next tick as a single
 * batched call to `batchFn`, collapsing N per-field DB lookups into one
 * query per request. Results are cached per loader instance, and a new
 * instance is created per GraphQL request (see `graphql.module.ts`), so
 * there is no cross-request cache leakage.
 */
export type BatchLoadFn<K, V> = (keys: readonly K[]) => Promise<(V | Error)[]>;

export class BatchLoader<K, V> {
  private queue: Array<{
    key: K;
    resolve: (value: V) => void;
    reject: (error: Error) => void;
  }> = [];

  private readonly cache = new Map<K, Promise<V>>();
  private scheduled = false;

  constructor(private readonly batchFn: BatchLoadFn<K, V>) {}

  load(key: K): Promise<V> {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const promise = new Promise<V>((resolve, reject) => {
      this.queue.push({ key, resolve, reject });
      this.scheduleDispatch();
    });

    this.cache.set(key, promise);
    return promise;
  }

  private scheduleDispatch(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    process.nextTick(() => {
      void this.dispatch();
    });
  }

  private async dispatch(): Promise<void> {
    const batch = this.queue;
    this.queue = [];
    this.scheduled = false;
    if (batch.length === 0) return;

    try {
      const results = await this.batchFn(batch.map((entry) => entry.key));
      batch.forEach((entry, index) => {
        const result = results[index];
        if (result instanceof Error) {
          entry.reject(result);
        } else {
          entry.resolve(result);
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      batch.forEach((entry) => entry.reject(err));
    }
  }
}

/**
 * Generic batch loader factory for one-to-one lookups (e.g. providerId -> Provider).
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
): BatchLoader<K, V> {
  return new BatchLoader<K, V>(async (keys) => {
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
  });
}

/**
 * Batch loader that groups records by a foreign key (one-to-many, e.g.
 * providerId -> Signal[]).
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
): BatchLoader<K, V[]> {
  return new BatchLoader<K, V[]>(async (keys) => {
    const results = await batchFn(keys);
    const grouped = new Map<K, V[]>();
    keys.forEach((key) => grouped.set(key, []));
    results.forEach((item) => {
      const key = groupKeyFn(item);
      const bucket = grouped.get(key);
      if (bucket) bucket.push(item);
    });
    return keys.map((key) => grouped.get(key) ?? []);
  });
}

/** Convenience type exported for resolver injection */
export interface DataLoaderSet {
  providerById: BatchLoader<string, any>;
  signalsByProviderId: BatchLoader<string, any[]>;
}
