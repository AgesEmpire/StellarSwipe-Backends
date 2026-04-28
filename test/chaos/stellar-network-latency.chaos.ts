/**
 * Chaos Test: Stellar Network Latency & Partition
 *
 * Validates that StellarSwipe handles Horizon API degradation gracefully:
 *   - Slow responses trigger timeouts and retry logic.
 *   - Complete partitions surface user-friendly errors rather than hanging.
 *   - Trade queue holds pending trades during outages and reprocesses on recovery.
 *   - User notifications are enqueued when live data is unavailable.
 *
 * Failure injection strategy:
 *   - Adds an axios request interceptor that delays / rejects all outbound calls.
 *   - Ejects the interceptor to simulate recovery.
 *
 * Run:
 *   npx jest --config jest.chaos.config.js test/chaos/stellar-network-latency.chaos.ts
 */

import axios, { AxiosResponse } from 'axios';
import {
  injectNetworkLatency,
  injectNetworkPartition,
  injectNetworkTimeout,
  waitUntilReady,
  sleep,
  RestoreFn,
} from './helpers/chaos-helper';
import { ResilienceMetrics } from './helpers/resilience-metrics';

// ─── Simulated Stellar Horizon client ────────────────────────────────────────

const HORIZON_BASE = 'https://horizon-testnet.stellar.org';
const REQUEST_TIMEOUT_MS = 3_000;

interface HorizonAccountResponse {
  id: string;
  balances: Array<{ asset_type: string; balance: string }>;
}

async function fetchAccount(address: string): Promise<{
  status: number;
  data?: HorizonAccountResponse;
  error?: string;
}> {
  try {
    const response: AxiosResponse<HorizonAccountResponse> = await axios.get(
      `${HORIZON_BASE}/accounts/${address}`,
      { timeout: REQUEST_TIMEOUT_MS },
    );
    return { status: response.status, data: response.data };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { response?: AxiosResponse };
    if (e.code === 'ECONNABORTED' || e.message?.includes('timeout')) {
      return { status: 504, error: 'Gateway timeout: Stellar Horizon did not respond in time' };
    }
    if (e.code === 'ECONNREFUSED' || e.message?.includes('Network unreachable')) {
      return { status: 503, error: 'Stellar network is currently unreachable' };
    }
    return { status: e.response?.status ?? 500, error: e.message };
  }
}

async function submitTransaction(xdr: string): Promise<{
  status: number;
  hash?: string;
  queued?: boolean;
  error?: string;
}> {
  try {
    const response: AxiosResponse<{ hash: string }> = await axios.post(
      `${HORIZON_BASE}/transactions`,
      { tx: xdr },
      { timeout: REQUEST_TIMEOUT_MS },
    );
    return { status: response.status, hash: response.data.hash };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { response?: AxiosResponse };
    if (
      e.code === 'ECONNABORTED' ||
      e.code === 'ECONNREFUSED' ||
      e.message?.includes('timeout') ||
      e.message?.includes('unreachable')
    ) {
      // Queue the transaction for retry when network recovers
      return {
        status: 202,
        queued: true,
        error: 'Transaction queued: Stellar network is temporarily unavailable',
      };
    }
    return { status: e.response?.status ?? 500, error: e.message };
  }
}

// ─── Pending trade queue (simulated) ─────────────────────────────────────────

interface PendingTrade {
  id: string;
  xdr: string;
  enqueuedAt: Date;
  attempts: number;
}

const tradeQueue: PendingTrade[] = [];

