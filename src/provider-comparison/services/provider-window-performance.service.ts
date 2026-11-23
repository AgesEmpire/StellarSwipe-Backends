import { Inject, Injectable } from '@nestjs/common';
import {
  PerformanceWindow,
  WindowBounds,
  isWithinWindow,
  resolveWindowBounds,
} from '../performance-window';
import {
  ProviderWindowPerformanceDto,
  WindowMetricsDto,
} from '../dto/performance-windows.dto';

/** One closed provider signal used as a performance sample. */
export interface PerformanceSample {
  closedAt: Date;
  pnl: number;
  /** true = win, false = loss; neutral outcomes (pnl 0, expired) count as neither. */
  win: boolean | null;
}

export interface PerformanceSampleSource {
  /** Returns samples with `start <= closedAt < end`. */
  fetchSamples(providerId: string, start: Date, end: Date): Promise<PerformanceSample[]>;
}

export const PERFORMANCE_SAMPLE_SOURCE = Symbol('PERFORMANCE_SAMPLE_SOURCE');

const round = (n: number, dp = 8) => Number(n.toFixed(dp));

@Injectable()
export class ProviderWindowPerformanceService {
  constructor(
    @Inject(PERFORMANCE_SAMPLE_SOURCE)
    private readonly source: PerformanceSampleSource,
  ) {}

  async getWindowPerformance(
    providerId: string,
    windows: PerformanceWindow[],
    asOf: Date = new Date(),
  ): Promise<ProviderWindowPerformanceDto> {
    const unique = Array.from(new Set(windows));
    const bounds = unique.map((w) => resolveWindowBounds(w, asOf));
    const end = bounds[0].end;
    const earliest = new Date(Math.min(...bounds.map((b) => b.start.getTime())));

    // One fetch for the widest window; narrower windows are filtered in memory
    // with the same predicate, so boundaries are consistent across windows.
    const samples = await this.source.fetchSamples(providerId, earliest, end);

    return {
      providerId,
      asOf: end.toISOString(),
      windows: bounds.map((b) => this.computeMetrics(b, samples)),
    };
  }

  computeMetrics(bounds: WindowBounds, samples: PerformanceSample[]): WindowMetricsDto {
    const inWindow = samples.filter((s) => isWithinWindow(s.closedAt, bounds));
    const sampleCount = inWindow.length;
    const wins = inWindow.filter((s) => s.win === true).length;
    const losses = inWindow.filter((s) => s.win === false).length;
    const totalPnl = inWindow.reduce((sum, s) => sum + (Number.isFinite(s.pnl) ? s.pnl : 0), 0);
    const decided = wins + losses;
    return {
      window: bounds.window,
      start: bounds.start.toISOString(),
      end: bounds.end.toISOString(),
      sampleCount,
      wins,
      losses,
      winRate: decided === 0 ? null : round((wins / decided) * 100, 4),
      totalPnl: round(totalPnl),
      averagePnl: sampleCount === 0 ? null : round(totalPnl / sampleCount),
    };
  }
}
