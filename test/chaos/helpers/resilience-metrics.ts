/**
 * ResilienceMetrics — lightweight tracker for chaos test measurements.
 *
 * Records failure onset / recovery times and computes:
 *  - MTTR (Mean Time To Recovery)
 *  - Availability during failure window
 *  - Error rate during degradation
 *  - P50 / P95 / P99 response times
 */

export interface RequestSample {
  startedAt: number;   // epoch ms
  durationMs: number;
  statusCode: number;
  success: boolean;
}

export interface ResilienceSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  availabilityPct: number;
  errorRatePct: number;
  mttrMs: number | null;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minDurationMs: number;
  maxDurationMs: number;
  failureWindowMs: number | null;
}

export class ResilienceMetrics {
  private samples: RequestSample[] = [];
  private failureStartedAt: number | null = null;
  private recoveredAt: number | null = null;

  recordRequest(sample: RequestSample): void {
    this.samples.push(sample);
  }

  markFailureStart(): void {
    this.failureStartedAt = Date.now();
    this.recoveredAt = null;
  }

  markRecovery(): void {
    this.recoveredAt = Date.now();
  }

  async measureRequest<T>(
    fn: () => Promise<{ statusCode: number; success: boolean; data?: T }>,
  ): Promise<{ statusCode: number; success: boolean; data?: T; durationMs: number }> {
    const start = Date.now();
    try {
      const result = await fn();
      const durationMs = Date.now() - start;
      this.recordRequest({
        startedAt: start,
        durationMs,
        statusCode: result.statusCode,
        success: result.success,
      });
      return { ...result, durationMs };
    } catch (err) {
      const durationMs = Date.now() - start;
      this.recordRequest({
        startedAt: start,
        durationMs,
        statusCode: 0,
        success: false,
      });
      throw err;
    }
  }

  getSummary(): ResilienceSummary {
    const total = this.samples.length;
    if (total === 0) {
      return {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        availabilityPct: 100,
        errorRatePct: 0,
        mttrMs: null,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        minDurationMs: 0,
        maxDurationMs: 0,
        failureWindowMs: null,
      };
    }

    const successful = this.samples.filter((s) => s.success).length;
    const failed = total - successful;
    const durations = this.samples.map((s) => s.durationMs).sort((a, b) => a - b);

    const failureWindowMs =
      this.failureStartedAt && this.recoveredAt
        ? this.recoveredAt - this.failureStartedAt
        : null;

    const mttrMs =
      this.failureStartedAt && this.recoveredAt
        ? this.recoveredAt - this.failureStartedAt
        : null;

    return {
      totalRequests: total,
      successfulRequests: successful,
      failedRequests: failed,
      availabilityPct: (successful / total) * 100,
      errorRatePct: (failed / total) * 100,
      mttrMs,
      p50Ms: this.percentile(durations, 50),
      p95Ms: this.percentile(durations, 95),
      p99Ms: this.percentile(durations, 99),
      minDurationMs: durations[0],
      maxDurationMs: durations[durations.length - 1],
      failureWindowMs,
    };
  }

  printSummary(label: string): void {
    const s = this.getSummary();
    const lines = [
      `\n━━━ Resilience Metrics: ${label} ━━━`,
      `  Requests      : ${s.totalRequests} total, ${s.successfulRequests} ok, ${s.failedRequests} failed`,
      `  Availability  : ${s.availabilityPct.toFixed(2)}%`,
      `  Error rate    : ${s.errorRatePct.toFixed(2)}%`,
      `  MTTR          : ${s.mttrMs != null ? `${s.mttrMs}ms` : 'N/A'}`,
      `  Failure window: ${s.failureWindowMs != null ? `${s.failureWindowMs}ms` : 'N/A'}`,
      `  Latency p50   : ${s.p50Ms}ms`,
      `  Latency p95   : ${s.p95Ms}ms`,
      `  Latency p99   : ${s.p99Ms}ms`,
      `  Min / Max     : ${s.minDurationMs}ms / ${s.maxDurationMs}ms`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ];
    // Write directly to stdout to bypass the jest console mock
    process.stdout.write(lines.join('\n') + '\n');
  }

  reset(): void {
    this.samples = [];
    this.failureStartedAt = null;
    this.recoveredAt = null;
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }
}
