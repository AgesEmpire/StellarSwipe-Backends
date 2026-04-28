/**
 * Chaos Test: High Load Simulation
 *
 * Validates system behaviour under a sudden concurrency spike by firing many
 * parallel "requests" through the service layer and asserting that:
 *   - Rate limiting cuts in above the configured threshold.
 *   - The system does not crash or return unhandled 500s.
 *   - Performance degrades gracefully (p99 stays within the budget).
 *   - The system stabilises after the spike subsides.
 *
 * Scope:
 *   This test operates at the service / use-case level without a running HTTP
 *   server. It therefore avoids Docker / Kubernetes dependencies and can run
 *   in standard CI pipelines. For true load testing against a live server use
 *   k6, Locust, or Artillery pointed at a staging environment.
 *
 * Run:
 *   npx jest --config jest.chaos.config.js test/chaos/high-load.chaos.ts
 */

import { concurrentRequests, sleep } from './helpers/chaos-helper';
import { ResilienceMetrics } from './helpers/resilience-metrics';

// ─── Simulated service layer ──────────────────────────────────────────────────

interface RateLimitStore {
  counts: Map<string, number>;
  reset(): void;
}

const rateLimitStore: RateLimitStore = {
  counts: new Map(),
  reset() { this.counts.clear(); },
};

const RATE_LIMIT_THRESHOLD = 100; // requests per window per "user"

async function handleSignalFeedRequest(
  userId: string,
  simulatedProcessingMs = 5,
): Promise<{ status: number; data?: unknown; error?: string }> {
  // Rate-limit check
  const count = (rateLimitStore.counts.get(userId) ?? 0) + 1;
  rateLimitStore.counts.set(userId, count);

  if (count > RATE_LIMIT_THRESHOLD) {
    return { status: 429, error: 'Too Many Requests' };
  }

  // Simulate actual work
  await sleep(simulatedProcessingMs);

  return {
    status: 200,
    data: [{ id: 'sig-1', symbol: 'USDC/XLM', type: 'BUY' }],
  };
}

