import { Injectable, Logger } from '@nestjs/common';

/**
 * BatchLoaderService — DataLoader-style batching for TypeORM relations.
 *
 * Solves N+1 query problems by collecting individual load requests within a
 * single event-loop tick and executing them as a single batched query.
 *
 * Usage:
 *   const loader = this.batchLoader.create<string, Signal>();
 *   // Inside a loop or map:
 *   const signal = await loader.load(signalId);
 *   // After all .load() calls, the batch executes automatically:
 *   const signals = await loader.execute();
 *
 * Each loader instance is request-scoped via the caller.  The `load` method
 * returns a promise that resolves once `execute()` finishes.
 */
@Injectable()
export class BatchLoaderService {
  private readonly logger = new Logger(BatchLoaderService.name);

  /**
   * Create a new batch loader for a given entity type.
   *
   * @param batchFn  A function that receives an array of IDs and returns
   *                 an ordered array of entities (same length, same order).
   * @param keyFn    Extracts the ID from an entity. Defaults to `entity.id`.
   */
  create<K = string, V = any>(
    batchFn: (ids: K[]) => Promise<V[]>,
    keyFn: (entity: V) => K = (e: any) => e?.id,
  ): DataLoaderInstance<K, V> {
    return new DataLoaderInstance<K, V>(batchFn, keyFn, this.logger);
  }
}

export class DataLoaderInstance<K, V> {
  private readonly pending = new Map<number, { key: K; resolve: (v: V) => void; reject: (e: Error) => void }>();
  private batchScheduled = false;
  private nextId = 0;

  constructor(
    private readonly batchFn: (ids: K[]) => Promise<V[]>,
    private readonly keyFn: (entity: V) => K,
    private readonly logger: Logger,
  ) {}

  /**
   * Register a load request. Returns a promise that resolves once the
   * batch executes. Batching is triggered on the next microtask tick.
   */
  load(key: K): Promise<V> {
    return new Promise<V>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { key, resolve, reject });

      if (!this.batchScheduled) {
        this.batchScheduled = true;
        // Use Promise.resolve() to defer batch execution to the next microtask,
        // allowing all synchronous .load() calls within the same tick to batch.
        Promise.resolve().then(() => this.executeBatch());
      }
    });
  }

  /**
   * Load multiple keys at once.
   */
  loadMany(keys: K[]): Promise<(V | Error)[]> {
    return Promise.all(keys.map((k) => this.load(k).catch((e) => e)));
  }

  /**
   * Manually trigger batch execution (normally auto-scheduled).
   */
  async execute(): Promise<V[]> {
    if (this.batchScheduled) {
      this.batchScheduled = false;
      return this.executeBatch();
    }
    return [];
  }

  private async executeBatch(): Promise<V[]> {
    if (this.pending.size === 0) return [];

    const entries = Array.from(this.pending.entries());
    this.pending.clear();
    this.batchScheduled = false;

    const ids = entries.map(([, e]) => e.key);

    try {
      const results = await this.batchFn(ids);
      const resultMap = new Map<K, V>();
      for (const entity of results) {
        resultMap.set(this.keyFn(entity), entity);
      }

      for (const [id, { key, resolve, reject }] of entries) {
        const entity = resultMap.get(key);
        if (entity !== undefined) {
          resolve(entity);
        } else {
          reject(new Error(`Entity not found for key: ${String(key)}`));
        }
      }

      return results;
    } catch (error) {
      for (const [, { reject }] of entries) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
      this.logger.error(`Batch loader failed for ${ids.length} keys`, (error as Error)?.stack);
      throw error;
    }
  }
}
