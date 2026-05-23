import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PrometheusService } from './prometheus.service';

// Keep prom-client real so we can verify actual metric output
// but stub the DataSource so no DB is needed.
const mockDataSource = {
  query: jest.fn().mockResolvedValue([{ count: '5' }]),
};

describe('PrometheusService', () => {
  let service: PrometheusService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrometheusService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get(PrometheusService);
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    // Clear the registry between tests so metric names don't collide
    service.registry.clear();
  });

  describe('/metrics endpoint output', () => {
    it('returns a non-empty Prometheus text format string', async () => {
      const output = await service.getMetrics();
      expect(typeof output).toBe('string');
      expect(output.length).toBeGreaterThan(0);
    });

    it('includes http_requests_total in output after a request is observed', async () => {
      service.observeHttpRequest('GET', '/api/v1/trades', 200, 0.05);
      const output = await service.getMetrics();
      expect(output).toContain('http_requests_total');
    });

    it('includes http_request_duration_seconds histogram', async () => {
      service.observeHttpRequest('POST', '/api/v1/signals', 201, 0.12);
      const output = await service.getMetrics();
      expect(output).toContain('http_request_duration_seconds');
    });

    it('includes cache hit/miss counters', async () => {
      service.cacheHitsTotal.inc({ layer: 'l1' });
      service.cacheMissesTotal.inc({ layer: 'l2' });
      const output = await service.getMetrics();
      expect(output).toContain('cache_hits_total');
      expect(output).toContain('cache_misses_total');
    });

    it('includes job queue gauges', async () => {
      service.jobQueueSize.set({ queue: 'notifications' }, 3);
      service.jobQueueActive.set({ queue: 'notifications' }, 1);
      const output = await service.getMetrics();
      expect(output).toContain('job_queue_waiting');
      expect(output).toContain('job_queue_active');
    });

    it('includes nodejs default metrics', async () => {
      const output = await service.getMetrics();
      expect(output).toContain('nodejs_');
    });
  });

  describe('counter behaviour', () => {
    it('increments http_requests_total on each call', async () => {
      service.observeHttpRequest('GET', '/api/v1/users', 200, 0.01);
      service.observeHttpRequest('GET', '/api/v1/users', 200, 0.02);

      const output = await service.getMetrics();
      // The counter line for this label set should show 2
      expect(output).toMatch(/http_requests_total\{[^}]*route="\/api\/v1\/users"[^}]*\} 2/);
    });

    it('increments http_requests_errors_total only for 4xx/5xx', async () => {
      service.observeHttpRequest('GET', '/api/v1/trades', 200, 0.01);
      service.observeHttpRequest('GET', '/api/v1/trades', 404, 0.01);
      service.observeHttpRequest('GET', '/api/v1/trades', 500, 0.01);

      const output = await service.getMetrics();
      expect(output).toContain('http_requests_errors_total');
      // 200 should NOT appear in errors
      expect(output).not.toMatch(/http_requests_errors_total\{[^}]*status_code="200"/);
    });

    it('records job_queue_failed_total counter', async () => {
      service.jobQueueFailed.inc({ queue: 'export-history' });
      service.jobQueueFailed.inc({ queue: 'export-history' });

      const output = await service.getMetrics();
      expect(output).toMatch(/job_queue_failed_total\{[^}]*queue="export-history"[^}]*\} 2/);
    });
  });

  describe('gauge behaviour', () => {
    it('sets and reflects active_users_gauge', async () => {
      service.activeUsersGauge.set(42);
      const output = await service.getMetrics();
      expect(output).toMatch(/active_users_gauge\s+42/);
    });

    it('updates job_queue_waiting gauge', async () => {
      service.jobQueueSize.set({ queue: 'priority-queue' }, 7);
      const output = await service.getMetrics();
      expect(output).toMatch(/job_queue_waiting\{[^}]*queue="priority-queue"[^}]*\} 7/);
    });

    it('sets service_health_status to 1 when up', async () => {
      service.serviceHealthStatus.set({ service: 'database' }, 1);
      const output = await service.getMetrics();
      expect(output).toMatch(/service_health_status\{[^}]*service="database"[^}]*\} 1/);
    });
  });

  describe('labels', () => {
    it('attaches service_type label to http metrics', async () => {
      service.observeHttpRequest('DELETE', '/api/v1/portfolio/1', 204, 0.03, 'portfolio');
      const output = await service.getMetrics();
      expect(output).toContain('service_type="portfolio"');
    });

    it('attaches endpoint label to http metrics', async () => {
      service.observeHttpRequest('GET', '/api/v1/analytics/summary', 200, 0.04, 'analytics');
      const output = await service.getMetrics();
      expect(output).toContain('route="/api/v1/analytics/summary"');
    });
  });

  describe('registerQueue', () => {
    it('polls waiting and active counts from a registered queue', async () => {
      const mockQueue = {
        getJobCounts: jest.fn().mockResolvedValue({ waiting: 5, active: 2 }),
      } as any;

      service.registerQueue('test-queue', mockQueue);
      // Trigger poll manually via the private method
      await (service as any).pollQueueMetrics();

      const output = await service.getMetrics();
      expect(output).toMatch(/job_queue_waiting\{[^}]*queue="test-queue"[^}]*\} 5/);
      expect(output).toMatch(/job_queue_active\{[^}]*queue="test-queue"[^}]*\} 2/);
    });

    it('does not throw if a queue poll fails', async () => {
      const brokenQueue = {
        getJobCounts: jest.fn().mockRejectedValue(new Error('redis down')),
      } as any;

      service.registerQueue('broken-queue', brokenQueue);
      await expect((service as any).pollQueueMetrics()).resolves.not.toThrow();
    });
  });
});
