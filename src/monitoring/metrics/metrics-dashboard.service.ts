import { Injectable } from '@nestjs/common';
import { PrometheusService } from './prometheus.service';

export interface MetricsSummary {
  scrapeUrl: string;
  exportedAt: string;
  categories: {
    http: HttpMetricsSummary;
    queues: QueueMetricsSummary;
    cache: CacheMetricsSummary;
    database: DatabaseMetricsSummary;
    business: BusinessMetricsSummary;
  };
}

export interface HttpMetricsSummary {
  description: string;
  metrics: string[];
}

export interface QueueMetricsSummary {
  description: string;
  metrics: string[];
}

export interface CacheMetricsSummary {
  description: string;
  metrics: string[];
}

export interface DatabaseMetricsSummary {
  description: string;
  metrics: string[];
}

export interface BusinessMetricsSummary {
  description: string;
  metrics: string[];
}

/**
 * MetricsDashboardService
 *
 * Aggregates and documents all Prometheus metrics exported by this service.
 * Intended as a developer-friendly discovery endpoint that complements the
 * raw Prometheus scrape at GET /metrics.
 *
 * Metrics are grouped into five categories:
 *  http       – request timing, error rates, endpoint labels
 *  queues     – Bull job counts per queue (waiting/active/completed/failed/delayed)
 *  cache      – Redis cache hit / miss rates per layer
 *  database   – connection pool utilisation, query latency
 *  business   – trades, signals, active users, portfolio value
 */
@Injectable()
export class MetricsDashboardService {
  constructor(private readonly prometheusService: PrometheusService) {}

  async getDashboardSummary(scrapeBaseUrl: string): Promise<MetricsSummary> {
    const names = await this.getMetricNames();

    return {
      scrapeUrl: `${scrapeBaseUrl}/metrics`,
      exportedAt: new Date().toISOString(),
      categories: {
        http: {
          description: 'HTTP request timing, total counts, and error rates per endpoint and service type',
          metrics: names.filter((n) =>
            ['http_requests_total', 'http_request_duration_seconds', 'http_requests_errors_total'].includes(n),
          ),
        },
        queues: {
          description: 'Bull job queue sizes per queue (waiting/active/completed/failed/delayed)',
          metrics: names.filter((n) => n.startsWith('bull_queue_')),
        },
        cache: {
          description: 'Redis cache hit and miss counts per caching layer',
          metrics: names.filter((n) =>
            ['cache_hits_total', 'cache_misses_total'].includes(n),
          ),
        },
        database: {
          description:
            'PostgreSQL connection pool utilisation (total/active/idle/waiting) and query latency',
          metrics: names.filter((n) =>
            n.startsWith('db_') || n === 'postgresql_connections_active',
          ),
        },
        business: {
          description: 'Domain-level counters and gauges: trades, signals, active users, portfolio',
          metrics: names.filter((n) =>
            [
              'trades_executed_total',
              'signals_created_total',
              'active_users_gauge',
              'portfolio_value_total',
              'circuit_breaker_state',
              'circuit_breaker_transitions_total',
              'circuit_breaker_calls_total',
              'trade_stage_duration_seconds',
              'trade_end_to_end_duration_seconds',
              'trade_slow_flows_total',
              'trade_active_flows',
            ].includes(n),
          ),
        },
      },
    };
  }

  private async getMetricNames(): Promise<string[]> {
    const raw = await this.prometheusService.getMetrics();
    const names = new Set<string>();
    for (const line of raw.split('\n')) {
      // Prometheus text format: "# HELP <metric_name> ..."
      const helpMatch = /^# HELP (\S+)/.exec(line);
      if (helpMatch) names.add(helpMatch[1]);
    }
    return Array.from(names);
  }
}
