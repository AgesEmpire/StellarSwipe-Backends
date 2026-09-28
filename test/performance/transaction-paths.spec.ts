/**
 * Performance tests — key transaction and data paths
 *
 * These tests measure latency and throughput for the most critical backend
 * operations: trade execution, signal ingestion, event batch processing, and
 * service discovery resolution.
 *
 * Each benchmark:
 *  - Runs N iterations against a mocked service layer (no I/O).
 *  - Asserts that the measured p95 latency stays within the defined SLO.
 *  - Asserts a minimum throughput (ops/sec) for batch paths.
 *
 * Security: no real credentials, tokens, or wallet keys are used.
 * All service dependencies are replaced with lightweight in-memory mocks.
 */

import { TradesService } from '../../src/trades/trades.service';
import { EventIngestionService } from '../../src/events/event-ingestion.service';
import { DiscoveryService } from '../../src/discovery/discovery.service';
import { JobErrorHandler } from '../../src/jobs/job-error.handler';

// ── Benchmark helpers ──────────────────────────────────────────────────────

interface BenchResult {
  iterations: number;
  totalMs: number;
  avgMs: number;
  p95Ms: number;
  opsPerSec: number;
}

async function bench(
  label: string,
  iterations: number,
  fn: () => Promise<void>,
): Promise<BenchResult> {
  const samples: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }

  samples.sort((a, b) => a - b);
  const totalMs = samples.reduce((s, v) => s + v, 0);
  const avgMs = totalMs / iterations;
  const p95Ms = samples[Math.floor(iterations * 0.95)];
  const opsPerSec = 1_000 / avgMs;

  console.log(
    `[perf] ${label}: avg=${avgMs.toFixed(2)}ms p95=${p95Ms.toFixed(2)}ms ops/s=${opsPerSec.toFixed(0)}`,
  );

  return { iterations, totalMs, avgMs, p95Ms, opsPerSec };
}

// ── SLOs ──────────────────────────────────────────────────────────────────

const SLO = {
  tradeValidation: { p95Ms: 5 },
  eventIngestionSingle: { p95Ms: 2 },
  eventIngestionBatch100: { p95Ms: 50, minOpsPerSec: 20 },
  serviceDiscoveryResolve: { p95Ms: 2 },
  jobErrorClassification: { p95Ms: 1 },
} as const;

// ── Mocks ─────────────────────────────────────────────────────────────────

function makeIngestionService(): EventIngestionService {
  const cacheMock = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };
  const configMock = {
    get: jest.fn((key: string) => {
      const map: Record<string, unknown> = {
        'ingestion.allowedSources': '',
        'ingestion.maxBatchSize': 500,
        'ingestion.maxPayloadBytes': 65_536,
        'ingestion.rateWindowMs': 60_000,
        'ingestion.rateLimit': 100_000,
        'ingestion.circuitBreakerThreshold': 0.9,
        'ingestion.circuitBreakerWindowMs': 30_000,
      };
      return map[key];
    }),
  };
  return new (EventIngestionService as any)(cacheMock, configMock);
}

function makeDiscoveryService(): DiscoveryService {
  const cacheMock = {
    get: jest.fn().mockResolvedValue({ name: 'signals-svc', url: 'http://signals:3001' }),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };
  const configMock = { get: jest.fn().mockReturnValue('internal-token') };
  return new (DiscoveryService as any)(cacheMock, configMock);
}

