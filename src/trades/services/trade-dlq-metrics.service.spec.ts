import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TradeDlqMetricsService } from './trade-dlq-metrics.service';

describe('TradeDlqMetricsService', () => {
  let service: TradeDlqMetricsService;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn().mockReturnValue(1000),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeDlqMetricsService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(TradeDlqMetricsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.reset();
  });

  // ── recordFailure ──────────────────────────────────────────────────────────

  describe('recordFailure', () => {
    it('should increment total failure count', () => {
      service.recordFailure('trade-1', 'timeout error');
      service.recordFailure('trade-2', 'network error');

      const metrics = service.getMetrics();
      expect(metrics.totalFailures).toBe(2);
    });

    it('should increment current DLQ depth', () => {
      service.recordFailure('trade-1', 'error');
      service.recordFailure('trade-2', 'error');

      const metrics = service.getMetrics();
      expect(metrics.currentDlqDepth).toBe(2);
    });

    it('should categorize and count failure reasons', () => {
      service.recordFailure('t1', 'Network timeout');
      service.recordFailure('t2', 'Connection timed out');
      service.recordFailure('t3', 'Insufficient balance');
      service.recordFailure('t4', 'Soroban contract reverted');

      const metrics = service.getMetrics();
      expect(metrics.failureReasonDistribution['Timeout']).toBe(2);
      expect(metrics.failureReasonDistribution['Insufficient Balance']).toBe(1);
      expect(metrics.failureReasonDistribution['Smart Contract Error']).toBe(1);
    });

    it('should categorize unknown errors as Other', () => {
      service.recordFailure('t1', 'Some unexpected error');

      const metrics = service.getMetrics();
      expect(metrics.failureReasonDistribution['Other']).toBe(1);
    });

    it('should categorize RPC/Horizon errors correctly', () => {
      service.recordFailure('t1', 'Horizon server returned 503');
      service.recordFailure('t2', 'RPC endpoint unavailable');

      const metrics = service.getMetrics();
      expect(metrics.failureReasonDistribution['RPC/Horizon Error']).toBe(2);
    });

    it('should categorize slippage errors correctly', () => {
      service.recordFailure('t1', 'Slippage exceeded threshold');

      const metrics = service.getMetrics();
      expect(metrics.failureReasonDistribution['Slippage Exceeded']).toBe(1);
    });

    it('should categorize network errors correctly', () => {
      service.recordFailure('t1', 'Network connection refused');

      const metrics = service.getMetrics();
      expect(metrics.failureReasonDistribution['Network Error']).toBe(1);
    });
  });

  // ── recordRetry ────────────────────────────────────────────────────────────

  describe('recordRetry', () => {
    it('should increment total retry count', () => {
      service.recordRetry('t1', true);
      service.recordRetry('t2', false);

      const metrics = service.getMetrics();
      expect(metrics.totalRetries).toBe(2);
    });

    it('should decrement DLQ depth on successful retry', () => {
      service.recordFailure('t1', 'error');
      service.recordFailure('t2', 'error');
      expect(service.getMetrics().currentDlqDepth).toBe(2);

      service.recordRetry('t1', true);
      expect(service.getMetrics().currentDlqDepth).toBe(1);
    });

    it('should not decrement DLQ depth on failed retry', () => {
      service.recordFailure('t1', 'error');
      service.recordRetry('t1', false);

      expect(service.getMetrics().currentDlqDepth).toBe(1);
    });

    it('should not go below zero for DLQ depth', () => {
      service.recordRetry('t1', true);

      expect(service.getMetrics().currentDlqDepth).toBe(0);
    });

    it('should calculate retry success rate correctly', () => {
      service.recordRetry('t1', true);
      service.recordRetry('t2', true);
      service.recordRetry('t3', false);
      service.recordRetry('t4', true);

      const metrics = service.getMetrics();
      expect(metrics.retrySuccessRate).toBe(75);
    });

    it('should return 0 retry success rate when no retries', () => {
      const metrics = service.getMetrics();
      expect(metrics.retrySuccessRate).toBe(0);
    });
  });

  // ── recordDiscard ──────────────────────────────────────────────────────────

  describe('recordDiscard', () => {
    it('should increment discard count', () => {
      service.recordDiscard('t1');
      service.recordDiscard('t2');

      const metrics = service.getMetrics();
      expect(metrics.totalDiscards).toBe(2);
    });

    it('should decrement DLQ depth on discard', () => {
      service.recordFailure('t1', 'error');
      service.recordDiscard('t1');

      expect(service.getMetrics().currentDlqDepth).toBe(0);
    });
  });

  // ── setDlqDepth ────────────────────────────────────────────────────────────

  describe('setDlqDepth', () => {
    it('should set the DLQ depth directly', () => {
      service.setDlqDepth(42);

      expect(service.getMetrics().currentDlqDepth).toBe(42);
    });
  });

  // ── getMetrics ─────────────────────────────────────────────────────────────

  describe('getMetrics', () => {
    it('should return complete metrics snapshot', () => {
      service.recordFailure('t1', 'timeout');
      service.recordRetry('t1', true);
      service.recordDiscard('t2');

      const metrics = service.getMetrics();

      expect(metrics.totalFailures).toBe(1);
      expect(metrics.totalRetries).toBe(1);
      expect(metrics.totalDiscards).toBe(1);
      expect(metrics.lastUpdated).toBeDefined();
      expect(metrics.uptimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should return all zeroes when no events recorded', () => {
      const metrics = service.getMetrics();

      expect(metrics.totalFailures).toBe(0);
      expect(metrics.totalRetries).toBe(0);
      expect(metrics.totalDiscards).toBe(0);
      expect(metrics.currentDlqDepth).toBe(0);
    });
  });

  // ── getFailuresInWindow ────────────────────────────────────────────────────

  describe('getFailuresInWindow', () => {
    it('should count failures within time window', () => {
      service.recordFailure('t1', 'error');
      service.recordFailure('t2', 'error');

      const count = service.getFailuresInWindow(60_000); // last minute
      expect(count).toBe(2);
    });

    it('should return 0 when no failures in window', () => {
      const count = service.getFailuresInWindow(1); // 1ms window
      expect(count).toBe(0);
    });
  });

  // ── getRetrySuccessRateInWindow ────────────────────────────────────────────

  describe('getRetrySuccessRateInWindow', () => {
    it('should calculate rate within window', () => {
      service.recordRetry('t1', true);
      service.recordRetry('t2', false);

      const rate = service.getRetrySuccessRateInWindow(60_000);
      expect(rate).toBe(50);
    });

    it('should return 0 when no retries in window', () => {
      const rate = service.getRetrySuccessRateInWindow(60_000);
      expect(rate).toBe(0);
    });
  });

  // ── getTopFailureReasons ───────────────────────────────────────────────────

  describe('getTopFailureReasons', () => {
    it('should return top N reasons sorted by count', () => {
      service.recordFailure('t1', 'timeout');
      service.recordFailure('t2', 'timeout');
      service.recordFailure('t3', 'timeout');
      service.recordFailure('t4', 'network error');
      service.recordFailure('t5', 'network error');
      service.recordFailure('t6', 'soroban contract error');

      const top = service.getTopFailureReasons(2);
      expect(top).toHaveLength(2);
      expect(top[0].reason).toBe('Timeout');
      expect(top[0].count).toBe(3);
      expect(top[1].reason).toBe('Network Error');
    });

    it('should return empty array when no failures', () => {
      const top = service.getTopFailureReasons(5);
      expect(top).toHaveLength(0);
    });
  });

  // ── reset ──────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should clear all counters and records', () => {
      service.recordFailure('t1', 'error');
      service.recordRetry('t1', true);
      service.recordDiscard('t2');

      service.reset();

      const metrics = service.getMetrics();
      expect(metrics.totalFailures).toBe(0);
      expect(metrics.totalRetries).toBe(0);
      expect(metrics.totalDiscards).toBe(0);
      expect(metrics.currentDlqDepth).toBe(0);
      expect(Object.keys(metrics.failureReasonDistribution)).toHaveLength(0);
    });
  });
});
