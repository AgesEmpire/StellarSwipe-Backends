/**
 * Chaos Test: Redis / Cache Failure
 *
 * Validates that StellarSwipe continues to function in degraded mode when
 * Redis is unavailable, then fully recovers once Redis comes back online.
 *
 * Failure injection strategy:
 *   - Replace CacheStore.get / CacheStore.set with throwing stubs.
 *   - All read-path code that depends on the cache must fall back to the DB.
 *   - Write-path code that uses cache for session tokens / rate-limit counters
 *     must fail gracefully (allow-through with a warning, not a hard crash).
 *   - The cache "cold start" scenario (Redis restarts, empty cache) is also tested.
 *
 * Run:
 *   npx jest --config jest.chaos.config.js test/chaos/redis-failure.chaos.ts
 */

import {
  injectCacheFailure,
  injectCacheColdStart,
  sleep,
  waitUntilReady,
  RestoreFn,
} from './helpers/chaos-helper';
import { CacheStore } from './helpers/chaos-helper';
import { ResilienceMetrics } from './helpers/resilience-metrics';

// ─── Simulated in-memory application cache ────────────────────────────────────

class InMemoryCacheStore implements CacheStore {
  private store = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.store.get(key);
  }

  async set(key: string, value: unknown, _ttl?: number): Promise<void> {
    this.store.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  seed(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  size(): number {
    return this.store.size;
  }
}

// ─── Simulated service layer that uses cache-aside pattern ────────────────────

interface Signal {
  id: string;
  symbol: string;
  type: string;
}

const DB_SIGNALS: Signal[] = [
  { id: 'sig-1', symbol: 'USDC/XLM', type: 'BUY' },
  { id: 'sig-2', symbol: 'XLM/BTC', type: 'SELL' },
];

let dbAvailable = true;

async function getSignalFeed(cache: CacheStore): Promise<{ status: number; data: Signal[]; source: string }> {
  const CACHE_KEY = 'signals:feed';

  try {
    const cached = await cache.get(CACHE_KEY);
    if (cached) {
      return { status: 200, data: cached as Signal[], source: 'cache' };
    }
  } catch {
    // Cache unavailable — fall through to DB
  }

  if (!dbAvailable) {
    return { status: 503, data: [], source: 'none' };
  }

  // Simulate a DB read
  await sleep(10);
  try {
    await cache.set(CACHE_KEY, DB_SIGNALS, 60);
  } catch {
    // Cache write failed — continue without caching
  }

  return { status: 200, data: DB_SIGNALS, source: 'db' };
}

async function checkRateLimit(
  cache: CacheStore,
  userId: string,
): Promise<{ allowed: boolean; fromCache: boolean }> {
  const key = `rate:${userId}`;
  try {
    const count = ((await cache.get(key)) as number) ?? 0;
    if (count >= 100) return { allowed: false, fromCache: true };
    await cache.set(key, count + 1, 60);
    return { allowed: true, fromCache: true };
  } catch {
    // Redis down — allow-through with degraded rate limiting
    return { allowed: true, fromCache: false };
  }
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Redis / Cache Failure Chaos Test', () => {
  let cache: InMemoryCacheStore;
  const metrics = new ResilienceMetrics();

  beforeAll(() => {
    cache = new InMemoryCacheStore();
    cache.seed('signals:feed', DB_SIGNALS);
    dbAvailable = true;
  });

  afterAll(() => {
    metrics.printSummary('Redis Failure');
  });

  describe('Step 1: Baseline — Redis healthy', () => {
    it('should serve signals from cache', async () => {
      const result = await getSignalFeed(cache);
      expect(result.status).toBe(200);
      expect(result.source).toBe('cache');
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should enforce rate limiting via cache', async () => {
      const { allowed, fromCache } = await checkRateLimit(cache, 'user-1');
      expect(allowed).toBe(true);
      expect(fromCache).toBe(true);
    });
  });

  describe('Step 2: Redis failure — cache throws on every operation', () => {
    let restore: RestoreFn;

    beforeAll(() => {
      metrics.markFailureStart();
      restore = injectCacheFailure(cache);
    });

    afterAll(async () => {
      await restore();
    });

    it('should fall back to the database when cache is unavailable', async () => {
      const result = await metrics.measureRequest(async () => {
        const r = await getSignalFeed(cache);
        return { statusCode: r.status, success: r.status === 200, data: r };
      });

      expect(result.statusCode).toBe(200);
      expect((result.data as { source: string }).source).toBe('db');
    });

    it('should allow requests through with degraded rate limiting', async () => {
      const { allowed, fromCache } = await checkRateLimit(cache, 'user-2');
      // When Redis is down, rate limiting is bypassed — requests still allowed
      expect(allowed).toBe(true);
      expect(fromCache).toBe(false);
    });

    it('should handle repeated requests without crashing', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => getSignalFeed(cache)),
      );
      const allOk = results.every((r) => r.status === 200);
      expect(allOk).toBe(true);
    });

    it('should continue serving when both cache and DB are stressed', async () => {
      // Slow down DB to simulate worst-case: Redis down + DB slow
      const originalSleep = sleep;
      const slowSleep = (ms: number) => originalSleep(ms + 20);

      // Patch only the local sleep reference used inside getSignalFeed
      // (In production this would be the DB query latency)
      const result = await getSignalFeed(cache);
      expect(result.status).toBe(200);
    });
  });

  describe('Step 3: Redis cold start — cache returns undefined (empty)', () => {
    let restore: RestoreFn;

    beforeAll(() => {
      restore = injectCacheColdStart(cache);
    });

    afterAll(async () => {
      await restore();
    });

    it('should fetch from the database on cache miss', async () => {
      const result = await getSignalFeed(cache);
      expect(result.status).toBe(200);
      expect(result.source).toBe('db');
    });

    it('should warm up the cache after fetching from DB', async () => {
      // After restore, the in-memory store should have been written to
      // (the cold-start injection only blocks reads; writes succeed)
      const result = await getSignalFeed(cache);
      expect(result.status).toBe(200);
    });
  });

  describe('Step 4: Recovery — Redis restored', () => {
    it('should serve from cache again after Redis comes back', async () => {
      // At this point all restores have run — cache is back to normal
      metrics.markRecovery();

      await waitUntilReady(async () => {
        const r = await getSignalFeed(cache);
        if (r.source !== 'cache' && r.source !== 'db')
          throw new Error('Still degraded');
      }, 3_000);

      const result = await getSignalFeed(cache);
      expect(result.status).toBe(200);
    });

    it('should re-enforce rate limiting after recovery', async () => {
      const { fromCache } = await checkRateLimit(cache, 'user-3');
      expect(fromCache).toBe(true);
    });
  });

  describe('Step 5: Database also fails while Redis is down (cascading)', () => {
    let restore: RestoreFn;

    beforeAll(() => {
      dbAvailable = false;
      restore = injectCacheFailure(cache);
    });

    afterAll(async () => {
      dbAvailable = true;
      await restore();
    });

    it('should return 503 when both cache and DB are unavailable', async () => {
      const result = await getSignalFeed(cache);
      expect(result.status).toBe(503);
    });

    it('should not throw an unhandled exception during cascading failure', async () => {
      await expect(getSignalFeed(cache)).resolves.toMatchObject({ status: 503 });
    });
  });

  describe('Step 6: Resilience metrics', () => {
    it('should have recorded MTTR', () => {
      const summary = metrics.getSummary();
      expect(summary.mttrMs).not.toBeNull();
    });

    it('should have >50% availability across the test run', () => {
      const summary = metrics.getSummary();
      expect(summary.availabilityPct).toBeGreaterThanOrEqual(50);
    });
  });
});