function makeJobErrorHandler(): JobErrorHandler {
  const dlqMock = { capture: jest.fn().mockResolvedValue(undefined) };
  const emitterMock = { emit: jest.fn() };
  return new (JobErrorHandler as any)(dlqMock, emitterMock);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Performance: key transaction paths', () => {
  const ITERATIONS = 200;

  // ── Trade validation ─────────────────────────────────────────────────────

  describe('TradesService.validateTradePreview()', () => {
    let svc: TradesService;

    beforeAll(() => {
      const repoMock = { findOne: jest.fn().mockResolvedValue(null) };
      const riskMock = {
        checkDuplicateTrade: jest.fn().mockResolvedValue(false),
        validateTrade: jest.fn().mockResolvedValue({ isValid: true, errors: [] }),
        calculateProfitLoss: jest.fn().mockReturnValue({ profitLoss: '10', profitLossPercentage: '5' }),
      };
      const executorMock = {};
      const velocityMock = { validateTrade: jest.fn().mockResolvedValue(undefined) };
      svc = new (TradesService as any)(repoMock, riskMock, executorMock, velocityMock);
    });

    it(`p95 latency < ${SLO.tradeValidation.p95Ms}ms over ${ITERATIONS} iterations`, async () => {
      const dto = {
        userId: 'u1',
        signalId: 's1',
        side: 'BUY',
        amount: 100,
        walletAddress: 'GABC',
      };

      const result = await bench('trade.validatePreview', ITERATIONS, () =>
        svc.validateTradePreview(dto as any),
      );

      expect(result.p95Ms).toBeLessThan(SLO.tradeValidation.p95Ms);
    });
  });

  // ── Event ingestion — single ─────────────────────────────────────────────

  describe('EventIngestionService.ingestOne()', () => {
    let svc: EventIngestionService;

    beforeAll(() => {
      svc = makeIngestionService();
    });

    it(`p95 latency < ${SLO.eventIngestionSingle.p95Ms}ms over ${ITERATIONS} iterations`, async () => {
      const event = { sourceId: 'src-x', eventType: 'trade.executed', payload: { id: '1' } };

      const result = await bench('event.ingestOne', ITERATIONS, () =>
        svc.ingestOne(event),
      );

      expect(result.p95Ms).toBeLessThan(SLO.eventIngestionSingle.p95Ms);
    });
  });

  // ── Event ingestion — batch ──────────────────────────────────────────────

  describe('EventIngestionService.ingestBatch() — 100 events', () => {
    let svc: EventIngestionService;

    beforeAll(() => {
      svc = makeIngestionService();
    });

    it(
      `p95 latency < ${SLO.eventIngestionBatch100.p95Ms}ms and throughput > ${SLO.eventIngestionBatch100.minOpsPerSec} ops/s`,
      async () => {
        const batch = Array.from({ length: 100 }, (_, i) => ({
          sourceId: 'src-x',
          eventType: 'price.update',
          payload: { seq: i },
        }));

        const result = await bench('event.ingestBatch(100)', 50, () =>
          svc.ingestBatch(batch),
        );

        expect(result.p95Ms).toBeLessThan(SLO.eventIngestionBatch100.p95Ms);
        expect(result.opsPerSec).toBeGreaterThan(SLO.eventIngestionBatch100.minOpsPerSec);
      },
    );
  });

  // ── Service discovery ────────────────────────────────────────────────────

  describe('DiscoveryService.resolve()', () => {
    let svc: DiscoveryService;

    beforeAll(() => {
      svc = makeDiscoveryService();
    });

    it(`p95 latency < ${SLO.serviceDiscoveryResolve.p95Ms}ms over ${ITERATIONS} iterations`, async () => {
      const result = await bench('discovery.resolve', ITERATIONS, () =>
        svc.resolve('signals-svc'),
      );

      expect(result.p95Ms).toBeLessThan(SLO.serviceDiscoveryResolve.p95Ms);
    });
  });

  // ── Job error classification ─────────────────────────────────────────────

  describe('JobErrorHandler.isFatalError()', () => {
    let handler: JobErrorHandler;

    beforeAll(() => {
      handler = makeJobErrorHandler();
    });

    it(`p95 latency < ${SLO.jobErrorClassification.p95Ms}ms over ${ITERATIONS} iterations`, async () => {
      const errors = [
        new Error('Unauthorized'),
        new Error('Connection timeout'),
        new Error('Validation failed'),
        new Error('Internal error'),
      ];

      const result = await bench('job.isFatalError', ITERATIONS, async () => {
        handler.isFatalError(errors[Math.floor(Math.random() * errors.length)]);
      });

      expect(result.p95Ms).toBeLessThan(SLO.jobErrorClassification.p95Ms);
    });
  });
});
