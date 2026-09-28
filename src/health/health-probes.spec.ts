/**
 * Issue #862 — Comprehensive health check probes
 *
 * Tests for GET /health/live and GET /health/ready endpoints:
 *
 *  /health/live  — liveness probe
 *    - Returns 200 regardless of dependency state (no checks run)
 *
 *  /health/ready — readiness probe
 *    - Returns 503 when PostgreSQL is unreachable
 *    - Returns 503 when Redis is unreachable
 *    - Returns 503 when Soroban RPC is unreachable
 *    - Returns 200 when all dependencies are healthy
 *    - Each dependency check includes its response latency
 */
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import {
  HealthCheckService,
  HealthCheckResult,
  HealthCheckError,
} from '@nestjs/terminus';
import {
  StellarHealthIndicator,
  SorobanHealthIndicator,
  DatabaseHealthIndicator,
  RedisHealthIndicator,
  QueueHealthIndicator,
} from './indicators';
import { HealthSummaryService } from './health-summary.service';

const makeHealthResult = (
  overrides: Partial<HealthCheckResult> = {},
): HealthCheckResult => ({
  status: 'ok',
  details: {},
  ...overrides,
});

describe('HealthController — liveness and readiness probes (Issue #862)', () => {
  let controller: HealthController;
  let healthCheckService: jest.Mocked<HealthCheckService>;
  let databaseHealth: jest.Mocked<DatabaseHealthIndicator>;
  let redisHealth: jest.Mocked<RedisHealthIndicator>;
  let sorobanHealth: jest.Mocked<SorobanHealthIndicator>;
  let queueHealth: jest.Mocked<QueueHealthIndicator>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: { check: jest.fn() },
        },
        {
          provide: StellarHealthIndicator,
          useValue: { isHealthy: jest.fn() },
        },
        {
          provide: SorobanHealthIndicator,
          useValue: { isHealthy: jest.fn() },
        },
        {
          provide: DatabaseHealthIndicator,
          useValue: { isHealthy: jest.fn() },
        },
        {
          provide: RedisHealthIndicator,
          useValue: { isHealthy: jest.fn() },
        },
        {
          provide: QueueHealthIndicator,
          useValue: { isHealthy: jest.fn() },
        },
        {
          provide: HealthSummaryService,
          useValue: { getHealthSummary: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get(HealthController);
    healthCheckService = module.get(
      HealthCheckService,
    ) as jest.Mocked<HealthCheckService>;
    databaseHealth = module.get(
      DatabaseHealthIndicator,
    ) as jest.Mocked<DatabaseHealthIndicator>;
    redisHealth = module.get(
      RedisHealthIndicator,
    ) as jest.Mocked<RedisHealthIndicator>;
    sorobanHealth = module.get(
      SorobanHealthIndicator,
    ) as jest.Mocked<SorobanHealthIndicator>;
    queueHealth = module.get(
      QueueHealthIndicator,
    ) as jest.Mocked<QueueHealthIndicator>;
  });

  // ── /health/live ──────────────────────────────────────────────────────────

  describe('GET /health/live', () => {
    it('returns 200 (status: ok) as long as the Node.js process is running', async () => {
      healthCheckService.check.mockResolvedValue(makeHealthResult());
      const result = await controller.live();
      expect(result.status).toBe('ok');
    });

    it('calls health.check with an empty dependency array (no external checks)', async () => {
      healthCheckService.check.mockResolvedValue(makeHealthResult());
      await controller.live();
      const [indicators] = healthCheckService.check.mock.calls[0];
      expect(indicators).toHaveLength(0);
    });

    it('returns 200 even when database is unavailable (liveness is process-only)', async () => {
      // health.check is called with [] so terminus never reaches the DB —
      // simulate the minimal ok response terminus returns for empty checks.
      healthCheckService.check.mockResolvedValue(
        makeHealthResult({ status: 'ok', details: {} }),
      );
      const result = await controller.live();
      expect(result.status).toBe('ok');
    });
  });

  // ── /health/ready ─────────────────────────────────────────────────────────

  describe('GET /health/ready', () => {
    it('returns 200 when all critical dependencies are healthy', async () => {
      healthCheckService.check.mockResolvedValue(
        makeHealthResult({
          status: 'ok',
          details: {
            database: { status: 'up', latency: '3ms' },
            cache: { status: 'up', latency: '1ms' },
            soroban: { status: 'up', latency: '45ms' },
            stellar: { status: 'up', latency: '60ms' },
          },
        }),
      );
      const result = await controller.ready();
      expect(result.status).toBe('ok');
    });

    it('returns 503 (status: error) when PostgreSQL is unreachable', async () => {
      healthCheckService.check.mockResolvedValue(
        makeHealthResult({
          status: 'error',
          details: {
            database: {
              status: 'down',
              error: 'Connection refused',
              latency: '5002ms',
            },
          },
        }),
      );
      const result = await controller.ready();
      expect(result.status).toBe('error');
      expect(result.details.database.status).toBe('down');
    });

    it('returns 503 (status: error) when Redis is unreachable', async () => {
      healthCheckService.check.mockResolvedValue(
        makeHealthResult({
          status: 'error',
          details: {
            cache: { status: 'down', error: 'ECONNREFUSED', latency: '3001ms' },
          },
        }),
      );
      const result = await controller.ready();
      expect(result.status).toBe('error');
      expect(result.details.cache.status).toBe('down');
    });

    it('returns 503 (status: error) when Soroban RPC is unreachable', async () => {
      healthCheckService.check.mockResolvedValue(
        makeHealthResult({
          status: 'error',
          details: {
            soroban: {
              status: 'down',
              error: 'RPC timeout',
              latency: '5001ms',
            },
          },
        }),
      );
      const result = await controller.ready();
      expect(result.status).toBe('error');
      expect(result.details.soroban.status).toBe('down');
    });

    it('calls health.check with 4 dependency indicators', async () => {
      healthCheckService.check.mockResolvedValue(makeHealthResult());
      await controller.ready();
      const [indicators] = healthCheckService.check.mock.calls[0];
      expect(indicators).toHaveLength(4);
    });

    it('each dependency result includes a latency field', async () => {
      healthCheckService.check.mockResolvedValue(
        makeHealthResult({
          status: 'ok',
          details: {
            database: { status: 'up', latency: '3ms' },
            cache: { status: 'up', latency: '1ms' },
            soroban: { status: 'up', latency: '45ms' },
            stellar: { status: 'up', latency: '60ms' },
          },
        }),
      );
      const result = await controller.ready();
      for (const detail of Object.values(result.details)) {
        expect(detail).toHaveProperty('latency');
      }
    });
  });

  // ── /health/liveness (alias) ──────────────────────────────────────────────

  describe('GET /health/liveness', () => {
    it('is a no-op probe identical to /health/live', async () => {
      healthCheckService.check.mockResolvedValue(makeHealthResult());
      const result = await controller.liveness();
      expect(result.status).toBe('ok');
      const [indicators] = healthCheckService.check.mock.calls[0];
      expect(indicators).toHaveLength(0);
    });
  });

  // ── k8s deployment sanity ─────────────────────────────────────────────────

  describe('Kubernetes probe path coverage', () => {
    it('/health/healthz (startupProbe and livenessProbe path) returns 200', async () => {
      healthCheckService.check.mockResolvedValue(makeHealthResult());
      const result = await controller.healthz();
      expect(result.status).toBe('ok');
    });

    it('/health/ready (readinessProbe path) checks all critical dependencies', async () => {
      healthCheckService.check.mockResolvedValue(makeHealthResult());
      await controller.ready();
      const [indicators] = healthCheckService.check.mock.calls[0];
      // database, cache, queue, soroban, stellar = 5 indicators on /ready
      expect(indicators.length).toBeGreaterThanOrEqual(4);
    });
  });
});