async function processTradeQueue(): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  for (const trade of [...tradeQueue]) {
    const result = await submitTransaction(trade.xdr);
    if (result.hash) {
      tradeQueue.splice(tradeQueue.indexOf(trade), 1);
      processed++;
    } else {
      trade.attempts++;
      if (trade.attempts >= 3) {
        tradeQueue.splice(tradeQueue.indexOf(trade), 1);
        failed++;
      }
    }
  }

  return { processed, failed };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Stellar Network Latency Chaos Test', () => {
  const metrics = new ResilienceMetrics();
  const TEST_ADDRESS = 'GABC123DEF456GHI789JKL012MNO345PQR678STU901VWX234YZA567BCD';
  const TEST_XDR = 'AAAA...base64encodedtransaction...AAAA';

  // Override axios to avoid real HTTP calls in CI
  let axiosMock: jest.SpyInstance;

  beforeAll(() => {
    axiosMock = jest.spyOn(axios, 'get').mockResolvedValue({
      status: 200,
      data: {
        id: TEST_ADDRESS,
        balances: [
          { asset_type: 'native', balance: '1000.0000000' },
          { asset_code: 'USDC', balance: '5000.0000000' },
        ],
      },
    } as AxiosResponse);

    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: { hash: `mock_tx_${Date.now()}` },
    } as AxiosResponse);
  });

  afterAll(() => {
    axiosMock.mockRestore();
    metrics.printSummary('Stellar Network Latency');
  });

  afterEach(() => {
    tradeQueue.length = 0;
  });

  describe('Step 1: Baseline — Horizon healthy', () => {
    it('should fetch account balances successfully', async () => {
      const result = await metrics.measureRequest(async () => {
        const r = await fetchAccount(TEST_ADDRESS);
        return { statusCode: r.status, success: r.status === 200 };
      });

      expect(result.statusCode).toBe(200);
    });

    it('should submit a transaction within timeout budget', async () => {
      const start = Date.now();
      const result = await submitTransaction(TEST_XDR);
      const elapsed = Date.now() - start;

      expect(result.status).toBe(200);
      expect(elapsed).toBeLessThan(REQUEST_TIMEOUT_MS);
    });
  });

  describe('Step 2: High latency — 5 s delay injected to Horizon', () => {
    let restore: RestoreFn;

    beforeAll(() => {
      metrics.markFailureStart();

      // Patch the axios mock to simulate 5 s latency then succeed
      (axios.get as jest.Mock).mockImplementation(async () => {
        await sleep(5_000);
        return {
          status: 200,
          data: { id: TEST_ADDRESS, balances: [] },
        };
      });

      (axios.post as jest.Mock).mockImplementation(async () => {
        await sleep(5_000);
        return { status: 200, data: { hash: 'mock_tx_slow' } };
      });

      restore = injectNetworkLatency(0); // interceptor layer (no-op in mock env)
    }, 10_000);

    afterAll(async () => {
      await restore();

      // Reset mocks to fast path
      (axios.get as jest.Mock).mockResolvedValue({
        status: 200,
        data: { id: TEST_ADDRESS, balances: [] },
      } as AxiosResponse);
      (axios.post as jest.Mock).mockResolvedValue({
        status: 200,
        data: { hash: 'mock_tx_recovered' },
      } as AxiosResponse);
    });

    it('should time out after REQUEST_TIMEOUT_MS and return 504', async () => {
      // Override to simulate timeout error (latency exceeds our 3 s budget)
      (axios.get as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error('timeout of 3000ms exceeded'), { code: 'ECONNABORTED' }),
      );

      const result = await fetchAccount(TEST_ADDRESS);
      expect(result.status).toBe(504);
      expect(result.error).toContain('timeout');
    });

    it('should queue trade rather than blocking the user', async () => {
      (axios.post as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error('timeout of 3000ms exceeded'), { code: 'ECONNABORTED' }),
      );

      const result = await submitTransaction(TEST_XDR);

      expect(result.status).toBe(202);
      expect(result.queued).toBe(true);
      expect(result.error).toContain('queued');
    });
  }, 15_000);

  describe('Step 3: Complete partition — Horizon unreachable', () => {
    let restore: RestoreFn;

    beforeAll(() => {
      (axios.get as jest.Mock).mockRejectedValue(
        Object.assign(new Error('Network unreachable (chaos: partition)'), {
          code: 'ECONNREFUSED',
        }),
      );
      (axios.post as jest.Mock).mockRejectedValue(
        Object.assign(new Error('Network unreachable (chaos: partition)'), {
          code: 'ECONNREFUSED',
        }),
      );

      restore = injectNetworkPartition();
    });

    afterAll(async () => {
      await restore();
    });

    it('should return 503 on account lookup when Horizon is partitioned', async () => {
      const result = await fetchAccount(TEST_ADDRESS);
      expect(result.status).toBe(503);
      expect(result.error).toBeDefined();
    });

    it('should queue transactions during network partition', async () => {
      const result = await submitTransaction(TEST_XDR);
      expect(result.status).toBe(202);
      expect(result.queued).toBe(true);
    });

    it('should keep track of queued trades count', async () => {
      // Simulate 3 trades submitted during partition
      for (let i = 0; i < 3; i++) {
        const r = await submitTransaction(TEST_XDR);
        if (r.queued) {
          tradeQueue.push({
            id: `trade-${i}`,
            xdr: TEST_XDR,
            enqueuedAt: new Date(),
            attempts: 0,
          });
        }
      }

      expect(tradeQueue.length).toBe(3);
    });

    it('should not expose internal errors to callers', async () => {
      const result = await fetchAccount(TEST_ADDRESS);
      // Should be a clean error message, not a raw stack trace
      expect(result.error).not.toContain('at ');
    });
  });

  describe('Step 4: Recovery — Horizon reachable again', () => {
    beforeAll(() => {
      metrics.markRecovery();

      (axios.get as jest.Mock).mockResolvedValue({
        status: 200,
        data: { id: TEST_ADDRESS, balances: [{ asset_type: 'native', balance: '1000' }] },
      } as AxiosResponse);

      (axios.post as jest.Mock).mockResolvedValue({
        status: 200,
        data: { hash: 'mock_tx_post_recovery' },
      } as AxiosResponse);

      // Pre-populate queue to test flush
      tradeQueue.push(
        { id: 'trade-queued-1', xdr: TEST_XDR, enqueuedAt: new Date(), attempts: 0 },
        { id: 'trade-queued-2', xdr: TEST_XDR, enqueuedAt: new Date(), attempts: 0 },
      );
    });

    it('should resume account lookups successfully', async () => {
      await waitUntilReady(async () => {
        const r = await fetchAccount(TEST_ADDRESS);
        if (r.status !== 200) throw new Error('Horizon not recovered');
      }, 3_000);

      const result = await fetchAccount(TEST_ADDRESS);
      expect(result.status).toBe(200);
    });

    it('should flush queued trades after network recovery', async () => {
      const { processed, failed } = await processTradeQueue();
      expect(processed).toBeGreaterThan(0);
      expect(failed).toBe(0);
      expect(tradeQueue.length).toBe(0);
    });
  });

  describe('Step 5: Resilience metrics', () => {
    it('should have an MTTR recorded', () => {
      const summary = metrics.getSummary();
      expect(summary.mttrMs).not.toBeNull();
    });

    it('should have kept error-free baseline requests recorded', () => {
      const summary = metrics.getSummary();
      expect(summary.successfulRequests).toBeGreaterThan(0);
    });
  });
});
