import { Injectable, Logger } from '@nestjs/common';

/**
 * Metrics for a provider endpoint.
 * Used to compute health score.
 */
export interface ProviderMetrics {
  providerId: string;
  endpoint: string;
  latencyMs: number[];
  errorCount: number;
  requestCount: number;
  uptime: number; // 0-100 percentage
  lastUpdated: Date;
}

/**
 * Health score result for a provider endpoint.
 */
export interface ProviderHealthScore {
  providerId: string;
  endpoint: string;
  score: number; // 0-100
  latencyScore: number; // 0-100
  reliabilityScore: number; // 0-100 (1 - error rate)
  uptimeScore: number; // 0-100
  metrics: {
    avgLatencyMs: number;
    p95LatencyMs: number;
    errorRate: number; // 0-1
    uptime: number; // 0-100
    requestCount: number;
  };
  status: 'healthy' | 'degraded' | 'unhealthy';
}

/**
 * ProviderHealthScoreService
 *
 * Computes composite health scores for provider-facing API endpoints.
 * Combines latency, error rate, and uptime metrics into a single score.
 *
 * Health Score Calculation:
 *   Health = (Latency Score * 0.4) + (Reliability Score * 0.35) + (Uptime Score * 0.25)
 *
 * Where:
 *   - Latency Score: 100 if avg < 100ms, degrades as latency increases
 *   - Reliability Score: 100 - (error_rate * 100)
 *   - Uptime Score: Reported uptime percentage
 *
 * Health Status:
 *   - Healthy: score >= 80
 *   - Degraded: score 50-79
 *   - Unhealthy: score < 50
 */
@Injectable()
export class ProviderHealthScoreService {
  private readonly logger = new Logger(ProviderHealthScoreService.name);
  private metricsMap: Map<string, ProviderMetrics> = new Map();

  /**
   * Records a request to a provider endpoint.
   *
   * @param providerId Provider identifier
   * @param endpoint API endpoint path
   * @param latencyMs Request latency in milliseconds
   * @param success Whether request succeeded
   */
  recordRequest(
    providerId: string,
    endpoint: string,
    latencyMs: number,
    success: boolean,
  ): void {
    const key = `${providerId}:${endpoint}`;
    let metrics = this.metricsMap.get(key);

    if (!metrics) {
      metrics = {
        providerId,
        endpoint,
        latencyMs: [],
        errorCount: 0,
        requestCount: 0,
        uptime: 100,
        lastUpdated: new Date(),
      };
    }

    metrics.latencyMs.push(latencyMs);
    metrics.requestCount += 1;
    if (!success) {
      metrics.errorCount += 1;
    }

    // Keep only the last 1000 latency measurements to limit memory usage
    if (metrics.latencyMs.length > 1000) {
      metrics.latencyMs = metrics.latencyMs.slice(-1000);
    }

    metrics.lastUpdated = new Date();
    this.metricsMap.set(key, metrics);
  }

  /**
   * Updates the uptime percentage for a provider endpoint.
   *
   * @param providerId Provider identifier
   * @param endpoint API endpoint path
   * @param uptime Uptime percentage (0-100)
   */
  setUptime(providerId: string, endpoint: string, uptime: number): void {
    const key = `${providerId}:${endpoint}`;
    let metrics = this.metricsMap.get(key);

    if (!metrics) {
      metrics = {
        providerId,
        endpoint,
        latencyMs: [],
        errorCount: 0,
        requestCount: 0,
        uptime: Math.max(0, Math.min(100, uptime)),
        lastUpdated: new Date(),
      };
    } else {
      metrics.uptime = Math.max(0, Math.min(100, uptime));
    }

    this.metricsMap.set(key, metrics);
  }

