/**
 * Helpers to record business and infrastructure metrics.
 * Import PrometheusService and call these from services/interceptors.
 */
import { PrometheusService } from './prometheus.service';

export function recordTrade(
  prometheus: PrometheusService,
  side: 'buy' | 'sell',
  status: 'completed' | 'failed' | 'pending',
): void {
  prometheus.tradesExecutedTotal.inc({ side, status });
}

export function recordSignal(
  prometheus: PrometheusService,
  type: string,
): void {
  prometheus.signalsCreatedTotal.inc({ type });
}

export function setActiveUsers(prometheus: PrometheusService, count: number): void {
  prometheus.activeUsersGauge.set(count);
}

export function setPortfolioValue(prometheus: PrometheusService, value: number): void {
  prometheus.portfolioValueTotal.set(value);
}

export function recordCacheHit(prometheus: PrometheusService, layer: 'l1' | 'l2'): void {
  prometheus.cacheHitsTotal.inc({ layer });
}

export function recordCacheMiss(prometheus: PrometheusService, layer: 'l1' | 'l2'): void {
  prometheus.cacheMissesTotal.inc({ layer });
}

export function recordDbQuery(
  prometheus: PrometheusService,
  operation: string,
  entity: string,
  durationSeconds: number,
): void {
  prometheus.dbQueryDuration.observe({ operation, entity }, durationSeconds);
}

export function recordHealthCheck(
  prometheus: PrometheusService,
  service: string,
  isUp: boolean,
): void {
  prometheus.serviceHealthStatus.set({ service }, isUp ? 1 : 0);
}
