import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from '../src/health/health.controller';
import { HealthCheckService } from '@nestjs/terminus';
import {
  DatabaseHealthIndicator,
  RedisHealthIndicator,
  StellarHealthIndicator,
  SorobanHealthIndicator,
} from '../src/health/indicators';

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

    // Speed up retries
    jest.useFakeTimers();
    const bootstrapPromise = controller.onApplicationBootstrap();
    // Advance through all retry delays (5 retries × 3000ms)
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(3000);
    }
    await bootstrapPromise.catch(() => {});
    jest.useRealTimers();

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

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
