/**
 * ChaosHelper — injects and removes failures at key system boundaries.
 *
 * All injection methods return a restore function. Call it inside afterEach /
 * afterAll to guarantee cleanup even on test failure.
 *
 *   const restore = await ChaosHelper.injectDatabaseFailure();
 *   try { ... } finally { await restore(); }
 */

import axios, { AxiosRequestConfig } from 'axios';
import { DataSource } from 'typeorm';

export type RestoreFn = () => Promise<void>;

// ─── Database ────────────────────────────────────────────────────────────────

/**
 * Patches a TypeORM DataSource so every query rejects with a connection error.
 * Restores the original implementation when the returned function is called.
 */
export function injectDatabaseFailure(dataSource: DataSource): RestoreFn {
  const originalQuery = dataSource.query.bind(dataSource);

  dataSource.query = async (..._args: unknown[]) => {
    throw new Error('Connection terminated unexpectedly (chaos: DB failure)');
  };

  return async () => {
    dataSource.query = originalQuery;
  };
}

/**
 * Simulates a slow database by adding a fixed delay to every query.
 */
export function injectDatabaseLatency(
  dataSource: DataSource,
  delayMs: number,
): RestoreFn {
  const originalQuery = dataSource.query.bind(dataSource);

  dataSource.query = async (...args: unknown[]) => {
    await sleep(delayMs);
    return (originalQuery as (...a: unknown[]) => Promise<unknown>)(...args);
  };

  return async () => {
    dataSource.query = originalQuery;
  };
}

// ─── Redis / Cache ────────────────────────────────────────────────────────────

export interface CacheStore {
  get: (...args: unknown[]) => Promise<unknown>;
  set: (...args: unknown[]) => Promise<void>;
  del?: (...args: unknown[]) => Promise<void>;
}

/**
 * Makes the cache store throw on every read and write.
 */
export function injectCacheFailure(cache: CacheStore): RestoreFn {
  const originalGet = cache.get.bind(cache);
  const originalSet = cache.set.bind(cache);

  cache.get = async (..._args: unknown[]) => {
    throw new Error('Redis connection refused (chaos: cache failure)');
  };
  cache.set = async (..._args: unknown[]) => {
    throw new Error('Redis connection refused (chaos: cache failure)');
  };

  return async () => {
    cache.get = originalGet;
    cache.set = originalSet;
  };
}

/**
 * Makes the cache store return undefined on all reads (simulates a cold cache
 * after a Redis restart) while writes silently succeed.
 */
export function injectCacheColdStart(cache: CacheStore): RestoreFn {
  const originalGet = cache.get.bind(cache);

  cache.get = async (..._args: unknown[]) => undefined;

  return async () => {
    cache.get = originalGet;
  };
}

// ─── HTTP / Stellar Network ───────────────────────────────────────────────────

export interface AxiosInterceptorIds {
  request: number;
  response: number;
}

/**
 * Adds an axios request interceptor that delays every outbound request by
 * `delayMs` milliseconds, simulating network latency to Stellar Horizon.
 */
export function injectNetworkLatency(delayMs: number): RestoreFn {
  const id = axios.interceptors.request.use(
    async (config: AxiosRequestConfig) => {
      await sleep(delayMs);
      return config;
    },
  );

  return async () => {
    axios.interceptors.request.eject(id);
  };
}

/**
 * Adds an axios request interceptor that rejects every request immediately,
 * simulating a completely unreachable external network.
 */
export function injectNetworkPartition(): RestoreFn {
  const id = axios.interceptors.request.use(
    async (_config: AxiosRequestConfig) => {
      throw Object.assign(new Error('Network unreachable (chaos: partition)'), {
        code: 'ECONNREFUSED',
      });
    },
  );

  return async () => {
    axios.interceptors.request.eject(id);
  };
}

/**
 * Adds a response interceptor that forces every request to time out.
 */
export function injectNetworkTimeout(): RestoreFn {
  const id = axios.interceptors.response.use(
    undefined,
    async (_error: unknown) => {
      const err = Object.assign(new Error('timeout of 0ms exceeded (chaos: forced timeout)'), {
        code: 'ECONNABORTED',
      });
      throw err;
    },
  );

  // Also intercept requests so they never resolve
  const reqId = axios.interceptors.request.use(
    async (_config: AxiosRequestConfig) => {
      // Return a promise that never resolves to simulate a hard timeout
      await sleep(60_000);
      return _config;
    },
  );

  return async () => {
    axios.interceptors.response.eject(id);
    axios.interceptors.request.eject(reqId);
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` repeatedly until it resolves without throwing, up to `timeoutMs`.
 * Useful for "wait for recovery" assertions.
 */
export async function waitUntilReady(
  fn: () => Promise<void>,
  timeoutMs = 10_000,
  intervalMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | undefined;

  while (Date.now() < deadline) {
    try {
      await fn();
      return;
    } catch (err) {
      lastError = err as Error;
      await sleep(intervalMs);
    }
  }

  throw new Error(
    `System did not recover within ${timeoutMs}ms. Last error: ${lastError?.message}`,
  );
}

/**
 * Executes `concurrency` parallel copies of `fn` and returns all results /
 * errors. Useful for high-load simulation.
 */
export async function concurrentRequests<T>(
  fn: (index: number) => Promise<T>,
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(
    Array.from({ length: concurrency }, (_, i) => fn(i)),
  );
}
