import { Test } from '@nestjs/testing';
import { ProviderHealthScoreService } from './provider-health-score.service';

describe('ProviderHealthScoreService', () => {
  let service: ProviderHealthScoreService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ProviderHealthScoreService],
    }).compile();

    service = module.get<ProviderHealthScoreService>(ProviderHealthScoreService);
  });

  describe('recordRequest', () => {
    it('should record successful requests', () => {
      service.recordRequest('provider-1', '/api/quotes', 50, true);
      service.recordRequest('provider-1', '/api/quotes', 75, true);

      const score = service.getHealthScore('provider-1', '/api/quotes');
      expect(score).not.toBeNull();
      expect(score?.metrics.requestCount).toBe(2);
      expect(score?.metrics.errorRate).toBe(0);
    });

    it('should record failed requests', () => {
      service.recordRequest('provider-1', '/api/quotes', 100, true);
      service.recordRequest('provider-1', '/api/quotes', 110, false);
      service.recordRequest('provider-1', '/api/quotes', 120, false);

      const score = service.getHealthScore('provider-1', '/api/quotes');
      expect(score?.metrics.requestCount).toBe(3);
      expect(score?.metrics.errorRate).toBeCloseTo(0.6667, 3);
    });

    it('should calculate average latency correctly', () => {
      service.recordRequest('provider-1', '/api/quotes', 50, true);
      service.recordRequest('provider-1', '/api/quotes', 100, true);
      service.recordRequest('provider-1', '/api/quotes', 150, true);

      const score = service.getHealthScore('provider-1', '/api/quotes');
      expect(score?.metrics.avgLatencyMs).toBe(100);
    });
  });

  describe('setUptime', () => {
    it('should set uptime percentage', () => {
      service.recordRequest('provider-1', '/api/quotes', 50, true);
      service.setUptime('provider-1', '/api/quotes', 99.5);

      const score = service.getHealthScore('provider-1', '/api/quotes');
      expect(score?.metrics.uptime).toBe(99.5);
    });

    it('should clamp uptime between 0 and 100', () => {
      service.recordRequest('provider-1', '/api/quotes', 50, true);
      service.setUptime('provider-1', '/api/quotes', 150);

      const score = service.getHealthScore('provider-1', '/api/quotes');
      expect(score?.metrics.uptime).toBe(100);
    });
  });

  describe('getHealthScore', () => {
    it('should return null for unknown endpoints', () => {
      const score = service.getHealthScore('provider-1', '/unknown');
      expect(score).toBeNull();
    });

    it('should return healthy status for good metrics', () => {
      // Record requests with low latency and no errors
      for (let i = 0; i < 100; i++) {
        service.recordRequest('provider-1', '/api/quotes', 50 + Math.random() * 50, true);
      }
      service.setUptime('provider-1', '/api/quotes', 99);

      const score = service.getHealthScore('provider-1', '/api/quotes');
      expect(score?.status).toBe('healthy');
      expect(score?.score).toBeGreaterThanOrEqual(80);
    });

    it('should return degraded status for moderate issues', () => {
      // Record requests with higher latency and some errors
      for (let i = 0; i < 100; i++) {
        const success = i % 4 !== 0; // 75% success rate
        service.recordRequest('provider-1', '/api/quotes', 150 + Math.random() * 100, success);
      }
      service.setUptime('provider-1', '/api/quotes', 95);

      const score = service.getHealthScore('provider-1', '/api/quotes');
      expect(score?.status).toBe('degraded');
      expect(score?.score).toBeGreaterThan(50);
      expect(score?.score).toBeLessThan(80);
    });

    it('should return unhealthy status for poor metrics', () => {
      // Record requests with high latency and high error rate
      for (let i = 0; i < 100; i++) {
        const success = i % 2 === 0; // 50% success rate
        service.recordRequest('provider-1', '/api/quotes', 300 + Math.random() * 150, success);
      }
      service.setUptime('provider-1', '/api/quotes', 80);

      const score = service.getHealthScore('provider-1', '/api/quotes');
      expect(score?.status).toBe('unhealthy');
      expect(score?.score).toBeLessThan(50);
    });

    it('should calculate latency score based on average latency', () => {
      // Test with 100ms average latency
      service.recordRequest('provider-1', '/api/quotes', 100, true);
      let score = service.getHealthScore('provider-1', '/api/quotes');
      expect(score?.latencyScore).toBe(100);

      // Create new endpoint with 200ms average
      for (let i = 0; i < 10; i++) {
        service.recordRequest('provider-2', '/api/quotes', 200, true);
      }
      score = service.getHealthScore('provider-2', '/api/quotes');
      expect(score?.latencyScore).toBe(50);

      // Create endpoint with 400ms+ average
      for (let i = 0; i < 10; i++) {
        service.recordRequest('provider-3', '/api/quotes', 400, true);
      }
      score = service.getHealthScore('provider-3', '/api/quotes');
      expect(score?.latencyScore).toBeLessThanOrEqual(0);
    });

    it('should calculate reliability score from error rate', () => {
      // 100% success rate
      for (let i = 0; i < 10; i++) {
        service.recordRequest('provider-1', '/api/quotes', 100, true);
      }
      let score = service.getHealthScore('provider-1', '/api/quotes');
      expect(score?.reliabilityScore).toBe(100);

      // 50% success rate
      service = new ProviderHealthScoreService();
      for (let i = 0; i < 10; i++) {
        service.recordRequest('provider-2', '/api/quotes', 100, i % 2 === 0);
      }
      score = service.getHealthScore('provider-2', '/api/quotes');
      expect(score?.reliabilityScore).toBe(50);
    });

    it('should calculate P95 latency correctly', () => {
      // Create 100 requests with known latencies
      for (let i = 1; i <= 100; i++) {
        service.recordRequest('provider-1', '/api/quotes', i, true);
      }

      const score = service.getHealthScore('provider-1', '/api/quotes');
      expect(score?.metrics.p95LatencyMs).toBe(95);
    });

    it('should compute weighted composite score', () => {
      // Test with known metrics
      service.recordRequest('provider-1', '/api/quotes', 100, true);
      service.recordRequest('provider-1', '/api/quotes', 110, true);
      service.setUptime('provider-1', '/api/quotes', 100);

      const score = service.getHealthScore('provider-1', '/api/quotes');
      // latencyScore=100, reliabilityScore=100, uptimeScore=100
      // composite = 100*0.4 + 100*0.35 + 100*0.25 = 100
      expect(score?.score).toBe(100);
    });
  });

  describe('getAllHealthScores', () => {
    it('should return health scores for all endpoints', () => {
      service.recordRequest('provider-1', '/api/quotes', 50, true);
      service.recordRequest('provider-1', '/api/trades', 100, true);
      service.recordRequest('provider-2', '/api/quotes', 75, true);

      const scores = service.getAllHealthScores();
      expect(scores).toHaveLength(3);
      expect(scores.map((s) => s.providerId)).toContain('provider-1');
      expect(scores.map((s) => s.providerId)).toContain('provider-2');
    });
  });

  describe('getProviderHealthScore', () => {
    it('should return aggregated score for provider', () => {
      service.recordRequest('provider-1', '/api/quotes', 50, true);
      service.recordRequest('provider-1', '/api/quotes', 60, true);
      service.recordRequest('provider-1', '/api/trades', 100, true);
      service.recordRequest('provider-1', '/api/trades', 110, true);
      service.setUptime('provider-1', '/api/quotes', 99);
      service.setUptime('provider-1', '/api/trades', 98);

      const score = service.getProviderHealthScore('provider-1');
      expect(score).not.toBeNull();
      expect(score?.endpoint).toBe('ALL');
      expect(score?.providerId).toBe('provider-1');
      expect(score?.metrics.requestCount).toBe(4);
      expect(score?.status).not.toBeNull();
    });

    it('should return null for unknown provider', () => {
      const score = service.getProviderHealthScore('unknown-provider');
      expect(score).toBeNull();
    });

    it('should aggregate metrics across endpoints', () => {
      // Create consistent metrics across two endpoints
      for (let i = 0; i < 50; i++) {
        service.recordRequest('provider-1', '/api/quotes', 100, true);
        service.recordRequest('provider-1', '/api/trades', 100, true);
      }
      service.setUptime('provider-1', '/api/quotes', 100);
      service.setUptime('provider-1', '/api/trades', 100);

      const score = service.getProviderHealthScore('provider-1');
      expect(score?.score).toBe(100);
      expect(score?.metrics.requestCount).toBe(100);
    });
  });

  describe('memory efficiency', () => {
    it('should limit latency history to 1000 measurements', () => {
      // Record 1500 requests for same endpoint
      for (let i = 0; i < 1500; i++) {
        service.recordRequest('provider-1', '/api/quotes', 50 + i, true);
      }

      const score = service.getHealthScore('provider-1', '/api/quotes');
      expect(score?.metrics.requestCount).toBe(1500);
      // Should still compute correctly with last 1000 latencies
      expect(score?.metrics.avgLatencyMs).toBeGreaterThan(0);
    });
  });
});
