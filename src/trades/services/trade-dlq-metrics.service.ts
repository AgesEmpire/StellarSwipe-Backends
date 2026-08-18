import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface DlqMetricsSnapshot {
  totalFailures: number;
  totalRetries: number;
  totalDiscards: number;
  retrySuccessRate: number;
  failureReasonDistribution: Record<string, number>;
  currentDlqDepth: number;
  lastUpdated: string;
  uptimeMs: number;
}

interface FailureRecord {
  tradeId: string;
  reason: string;
  timestamp: Date;
}

interface RetryRecord {
  tradeId: string;
  success: boolean;
  timestamp: Date;
}

/**
 * #999 -- In-memory metrics collector for DLQ operations.
 *
 * Tracks failure counts, retry success rates, and reason distributions.
 * Intended for lightweight monitoring; for production-grade metrics,
 * integrate with Prometheus via prom-client.
 */
@Injectable()
export class TradeDlqMetricsService {
  private readonly logger = new Logger(TradeDlqMetricsService.name);
  private readonly startTime = Date.now();

  private totalFailures = 0;
  private totalRetries = 0;
  private totalSuccessfulRetries = 0;
  private totalDiscards = 0;
  private currentDlqDepth = 0;

  private readonly failureReasons: Record<string, number> = {};
  private readonly recentFailures: FailureRecord[] = [];
  private readonly recentRetries: RetryRecord[] = [];

  private readonly maxRecentRecords: number;

  constructor(private readonly configService: ConfigService) {
    this.maxRecentRecords = this.configService.get<number>(
      'dlq.metrics.maxRecentRecords',
      1000,
    );
  }

  /**
   * Record a job failure event.
   */
  recordFailure(tradeId: string, reason: string): void {
    this.totalFailures++;
    this.currentDlqDepth++;

    const category = this.categorizeReason(reason);
    this.failureReasons[category] = (this.failureReasons[category] || 0) + 1;

    this.recentFailures.push({
      tradeId,
      reason: category,
      timestamp: new Date(),
    });

    // Prune old records to prevent unbounded growth
    if (this.recentFailures.length > this.maxRecentRecords) {
      this.recentFailures.splice(0, this.recentFailures.length - this.maxRecentRecords);
    }

    this.logger.debug(
      `DLQ metrics: failure recorded for trade ${tradeId} (reason: ${category}). Total: ${this.totalFailures}`,
    );
  }

  /**
   * Record a retry event (success or failure).
   */
  recordRetry(tradeId: string, success: boolean): void {
    this.totalRetries++;
    if (success) {
      this.totalSuccessfulRetries++;
      this.currentDlqDepth = Math.max(0, this.currentDlqDepth - 1);
    }

    this.recentRetries.push({
      tradeId,
      success,
      timestamp: new Date(),
    });

    if (this.recentRetries.length > this.maxRecentRecords) {
      this.recentRetries.splice(0, this.recentRetries.length - this.maxRecentRecords);
    }

    this.logger.debug(
      `DLQ metrics: retry recorded for trade ${tradeId} (success: ${success}). Total retries: ${this.totalRetries}`,
    );
  }

  /**
   * Record a discard event.
   */
  recordDiscard(tradeId: string): void {
    this.totalDiscards++;
    this.currentDlqDepth = Math.max(0, this.currentDlqDepth - 1);

    this.logger.debug(
      `DLQ metrics: discard recorded for trade ${tradeId}. Total discards: ${this.totalDiscards}`,
    );
  }

  /**
   * Update the current DLQ depth (called during periodic sync).
   */
  setDlqDepth(depth: number): void {
    this.currentDlqDepth = depth;
  }

  /**
   * Get a snapshot of all current metrics.
   */
  getMetrics(): DlqMetricsSnapshot {
    const retrySuccessRate =
      this.totalRetries > 0
        ? (this.totalSuccessfulRetries / this.totalRetries) * 100
        : 0;

    return {
      totalFailures: this.totalFailures,
      totalRetries: this.totalRetries,
      totalDiscards: this.totalDiscards,
      retrySuccessRate: Math.round(retrySuccessRate * 100) / 100,
      failureReasonDistribution: { ...this.failureReasons },
      currentDlqDepth: this.currentDlqDepth,
      lastUpdated: new Date().toISOString(),
      uptimeMs: Date.now() - this.startTime,
    };
  }

  /**
   * Get failure counts within a specific time window.
   */
  getFailuresInWindow(windowMs: number): number {
    const cutoff = new Date(Date.now() - windowMs);
    return this.recentFailures.filter((f) => f.timestamp >= cutoff).length;
  }

  /**
   * Get retry success rate within a specific time window.
   */
  getRetrySuccessRateInWindow(windowMs: number): number {
    const cutoff = new Date(Date.now() - windowMs);
    const recentRetries = this.recentRetries.filter(
      (r) => r.timestamp >= cutoff,
    );
    if (recentRetries.length === 0) return 0;

    const successes = recentRetries.filter((r) => r.success).length;
    return (successes / recentRetries.length) * 100;
  }

  /**
   * Get the top N failure reasons by count.
   */
  getTopFailureReasons(n: number = 5): Array<{ reason: string; count: number }> {
    return Object.entries(this.failureReasons)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  }

  /**
   * Reset all metrics counters. Primarily for testing.
   */
  reset(): void {
    this.totalFailures = 0;
    this.totalRetries = 0;
    this.totalSuccessfulRetries = 0;
    this.totalDiscards = 0;
    this.currentDlqDepth = 0;
    Object.keys(this.failureReasons).forEach(
      (key) => delete this.failureReasons[key],
    );
    this.recentFailures.length = 0;
    this.recentRetries.length = 0;
  }

  private categorizeReason(reason: string): string {
    const lower = reason.toLowerCase();
    if (lower.includes('timeout') || lower.includes('timed out')) return 'Timeout';
    if (lower.includes('insufficient') || lower.includes('balance')) return 'Insufficient Balance';
    if (lower.includes('network') || lower.includes('connection')) return 'Network Error';
    if (lower.includes('soroban') || lower.includes('contract')) return 'Smart Contract Error';
    if (lower.includes('rpc') || lower.includes('horizon')) return 'RPC/Horizon Error';
    if (lower.includes('slippage')) return 'Slippage Exceeded';
    return 'Other';
  }
}
