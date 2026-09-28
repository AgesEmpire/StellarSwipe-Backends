import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  QueryMonitorService,
  SLOW_QUERY_EVENT,
  SLOW_RATE_EVENT,
} from './query-monitor.service';

const mockDataSource = () => ({
  logger: {
    logQuery: jest.fn(),
    logQuerySlow: jest.fn(),
  },
});

const mockEmitter = () => ({ emit: jest.fn() });

describe('QueryMonitorService', () => {
  let service: QueryMonitorService;
  let emitter: ReturnType<typeof mockEmitter>;

  beforeEach(async () => {
    // Set a low threshold so tests don't need huge durations
    process.env.SLOW_QUERY_THRESHOLD_MS = '100';
    process.env.SLOW_QUERY_RATE_ALERT_THRESHOLD = '3';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryMonitorService,
        { provide: getDataSourceToken(), useFactory: mockDataSource },
        { provide: EventEmitter2, useFactory: mockEmitter },
      ],
    }).compile();

    service = module.get(QueryMonitorService);
    emitter = module.get(EventEmitter2);

    // Initialise without starting the interval timer
    jest.useFakeTimers();
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    service.reset();
    jest.useRealTimers();
  });

  // ── record ────────────────────────────────────────────────────────────────

  describe('record', () => {
    it('does not emit for fast queries', () => {
      service.record('SELECT 1', [], 50);
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('emits SLOW_QUERY_EVENT for slow queries', () => {
      service.record('SELECT * FROM signals', [], 250);
      expect(emitter.emit).toHaveBeenCalledWith(
        SLOW_QUERY_EVENT,
        expect.objectContaining({ durationMs: 250 }),
      );
    });

    it('truncates long queries to 300 chars', () => {
      const longQuery = 'SELECT ' + 'x'.repeat(400);
      service.record(longQuery, [], 300);

      const [, payload] = (emitter.emit as jest.Mock).mock.calls[0];
      expect(payload.query.length).toBeLessThanOrEqual(301); // 300 + ellipsis char
    });

    it('does not include raw parameter values in the record', () => {
      service.record('SELECT $1', ['secret-value'], 300);
      const [, payload] = (emitter.emit as jest.Mock).mock.calls[0];
      expect(JSON.stringify(payload)).not.toContain('secret-value');
      expect(payload.paramCount).toBe(1);
    });
  });

  // ── getStats ──────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns correct counts after recording', () => {
      service.record('fast', [], 10);
      service.record('slow1', [], 200);
      service.record('slow2', [], 300);

      const stats = service.getStats();
      expect(stats.totalRecorded).toBe(3);
      expect(stats.slowQueryCount).toBe(2);
      expect(stats.thresholdMs).toBe(100);
    });

    it('calculates p95 duration', () => {
      for (let i = 1; i <= 20; i++) {
        service.record(`q${i}`, [], i * 10);
      }
      const stats = service.getStats();
      expect(stats.p95DurationMs).toBeGreaterThan(0);
    });
  });

  // ── getSlowQueries ────────────────────────────────────────────────────────

  describe('getSlowQueries', () => {
    it('returns slow queries newest first', () => {
      service.record('first slow', [], 150);
      service.record('second slow', [], 250);

      const results = service.getSlowQueries(10);
      expect(results[0].query).toBe('second slow');
      expect(results[1].query).toBe('first slow');
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        service.record(`slow ${i}`, [], 200);
      }
      expect(service.getSlowQueries(3)).toHaveLength(3);
    });
  });

  // ── rate alert ────────────────────────────────────────────────────────────

  describe('slow query rate alert', () => {
    it('emits SLOW_RATE_EVENT when rate threshold is exceeded', () => {
      // Record 4 slow queries (threshold is 3)
      for (let i = 0; i < 4; i++) {
        service.record(`slow ${i}`, [], 200);
      }

      // Trigger the rate check
      jest.advanceTimersByTime(60_000);

      expect(emitter.emit).toHaveBeenCalledWith(
        SLOW_RATE_EVENT,
        expect.objectContaining({ count: 4 }),
      );
    });

    it('does not emit SLOW_RATE_EVENT when below threshold', () => {
      service.record('slow', [], 200); // only 1, threshold is 3

      jest.advanceTimersByTime(60_000);

      const rateCalls = (emitter.emit as jest.Mock).mock.calls.filter(
        ([name]) => name === SLOW_RATE_EVENT,
      );
      expect(rateCalls).toHaveLength(0);
    });
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears all history', () => {
      service.record('slow', [], 300);
      service.reset();

      const stats = service.getStats();
      expect(stats.totalRecorded).toBe(0);
      expect(stats.slowQueryCount).toBe(0);
    });
  });
});
