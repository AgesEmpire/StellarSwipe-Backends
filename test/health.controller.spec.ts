import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from '../src/health/health.controller';
import { HealthCheckService } from '@nestjs/terminus';
import {
  DatabaseHealthIndicator,
  RedisHealthIndicator,
  StellarHealthIndicator,
  SorobanHealthIndicator,
} from '../src/health/indicators';
import { HealthSummaryService } from '../src/health/health-summary.service';
import { HealthMetricsAuthGuard } from '../src/common/guards/health-metrics-auth.guard';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { ApiKeyAuthGuard } from '../src/api-keys/guards/api-key-auth.guard';

const mockHealthCheck = jest.fn();
const mockDbHealth = { isHealthy: jest.fn() };
const mockRedisHealth = { isHealthy: jest.fn() };
const mockStellarHealth = { isHealthy: jest.fn() };
const mockSorobanHealth = { isHealthy: jest.fn() };

describe('HealthController (#370)', () => {
  let controller: HealthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: { check: mockHealthCheck } },
        { provide: DatabaseHealthIndicator, useValue: mockDbHealth },
        { provide: RedisHealthIndicator, useValue: mockRedisHealth },
        { provide: StellarHealthIndicator, useValue: mockStellarHealth },
        { provide: SorobanHealthIndicator, useValue: mockSorobanHealth },
        HealthMetricsAuthGuard,
        { provide: JwtAuthGuard, useValue: { canActivate: jest.fn().mockResolvedValue(true) } },
        { provide: ApiKeyAuthGuard, useValue: { canActivate: jest.fn().mockResolvedValue(false) } },
        { provide: HealthSummaryService, useValue: { getHealthSummary: jest.fn() } },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it('should pass startup health check when DB and cache are healthy', async () => {
    mockHealthCheck.mockResolvedValue({ status: 'ok', info: {}, error: {}, details: {} });
    await expect(controller.onApplicationBootstrap()).resolves.not.toThrow();
    expect(mockHealthCheck).toHaveBeenCalledTimes(1);
  });

  it('should retry and exit if dependencies remain unhealthy', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    mockHealthCheck.mockRejectedValue(new Error('DB unavailable'));

    jest.useRealTimers();
    const bootstrapPromise = controller.onApplicationBootstrap();
    await bootstrapPromise.catch(() => {});

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  }, 30000);

  it('GET /health should check all indicators', async () => {
    mockHealthCheck.mockResolvedValue({ status: 'ok', info: {}, error: {}, details: {} });
    await controller.check();
    expect(mockHealthCheck).toHaveBeenCalledWith(expect.arrayContaining([
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    ]));
  });

  it('GET /health/readiness should check DB and cache only', async () => {
    mockHealthCheck.mockResolvedValue({ status: 'ok', info: {}, error: {}, details: {} });
    await controller.readiness();
    expect(mockHealthCheck).toHaveBeenCalledWith(expect.arrayContaining([
      expect.any(Function),
      expect.any(Function),
    ]));
  });
});
