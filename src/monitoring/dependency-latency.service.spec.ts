import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  DependencyLatencyService,
  DependencyType,
  DependencyStatus,
} from './dependency-latency.service';
import { PrometheusService } from './metrics/prometheus.service';

const mockRegistry = {};
const mockHistogram = { observe: jest.fn() };
const mockGauge = { set: jest.fn() };
const mockCounter = { inc: jest.fn() };

jest.mock('prom-client', () => ({
  Histogram: jest.fn(() => mockHistogram),
  Gauge: jest.fn(() => mockGauge),
  Counter: jest.fn(() => mockCounter),
}));

describe('DependencyLatencyService', () => {
  let service: DependencyLatencyService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DependencyLatencyService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string, def: unknown) => {
              if (key === 'monitoring.degradedThresholdMs') return 500;
              if (key === 'monitoring.unhealthyThresholdMs') return 2000;
              if (key === 'monitoring.unhealthyErrorRate') return 0.1;
              return def;
            }),
          },
        },
        {
          provide: PrometheusService,
          useValue: { registry: mockRegistry },
        },
      ],
    }).compile();

    service = module.get(DependencyLatencyService);
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('record', () => {
    it('increments calls counter on each record', () => {
      service.record('db', DependencyType.DATABASE, 50, true);
      service.record('db', DependencyType.DATABASE, 60, true);

      expect(mockCounter.inc).toHaveBeenCalledTimes(2);
    });

    it('increments error counter on failure', () => {
      service.record('redis', DependencyType.CACHE, 200, false);

      expect(mockCounter.inc).toHaveBeenCalledWith(
        expect.objectContaining({ dependency: 'redis', type: DependencyType.CACHE }),
      );
    });

    it('observes latency histogram', () => {
      service.record('horizon', DependencyType.STELLAR_HORIZON, 120, true);

      expect(mockHistogram.observe).toHaveBeenCalledWith(
        expect.objectContaining({ dependency: 'horizon', success: 'true' }),
        0.12,
      );
    });
  });

  describe('getSnapshot', () => {
    it('returns UNKNOWN for a dependency with no samples', () => {
      const snap = service.getSnapshot('unknown-dep', DependencyType.EXTERNAL_HTTP);

      expect(snap.status).toBe(DependencyStatus.UNKNOWN);
      expect(snap.totalCalls).toBe(0);
    });

    it('returns HEALTHY when p95 is below degraded threshold', () => {
      for (let i = 0; i < 20; i++) {
        service.record('db', DependencyType.DATABASE, 100 + i, true);
      }

      const snap = service.getSnapshot('db', DependencyType.DATABASE);

      expect(snap.status).toBe(DependencyStatus.HEALTHY);
      expect(snap.totalCalls).toBe(20);
    });

    it('returns DEGRADED when p95 exceeds degraded threshold', () => {
      for (let i = 0; i < 20; i++) {
        // 95th percentile will be around 570ms
        service.record('slow-dep', DependencyType.EXTERNAL_HTTP, 400 + i * 10, true);
      }

      const snap = service.getSnapshot('slow-dep', DependencyType.EXTERNAL_HTTP);

      expect(snap.status).toBe(DependencyStatus.DEGRADED);
    });

    it('returns UNHEALTHY when error rate exceeds threshold', () => {
      for (let i = 0; i < 9; i++) {
        service.record('flaky', DependencyType.EXTERNAL_HTTP, 50, false);
      }
      service.record('flaky', DependencyType.EXTERNAL_HTTP, 50, true);

      const snap = service.getSnapshot('flaky', DependencyType.EXTERNAL_HTTP);

      expect(snap.status).toBe(DependencyStatus.UNHEALTHY);
      expect(snap.errorRate).toBeGreaterThanOrEqual(90);
    });

    it('calculates percentiles correctly', () => {
      const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      durations.forEach((d) => service.record('svc', DependencyType.QUEUE, d, true));

      const snap = service.getSnapshot('svc', DependencyType.QUEUE);

      expect(snap.p50Ms).toBeGreaterThanOrEqual(50);
      expect(snap.p99Ms).toBeLessThanOrEqual(100);
      expect(snap.p99Ms).toBeGreaterThan(snap.p50Ms);
    });
  });

  describe('measure', () => {
    it('records successful operation latency', async () => {
      const result = await service.measure('db', DependencyType.DATABASE, async () => {
        return 42;
      });

      expect(result).toBe(42);
      expect(mockHistogram.observe).toHaveBeenCalledWith(
        expect.objectContaining({ success: 'true' }),
        expect.any(Number),
      );
    });

    it('records failure and rethrows', async () => {
      const boom = new Error('db down');

      await expect(
        service.measure('db', DependencyType.DATABASE, async () => {
          throw boom;
        }),
      ).rejects.toThrow('db down');

      expect(mockHistogram.observe).toHaveBeenCalledWith(
        expect.objectContaining({ success: 'false' }),
        expect.any(Number),
      );
    });
  });

  describe('getAllSnapshots', () => {
    it('returns a snapshot per distinct dependency', () => {
      service.record('db', DependencyType.DATABASE, 10, true);
      service.record('redis', DependencyType.CACHE, 5, true);

      const snaps = service.getAllSnapshots();

      expect(snaps).toHaveLength(2);
      expect(snaps.map((s) => s.name)).toEqual(expect.arrayContaining(['db', 'redis']));
    });
  });

  describe('isDegraded', () => {
    it('returns false for a healthy dependency', () => {
      service.record('fast', DependencyType.DATABASE, 10, true);
      expect(service.isDegraded('fast', DependencyType.DATABASE)).toBe(false);
    });

    it('returns false for unknown dependency', () => {
      expect(service.isDegraded('noop', DependencyType.DATABASE)).toBe(false);
    });
  });
});
