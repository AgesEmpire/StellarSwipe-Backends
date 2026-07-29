import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { MetricsDashboardService } from './metrics-dashboard.service';
import { PrometheusService } from './prometheus.service';

function buildService(): { service: MetricsDashboardService; registry: Registry } {
  const registry = new Registry();

  // Register a representative subset of the real metrics
  new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
  });
  new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.1, 0.5, 1],
    registers: [registry],
  });
  new Counter({
    name: 'http_requests_errors_total',
    help: 'HTTP errors',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
  });
  new Gauge({
    name: 'bull_queue_jobs_waiting',
    help: 'Waiting jobs',
    labelNames: ['queue'],
    registers: [registry],
  });
  new Gauge({
    name: 'bull_queue_jobs_active',
    help: 'Active jobs',
    labelNames: ['queue'],
    registers: [registry],
  });
  new Counter({
    name: 'cache_hits_total',
    help: 'Cache hits',
    labelNames: ['layer'],
    registers: [registry],
  });
  new Counter({
    name: 'cache_misses_total',
    help: 'Cache misses',
    labelNames: ['layer'],
    registers: [registry],
  });
  new Gauge({
    name: 'db_pool_connections_total',
    help: 'DB pool total',
    registers: [registry],
  });
  new Counter({
    name: 'trades_executed_total',
    help: 'Trades executed',
    labelNames: ['side', 'status'],
    registers: [registry],
  });
  new Counter({
    name: 'signals_created_total',
    help: 'Signals created',
    labelNames: ['type'],
    registers: [registry],
  });

  const prometheus = {
    registry,
    getMetrics: () => registry.metrics(),
  } as unknown as PrometheusService;

  const service = new MetricsDashboardService(prometheus);
  return { service, registry };
}

describe('MetricsDashboardService', () => {
  describe('getDashboardSummary', () => {
    it('returns a scrapeUrl pointing to /metrics', async () => {
      const { service } = buildService();
      const summary = await service.getDashboardSummary('https://api.example.com');
      expect(summary.scrapeUrl).toBe('https://api.example.com/metrics');
    });

    it('includes exportedAt as ISO date string', async () => {
      const { service } = buildService();
      const summary = await service.getDashboardSummary('http://localhost');
      expect(summary.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('http category contains http_requests_total', async () => {
      const { service } = buildService();
      const summary = await service.getDashboardSummary('http://localhost');
      expect(summary.categories.http.metrics).toContain('http_requests_total');
      expect(summary.categories.http.metrics).toContain('http_request_duration_seconds');
      expect(summary.categories.http.metrics).toContain('http_requests_errors_total');
    });

    it('queues category contains bull_queue metrics', async () => {
      const { service } = buildService();
      const summary = await service.getDashboardSummary('http://localhost');
      expect(summary.categories.queues.metrics).toContain('bull_queue_jobs_waiting');
      expect(summary.categories.queues.metrics).toContain('bull_queue_jobs_active');
    });

    it('cache category contains cache hit/miss metrics', async () => {
      const { service } = buildService();
      const summary = await service.getDashboardSummary('http://localhost');
      expect(summary.categories.cache.metrics).toContain('cache_hits_total');
      expect(summary.categories.cache.metrics).toContain('cache_misses_total');
    });

    it('database category contains db_pool metric', async () => {
      const { service } = buildService();
      const summary = await service.getDashboardSummary('http://localhost');
      expect(summary.categories.database.metrics).toContain('db_pool_connections_total');
    });

    it('business category contains trades and signals metrics', async () => {
      const { service } = buildService();
      const summary = await service.getDashboardSummary('http://localhost');
      expect(summary.categories.business.metrics).toContain('trades_executed_total');
      expect(summary.categories.business.metrics).toContain('signals_created_total');
    });

    it('all categories have a description string', async () => {
      const { service } = buildService();
      const summary = await service.getDashboardSummary('http://localhost');
      for (const cat of Object.values(summary.categories)) {
        expect(typeof cat.description).toBe('string');
        expect(cat.description.length).toBeGreaterThan(0);
      }
    });
  });
});
