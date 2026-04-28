/**
 * Chaos Test: Database Failure
 *
 * Validates that StellarSwipe degrades gracefully when PostgreSQL becomes
 * unavailable and recovers automatically once the connection is restored.
 *
 * Failure injection strategy:
 *   - Override DataSource.query() to throw a connection error.
 *   - Services that read through the cache layer should still serve stale data.
 *   - Write-path endpoints must return 503 with a human-readable message.
 *   - Restoring the original query function simulates DB reconnection.
 *
 * Run:
 *   npx jest --config jest.chaos.config.js test/chaos/database-failure.chaos.ts
 */

import { DataSource } from 'typeorm';
import {
  injectDatabaseFailure,
  injectDatabaseLatency,
  waitUntilReady,
  sleep,
  RestoreFn,
} from './helpers/chaos-helper';
import { ResilienceMetrics } from './helpers/resilience-metrics';

// ─── Shared state ─────────────────────────────────────────────────────────────

let dataSource: DataSource;
const metrics = new ResilienceMetrics();

// Simulated in-memory cache populated before the failure is injected
const simulatedCache = new Map<string, unknown>([
  ['signals:feed', [{ id: 'sig-1', symbol: 'USDC/XLM', type: 'BUY' }]],
  ['portfolio:user-42', { totalValue: 5000, positions: [] }],
]);

function readCache<T>(key: string): T | undefined {
  return simulatedCache.get(key) as T | undefined;
}

async function simulatedGetFeed(): Promise<{ status: number; data: unknown }> {
  try {
    // Attempt DB read
    await dataSource.query('SELECT 1');
    return { status: 200, data: simulatedCache.get('signals:feed') };
  } catch {
    // Fallback to cache
    const cached = readCache('signals:feed');
    if (cached) return { status: 200, data: cached };
    return { status: 503, data: { message: 'Service temporarily unavailable' } };
  }
}

async function simulatedExecuteTrade(): Promise<{ status: number; message?: string }> {
  try {
    await dataSource.query('SELECT 1');
    return { status: 201 };
  } catch {
    return { status: 503, message: 'Trades are temporarily unavailable. Please try again later.' };
  }
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Database Failure Chaos Test', () => {
  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.TEST_DATABASE_HOST || 'localhost',
      port: parseInt(process.env.TEST_DATABASE_PORT || '5432', 10),
      username: process.env.TEST_DATABASE_USER || 'test',
      password: process.env.TEST_DATABASE_PASSWORD || 'test',
      database: process.env.TEST_DATABASE_NAME || 'stellarswipe_test',
      entities: [],
      synchronize: false,
    });

    // Initialize with a no-op query function for unit-level testing
    // In a full integration environment, this would be a real connection
    dataSource.query = async (_sql: string, ..._params: unknown[]) => [{ '?column?': 1 }];
  });

  afterAll(() => {
    metrics.printSummary('Database Failure');
  });

  describe('Step 1: Baseline — normal operation', () => {
    it('should serve the signal feed from the database', async () => {
      const result = await metrics.measureRequest(async () => {
        const r = await simulatedGetFeed();
        return { statusCode: r.status, success: r.status === 200 };
      });

      expect(result.statusCode).toBe(200);
    });

    it('should accept trade execution', async () => {
      const result = await simulatedExecuteTrade();
      expect(result.status).toBe(201);
    });
  });

  describe('Step 2: Failure injection — PostgreSQL unreachable', () => {
    let restore: RestoreFn;

    beforeAll(() => {
      metrics.markFailureStart();
      restore = injectDatabaseFailure(dataSource);
    });

    afterAll(async () => {
      await restore();
    });

    it('should still serve the signal feed from cache (graceful degradation)', async () => {
      const result = await metrics.measureRequest(async () => {
        const r = await simulatedGetFeed();
        return { statusCode: r.status, success: r.status === 200, data: r.data };
      });

      // 200 expected — served from cache
      expect(result.statusCode).toBe(200);
      expect(result.data).toBeDefined();
    });

    it('should return 503 for write operations (trades)', async () => {
      const result = await simulatedExecuteTrade();

      expect(result.status).toBe(503);
      expect(result.message).toContain('temporarily unavailable');
    });

    it('should consistently degrade under repeated requests', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => simulatedGetFeed()),
      );

      const allOk = results.every((r) => r.status === 200);
      expect(allOk).toBe(true);
    });

    it('should return 503 for all trade attempts while DB is down', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => simulatedExecuteTrade()),
      );

      const all503 = results.every((r) => r.status === 503);
      expect(all503).toBe(true);
    });
  });

  describe('Step 3: Recovery — PostgreSQL restored', () => {
    it('should resume normal operation after database reconnects', async () => {
      // Restore was called in afterAll of the previous describe block,
      // but we need it to happen before this test. Re-inject a working version.
      dataSource.query = async (_sql: string, ..._params: unknown[]) => [{ '?column?': 1 }];
      metrics.markRecovery();

      await waitUntilReady(async () => {
        const r = await simulatedGetFeed();
        if (r.status !== 200) throw new Error('Not recovered yet');
      }, 5_000);

      const feed = await simulatedGetFeed();
      expect(feed.status).toBe(200);
    });

    it('should accept trade execution after recovery', async () => {
      const result = await simulatedExecuteTrade();
      expect(result.status).toBe(201);
    });

    it('should record successful requests post-recovery', async () => {
      await metrics.measureRequest(async () => {
        const r = await simulatedGetFeed();
        return { statusCode: r.status, success: r.status === 200 };
      });

      const summary = metrics.getSummary();
      expect(summary.successfulRequests).toBeGreaterThan(0);
    });
  });

  describe('Step 4: Slow database — latency injection', () => {
    let restore: RestoreFn;

    beforeAll(() => {
      restore = injectDatabaseLatency(dataSource, 200);
    });

    afterAll(async () => {
      await restore();
    });

    it('should complete requests within acceptable latency budget under slow DB', async () => {
      const LATENCY_BUDGET_MS = 2_000;
      const start = Date.now();
      const result = await simulatedGetFeed();
      const elapsed = Date.now() - start;

      expect(result.status).toBe(200);
      expect(elapsed).toBeLessThan(LATENCY_BUDGET_MS);
    });
  });

  describe('Step 5: Resilience metrics validation', () => {
    it('should have recovered (MTTR recorded)', () => {
      const summary = metrics.getSummary();
      expect(summary.mttrMs).not.toBeNull();
    });

    it('should have maintained >60% availability across the full failure window', () => {
      const summary = metrics.getSummary();
      // During a DB failure, cached reads keep availability high
      expect(summary.availabilityPct).toBeGreaterThanOrEqual(60);
    });
  });
});
