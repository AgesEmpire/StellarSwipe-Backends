// Mock the entire PrometheusService module so prom-client is never resolved
jest.mock('../monitoring/metrics/prometheus.service', () => ({
  PrometheusService: jest.fn(),
}));

jest.mock('../monitoring/metrics/custom-metrics', () => ({
  recordHealthCheck: jest.fn(),
}));

import { HealthCheckError } from '@nestjs/terminus';
import { HealthSummaryService } from './health-summary.service';
import { recordHealthCheck } from '../monitoring/metrics/custom-metrics';

const mockRecordHealthCheck = recordHealthCheck as jest.Mock;

const makeService = (overrides: {
  dbHealthy?: boolean;
  cacheHealthy?: boolean;
  stellarHealthy?: boolean;
  sorobanHealthy?: boolean;
} = {}) => {
  const {
    dbHealthy = true,
    cacheHealthy = true,
    stellarHealthy = true,
    sorobanHealthy = true,
  } = overrides;

  const up = (key: string) => Promise.resolve({ [key]: { status: 'up' } });
  const down = (key: string, msg = 'error') =>
    Promise.reject(new HealthCheckError(msg, { [key]: { status: 'down', error: msg } }));

  const databaseHealth = { isHealthy: jest.fn(() => (dbHealthy ? up('database') : down('database', 'db error'))) };
  const redisHealth = { isHealthy: jest.fn(() => (cacheHealthy ? up('cache') : down('cache', 'redis error'))) };
  const stellarHealth = { isHealthy: jest.fn(() => (stellarHealthy ? up('stellar') : down('stellar', 'stellar error'))) };
  const sorobanHealth = { isHealthy: jest.fn(() => (sorobanHealthy ? up('soroban') : down('soroban', 'soroban error'))) };

  const service = new HealthSummaryService(
    {} as any, // HealthCheckService not used by getHealthSummary
    stellarHealth as any,
    sorobanHealth as any,
    databaseHealth as any,
    redisHealth as any,
    {} as any, // PrometheusService — recordHealthCheck is mocked at module level
  );

  return { service, databaseHealth, redisHealth, stellarHealth, sorobanHealth };
};

describe('HealthSummaryService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getHealthSummary', () => {
    it('returns overall "up" when all services are healthy', async () => {
      const { service } = makeService();
      const summary = await service.getHealthSummary();
      expect(summary.overall).toBe('up');
    });

    it('returns overall "down" when a critical service is down', async () => {
      const { service } = makeService({ dbHealthy: false });
      const summary = await service.getHealthSummary();
      expect(summary.overall).toBe('down');
    });

    it('includes all four services in the response', async () => {
      const { service } = makeService();
      const summary = await service.getHealthSummary();
      expect(summary.services).toHaveProperty('database');
      expect(summary.services).toHaveProperty('cache');
      expect(summary.services).toHaveProperty('stellar');
      expect(summary.services).toHaveProperty('soroban');
    });

    it('marks a failed service as "down"', async () => {
      const { service } = makeService({ cacheHealthy: false });
      const summary = await service.getHealthSummary();
      expect(summary.services.cache.status).toBe('down');
    });

    it('marks a healthy service as "up"', async () => {
      const { service } = makeService();
      const summary = await service.getHealthSummary();
      expect(summary.services.database.status).toBe('up');
    });

    it('includes timestamp and uptime', async () => {
      const { service } = makeService();
      const summary = await service.getHealthSummary();
      expect(summary.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof summary.uptime).toBe('number');
      expect(summary.uptime).toBeGreaterThanOrEqual(0);
    });

    it('records health gauge as up (true) for all healthy services', async () => {
      const { service } = makeService();
      await service.getHealthSummary();
      expect(mockRecordHealthCheck).toHaveBeenCalledWith(expect.anything(), 'database', true);
      expect(mockRecordHealthCheck).toHaveBeenCalledWith(expect.anything(), 'cache', true);
      expect(mockRecordHealthCheck).toHaveBeenCalledWith(expect.anything(), 'stellar', true);
      expect(mockRecordHealthCheck).toHaveBeenCalledWith(expect.anything(), 'soroban', true);
    });

    it('records health gauge as down (false) for a failing service', async () => {
      const { service } = makeService({ stellarHealthy: false });
      await service.getHealthSummary();
      expect(mockRecordHealthCheck).toHaveBeenCalledWith(expect.anything(), 'stellar', false);
    });

    it('returns a summary when multiple services are down', async () => {
      const { service } = makeService({ dbHealthy: false, cacheHealthy: false });
      const summary = await service.getHealthSummary();
      expect(summary.overall).toBe('down');
      expect(summary.services.database.status).toBe('down');
      expect(summary.services.cache.status).toBe('down');
    });

    it('returns overall "down" when only external services fail', async () => {
      const { service } = makeService({ stellarHealthy: false, sorobanHealthy: false });
      const summary = await service.getHealthSummary();
      expect(summary.overall).toBe('down');
    });
  });
});