  /**
   * Computes health score for a provider endpoint.
   *
   * @param providerId Provider identifier
   * @param endpoint API endpoint path
   * @returns Health score details
   */
  getHealthScore(providerId: string, endpoint: string): ProviderHealthScore | null {
    const key = `${providerId}:${endpoint}`;
    const metrics = this.metricsMap.get(key);

    if (!metrics || metrics.requestCount === 0) {
      return null;
    }

    const avgLatency = this.calculateAverageLatency(metrics.latencyMs);
    const p95Latency = this.calculateP95Latency(metrics.latencyMs);
    const errorRate = metrics.requestCount > 0
      ? metrics.errorCount / metrics.requestCount
      : 0;

    const latencyScore = this.calculateLatencyScore(avgLatency);
    const reliabilityScore = (1 - errorRate) * 100;
    const uptimeScore = metrics.uptime;

    // Weighted composite score
    const score =
      latencyScore * 0.4 +
      reliabilityScore * 0.35 +
      uptimeScore * 0.25;

    const status = this.getStatusFromScore(score);

    return {
      providerId,
      endpoint,
      score: Math.round(score),
      latencyScore: Math.round(latencyScore),
      reliabilityScore: Math.round(reliabilityScore),
      uptimeScore: Math.round(uptimeScore),
      metrics: {
        avgLatencyMs: Math.round(avgLatency),
        p95LatencyMs: Math.round(p95Latency),
        errorRate: Math.round(errorRate * 10000) / 10000,
        uptime: metrics.uptime,
        requestCount: metrics.requestCount,
      },
      status,
    };
  }

  /**
   * Gets health scores for all tracked provider endpoints.
   *
   * @returns Array of health scores
   */
  getAllHealthScores(): ProviderHealthScore[] {
    const scores: ProviderHealthScore[] = [];

    for (const [, metrics] of this.metricsMap) {
      const score = this.getHealthScore(metrics.providerId, metrics.endpoint);
      if (score) {
        scores.push(score);
      }
    }

    return scores;
  }

  /**
   * Gets aggregated health score for a specific provider.
   * Averages scores across all endpoints.
   *
   * @param providerId Provider identifier
   * @returns Aggregated health score or null if no data
   */
  getProviderHealthScore(providerId: string): ProviderHealthScore | null {
    const endpoints = Array.from(this.metricsMap.entries())
      .filter(([, metrics]) => metrics.providerId === providerId)
      .map(([, metrics]) => metrics.endpoint);

    if (endpoints.length === 0) {
      return null;
    }

    const scores = endpoints
      .map((endpoint) => this.getHealthScore(providerId, endpoint))
      .filter((s) => s !== null) as ProviderHealthScore[];

    if (scores.length === 0) {
      return null;
    }

    const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
    const avgLatencyScore = scores.reduce((sum, s) => sum + s.latencyScore, 0) / scores.length;
    const avgReliabilityScore = scores.reduce((sum, s) => sum + s.reliabilityScore, 0) / scores.length;
    const avgUptimeScore = scores.reduce((sum, s) => sum + s.uptimeScore, 0) / scores.length;

    return {
      providerId,
      endpoint: 'ALL',
      score: Math.round(avgScore),
      latencyScore: Math.round(avgLatencyScore),
      reliabilityScore: Math.round(avgReliabilityScore),
      uptimeScore: Math.round(avgUptimeScore),
      metrics: {
        avgLatencyMs: Math.round(
          scores.reduce((sum, s) => sum + s.metrics.avgLatencyMs, 0) / scores.length,
        ),
        p95LatencyMs: Math.round(
          scores.reduce((sum, s) => sum + s.metrics.p95LatencyMs, 0) / scores.length,
        ),
        errorRate: Math.round(
          scores.reduce((sum, s) => sum + s.metrics.errorRate, 0) * 10000 / scores.length,
        ) / 10000,
        uptime: Math.round(
          scores.reduce((sum, s) => sum + s.metrics.uptime, 0) / scores.length * 100,
        ) / 100,
        requestCount: scores.reduce((sum, s) => sum + s.metrics.requestCount, 0),
      },
      status: this.getStatusFromScore(avgScore),
    };
  }

  private calculateAverageLatency(latencies: number[]): number {
    if (latencies.length === 0) return 0;
    return latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
  }

  private calculateP95Latency(latencies: number[]): number {
    if (latencies.length === 0) return 0;
    const sorted = [...latencies].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[Math.max(0, index)];
  }

  private calculateLatencyScore(avgLatencyMs: number): number {
    // Score decreases as latency increases
    // 100ms = 100 score, 200ms = 50 score, 400ms = 0 score
    if (avgLatencyMs <= 100) return 100;
    if (avgLatencyMs >= 400) return 0;
    return 100 - ((avgLatencyMs - 100) / 300) * 100;
  }

  private getStatusFromScore(score: number): 'healthy' | 'degraded' | 'unhealthy' {
    if (score >= 80) return 'healthy';
    if (score >= 50) return 'degraded';
    return 'unhealthy';
  }
}