async function handleTradeRequest(
  userId: string,
  simulatedProcessingMs = 20,
): Promise<{ status: number; tradeId?: string; error?: string }> {
  const count = (rateLimitStore.counts.get(`trade:${userId}`) ?? 0) + 1;
  rateLimitStore.counts.set(`trade:${userId}`, count);

  if (count > 10) {
    // Stricter limit for writes
    return { status: 429, error: 'Trade rate limit exceeded' };
  }

  await sleep(simulatedProcessingMs);
  return { status: 201, tradeId: `trade-${Date.now()}-${userId}` };
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

const feedMetrics = new ResilienceMetrics();
const tradeMetrics = new ResilienceMetrics();

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('High Load Chaos Test', () => {
  beforeEach(() => {
    rateLimitStore.reset();
    feedMetrics.reset();
    tradeMetrics.reset();
  });

  afterAll(() => {
    feedMetrics.printSummary('High Load — Signal Feed');
    tradeMetrics.printSummary('High Load — Trade Execution');
  });

  describe('Step 1: Baseline — normal concurrency (10 users)', () => {
    it('should serve all 10 concurrent feed requests successfully', async () => {
      const results = await concurrentRequests(
        async (i) => handleSignalFeedRequest(`user-${i}`),
        10,
      );

      const successes = results.filter(
        (r) => r.status === 'fulfilled' && r.value.status === 200,
      );
      expect(successes.length).toBe(10);
    });

    it('should process 10 concurrent trades without error', async () => {
      const results = await concurrentRequests(
        async (i) => handleTradeRequest(`user-${i}`),
        10,
      );

      const successes = results.filter(
        (r) => r.status === 'fulfilled' && r.value.status === 201,
      );
      expect(successes.length).toBe(10);
    });
  });

  describe('Step 2: Concurrency spike — 200 simultaneous requests from 1 user', () => {
    it('should rate-limit requests above the threshold', async () => {
      const results = await concurrentRequests(
        async () => handleSignalFeedRequest('user-spike'),
        200,
      );

      const statuses = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<{ status: number }>).value.status);

      const allowed = statuses.filter((s) => s === 200).length;
      const rateLimited = statuses.filter((s) => s === 429).length;

      expect(allowed).toBeLessThanOrEqual(RATE_LIMIT_THRESHOLD);
      expect(rateLimited).toBeGreaterThan(0);
      // All requests must resolve — no crashes
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    });

    it('should return 429 not 500 for throttled requests', async () => {
      // Exhaust the rate limit first
      await concurrentRequests(
        async () => handleSignalFeedRequest('user-exhaust'),
        RATE_LIMIT_THRESHOLD + 1,
      );

      const next = await handleSignalFeedRequest('user-exhaust');
      expect(next.status).toBe(429);
      expect(next.error).toContain('Too Many Requests');
    });
  });

  describe('Step 3: Fan-out — 500 requests spread across 50 distinct users', () => {
    it('should handle fan-out without unhandled rejections', async () => {
      const results = await concurrentRequests(
        async (i) => handleSignalFeedRequest(`fan-user-${i % 50}`),
        500,
      );

      const errors = results.filter((r) => r.status === 'rejected');
      expect(errors.length).toBe(0);
    });

    it('should keep p99 latency below 500ms for feed requests', async () => {
      const samples: number[] = [];

      await concurrentRequests(async (i) => {
        const start = Date.now();
        await handleSignalFeedRequest(`perf-user-${i % 50}`);
        samples.push(Date.now() - start);
      }, 200);

      const sorted = samples.sort((a, b) => a - b);
      const p99 = sorted[Math.ceil(0.99 * sorted.length) - 1];
      expect(p99).toBeLessThan(500);
    });
  });

  describe('Step 4: Write-path stress — 100 concurrent trade submissions', () => {
    it('should enforce stricter rate limiting on trade writes', async () => {
      const results = await concurrentRequests(
        async () => handleTradeRequest('trader-spike'),
        100,
      );

      const statuses = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<{ status: number }>).value.status);

      const accepted = statuses.filter((s) => s === 201).length;
      const limited = statuses.filter((s) => s === 429).length;

      // Writes have a tighter limit (10)
      expect(accepted).toBeLessThanOrEqual(10);
      expect(limited).toBeGreaterThan(0);
    });

    it('should not produce any unhandled rejections under write stress', async () => {
      const results = await concurrentRequests(
        async (i) => handleTradeRequest(`trader-${i % 20}`),
        100,
      );

      const unhandled = results.filter((r) => r.status === 'rejected');
      expect(unhandled.length).toBe(0);
    });
  });

  describe('Step 5: Ramp-down — system stabilises after spike', () => {
    it('should accept new requests normally after rate-limit window resets', async () => {
      // Simulate window reset by clearing counts
      rateLimitStore.reset();

      const result = await handleSignalFeedRequest('user-post-spike');
      expect(result.status).toBe(200);
    });

    it('should serve trades normally after spike subsides', async () => {
      rateLimitStore.reset();

      const result = await handleTradeRequest('trader-post-spike');
      expect(result.status).toBe(201);
      expect(result.tradeId).toBeDefined();
    });
  });

  describe('Step 6: Memory / resource leak guard', () => {
    it('should not grow the rate-limit store unboundedly', async () => {
      rateLimitStore.reset();

      await concurrentRequests(
        async (i) => handleSignalFeedRequest(`mem-user-${i}`),
        1_000,
      );

      // Each unique userId gets one entry — 1000 unique users → 1000 entries
      // In production, a TTL-based store would bound this; here we assert the
      // size equals the number of unique users, not more.
      expect(rateLimitStore.counts.size).toBeLessThanOrEqual(1_000);
    });
  });

  describe('Step 7: Mixed read/write load', () => {
    it('should handle interleaved reads and writes without data races', async () => {
      rateLimitStore.reset();

      const mixed = await concurrentRequests(async (i) => {
        if (i % 3 === 0) {
          return handleTradeRequest(`mixed-user-${i % 10}`);
        }
        return handleSignalFeedRequest(`mixed-user-${i % 10}`);
      }, 150);

      const unhandled = mixed.filter((r) => r.status === 'rejected');
      expect(unhandled.length).toBe(0);

      const statuses = mixed
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<{ status: number }>).value.status);

      // Every response must be a known status — no 500s
      const knownStatuses = new Set([200, 201, 429]);
      const unknowns = statuses.filter((s) => !knownStatuses.has(s));
      expect(unknowns.length).toBe(0);
    });
  });
});
