import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PerformanceWindowsQueryDto } from '../dto/performance-windows.dto';
import {
  PerformanceWindow,
  SUPPORTED_PERFORMANCE_WINDOWS,
  resolveWindowBounds,
} from '../performance-window';
import {
  PerformanceSample,
  ProviderWindowPerformanceService,
} from './provider-window-performance.service';

describe('Provider performance comparison windows (#1521)', () => {
  const asOf = new Date('2026-11-23T12:34:56.789Z');
  const alignedEnd = new Date('2026-11-23T12:34:00.000Z');
  const DAY = 24 * 60 * 60 * 1000;

  let samples: PerformanceSample[];
  const source = { fetchSamples: jest.fn(async () => samples) };
  const service = new ProviderWindowPerformanceService(source);

  beforeEach(() => {
    samples = [];
    source.fetchSamples.mockClear();
  });

  describe('window enumeration and validation', () => {
    it('enumerates exactly the supported windows', () => {
      expect(SUPPORTED_PERFORMANCE_WINDOWS).toEqual(['24h', '7d', '30d', '90d']);
    });

    const validate = (query: Record<string, unknown>) =>
      validateSync(plainToInstance(PerformanceWindowsQueryDto, query));

    it('accepts comma-separated supported windows', () => {
      const dto = plainToInstance(PerformanceWindowsQueryDto, { windows: '7d, 30d' });
      expect(dto.windows).toEqual(['7d', '30d']);
      expect(validateSync(dto)).toHaveLength(0);
    });

    it.each([
      [{ windows: '1y' }],
      [{ windows: '' }],
      [{ windows: '7d,7d' }],
      [{ windows: '7d', asOf: 'yesterday' }],
    ])('rejects invalid query %p', (q) => {
      expect(validate(q).length).toBeGreaterThan(0);
    });

    it('throws for unsupported windows at the domain level', () => {
      expect(() => resolveWindowBounds('1y' as PerformanceWindow, asOf)).toThrow(RangeError);
    });
  });

  describe('boundaries', () => {
    it('aligns all windows to a shared, minute-truncated exclusive end', async () => {
      const result = await service.getWindowPerformance(
        'p1',
        [PerformanceWindow.LAST_24H, PerformanceWindow.LAST_7D],
        asOf,
      );
      expect(result.asOf).toBe(alignedEnd.toISOString());
      expect(result.windows[0]).toMatchObject({
        window: '24h',
        start: new Date(alignedEnd.getTime() - DAY).toISOString(),
        end: alignedEnd.toISOString(),
      });
      expect(result.windows[1].start).toBe(new Date(alignedEnd.getTime() - 7 * DAY).toISOString());
      // fetched once for the widest window
      expect(source.fetchSamples).toHaveBeenCalledTimes(1);
      expect(source.fetchSamples).toHaveBeenCalledWith(
        'p1',
        new Date(alignedEnd.getTime() - 7 * DAY),
        alignedEnd,
      );
    });

    it('includes the start instant and excludes the end instant', async () => {
      const start = new Date(alignedEnd.getTime() - DAY);
      samples = [
        { closedAt: start, pnl: 10, win: true }, // inclusive start -> in
        { closedAt: new Date(start.getTime() - 1), pnl: 99, win: true }, // just before -> out
        { closedAt: new Date(alignedEnd.getTime() - 1), pnl: -4, win: false }, // just before end -> in
        { closedAt: alignedEnd, pnl: 50, win: true }, // exclusive end -> out
      ];
      const [m] = (await service.getWindowPerformance('p1', [PerformanceWindow.LAST_24H], asOf))
        .windows;
      expect(m.sampleCount).toBe(2);
      expect(m.wins).toBe(1);
      expect(m.losses).toBe(1);
      expect(m.winRate).toBe(50);
      expect(m.totalPnl).toBe(6);
      expect(m.averagePnl).toBe(3);
    });

    it('nests windows consistently from a single sample set', async () => {
      samples = [
        { closedAt: new Date(alignedEnd.getTime() - 2 * 60 * 60 * 1000), pnl: 1, win: true },
        { closedAt: new Date(alignedEnd.getTime() - 3 * DAY), pnl: 2, win: true },
        { closedAt: new Date(alignedEnd.getTime() - 20 * DAY), pnl: -1, win: false },
      ];
      const res = await service.getWindowPerformance(
        'p1',
        [PerformanceWindow.LAST_24H, PerformanceWindow.LAST_7D, PerformanceWindow.LAST_30D],
        asOf,
      );
      expect(res.windows.map((w) => w.sampleCount)).toEqual([1, 2, 3]);
    });
  });

  it('returns explicit empty-sample metrics', async () => {
    const res = await service.getWindowPerformance('p1', [PerformanceWindow.LAST_90D], asOf);
    expect(res.windows[0]).toEqual({
      window: '90d',
      start: new Date(alignedEnd.getTime() - 90 * DAY).toISOString(),
      end: alignedEnd.toISOString(),
      sampleCount: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      totalPnl: 0,
      averagePnl: null,
    });
  });
});
