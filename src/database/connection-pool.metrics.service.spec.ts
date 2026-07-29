import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ConnectionPoolMetricsService,
  POOL_EVENTS,
  PoolSnapshot,
} from './connection-pool.metrics.service';

const mockDataSource = {
  query: jest.fn(),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

const mockPrometheus = {
  dbPoolTotal: { set: jest.fn() },
  dbPoolActive: { set: jest.fn() },
  dbPoolIdle: { set: jest.fn() },
  dbPoolWaiting: { set: jest.fn() },
  dbPoolUtilizationRatio: { set: jest.fn() },
};

function buildRow(active: number, idle: number, waiting: number) {
  return [{ active: String(active), idle: String(idle), waiting: String(waiting) }];
}

describe('ConnectionPoolMetricsService', () => {
  let service: ConnectionPoolMetricsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.DATABASE_POOL_MAX = '30';
    process.env.DB_POOL_SATURATION_THRESHOLD = '0.90';
    process.env.DB_POOL_HIGH_UTIL_THRESHOLD = '0.75';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionPoolMetricsService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: 'PrometheusService', useValue: mockPrometheus },
      ],
    })
      .overrideProvider('PrometheusService')
      .useValue(mockPrometheus)
      .compile();

    // Manually construct to inject mocks directly
    service = new (ConnectionPoolMetricsService as any)(
      mockDataSource,
      mockEventEmitter,
      mockPrometheus,
    );
  });

  describe('collect()', () => {
    it('returns correct snapshot from pg_stat_activity', async () => {
      mockDataSource.query.mockResolvedValue(buildRow(5, 10, 0));

      const snapshot = await service.collect();

      expect(snapshot.active).toBe(5);
      expect(snapshot.idle).toBe(10);
      expect(snapshot.total).toBe(15);
      expect(snapshot.waiting).toBe(0);
      expect(snapshot.utilizationRatio).toBeCloseTo(15 / 30);
    });

    it('updates all Prometheus gauges', async () => {
      mockDataSource.query.mockResolvedValue(buildRow(6, 4, 1));

      await service.collect();

      expect(mockPrometheus.dbPoolTotal.set).toHaveBeenCalledWith(10);
      expect(mockPrometheus.dbPoolActive.set).toHaveBeenCalledWith(6);
      expect(mockPrometheus.dbPoolIdle.set).toHaveBeenCalledWith(4);
      expect(mockPrometheus.dbPoolWaiting.set).toHaveBeenCalledWith(1);
      expect(mockPrometheus.dbPoolUtilizationRatio.set).toHaveBeenCalledWith(10 / 30);
    });

    it('stores snapshot accessible via getLastSnapshot()', async () => {
      mockDataSource.query.mockResolvedValue(buildRow(3, 7, 0));
      await service.collect();
      const snap = service.getLastSnapshot();
      expect(snap).not.toBeNull();
      expect(snap!.total).toBe(10);
    });

    it('returns empty snapshot and does not throw on DB error', async () => {
      mockDataSource.query.mockRejectedValue(new Error('connection refused'));
      const snapshot = await service.collect();
      expect(snapshot.total).toBe(0);
      expect(snapshot.utilizationRatio).toBe(0);
    });
  });

  describe('threshold alerting', () => {
    it('emits SATURATION event when utilization >= 90%', async () => {
      // 27/30 = 90%
      mockDataSource.query.mockResolvedValue(buildRow(20, 7, 0));

      await service.collect();

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        POOL_EVENTS.SATURATION,
        expect.objectContaining({ total: 27 }),
      );
    });

    it('does NOT emit SATURATION when utilization < 90%', async () => {
      // 20/30 ≈ 66%
      mockDataSource.query.mockResolvedValue(buildRow(10, 10, 0));

      await service.collect();

      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
        POOL_EVENTS.SATURATION,
        expect.anything(),
      );
    });

    it('emits HIGH_UTILIZATION after 3 consecutive polls above 75%', async () => {
      // 24/30 = 80% — above high-util threshold
      mockDataSource.query.mockResolvedValue(buildRow(14, 10, 0));

      await service.collect();
      await service.collect();
      await service.collect();

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        POOL_EVENTS.HIGH_UTILIZATION,
        expect.objectContaining({ consecutivePolls: 3 }),
      );
    });

    it('resets consecutive counter when utilization drops below threshold', async () => {
      mockDataSource.query.mockResolvedValue(buildRow(14, 10, 0)); // 80%
      await service.collect();
      await service.collect();

      mockDataSource.query.mockResolvedValue(buildRow(5, 5, 0)); // 33%
      await service.collect();

      // Counter reset — no HIGH_UTILIZATION event should have fired
      const highUtilCalls = mockEventEmitter.emit.mock.calls.filter(
        ([event]) => event === POOL_EVENTS.HIGH_UTILIZATION,
      );
      expect(highUtilCalls).toHaveLength(0);
    });

    it('emits LEAK_SUSPECTED when waiting > 0 but utilization is low', async () => {
      // 5/30 ≈ 16% utilization but 2 waiting — suspicious
      mockDataSource.query.mockResolvedValue(buildRow(3, 2, 2));

      await service.collect();

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        POOL_EVENTS.LEAK_SUSPECTED,
        expect.objectContaining({ waiting: 2 }),
      );
    });

    it('does NOT emit LEAK_SUSPECTED when waiting > 0 but utilization is also high', async () => {
      // 25/30 ≈ 83% — high utilization explains the wait
      mockDataSource.query.mockResolvedValue(buildRow(20, 5, 2));

      await service.collect();

      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
        POOL_EVENTS.LEAK_SUSPECTED,
        expect.anything(),
      );
    });
  });

  describe('lifecycle', () => {
    it('getLastSnapshot() returns null before first collect', () => {
      expect(service.getLastSnapshot()).toBeNull();
    });

    it('onModuleDestroy clears the poll timer without throwing', () => {
      service.onModuleInit();
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });
});
