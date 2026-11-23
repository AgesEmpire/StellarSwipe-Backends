/**
 * Supported comparison windows for provider performance analytics (#1521).
 *
 * Boundary semantics (identical for every window):
 *   - `end`   = the request's `asOf` instant truncated to the whole minute (UTC), EXCLUSIVE
 *   - `start` = `end - duration`, INCLUSIVE
 * A sample with timestamp `t` is in the window iff `start <= t < end`.
 * All windows in one request share the same `end`, so they nest exactly.
 */
export enum PerformanceWindow {
  LAST_24H = '24h',
  LAST_7D = '7d',
  LAST_30D = '30d',
  LAST_90D = '90d',
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const PERFORMANCE_WINDOW_DURATIONS_MS: Readonly<Record<PerformanceWindow, number>> =
  Object.freeze({
    [PerformanceWindow.LAST_24H]: DAY_MS,
    [PerformanceWindow.LAST_7D]: 7 * DAY_MS,
    [PerformanceWindow.LAST_30D]: 30 * DAY_MS,
    [PerformanceWindow.LAST_90D]: 90 * DAY_MS,
  });

export const SUPPORTED_PERFORMANCE_WINDOWS: readonly PerformanceWindow[] = Object.freeze(
  Object.values(PerformanceWindow),
);

export interface WindowBounds {
  window: PerformanceWindow;
  /** Inclusive lower bound. */
  start: Date;
  /** Exclusive upper bound. */
  end: Date;
}

export function isPerformanceWindow(value: unknown): value is PerformanceWindow {
  return (
    typeof value === 'string' &&
    (SUPPORTED_PERFORMANCE_WINDOWS as readonly string[]).includes(value)
  );
}

/** Truncates to the whole minute so repeated requests produce stable boundaries. */
export function alignWindowEnd(asOf: Date): Date {
  const ms = asOf.getTime();
  return new Date(ms - (((ms % 60_000) + 60_000) % 60_000));
}

export function resolveWindowBounds(window: PerformanceWindow, asOf: Date): WindowBounds {
  if (!isPerformanceWindow(window)) {
    throw new RangeError(`Unsupported performance window: ${String(window)}`);
  }
  const end = alignWindowEnd(asOf);
  const start = new Date(end.getTime() - PERFORMANCE_WINDOW_DURATIONS_MS[window]);
  return { window, start, end };
}

export function isWithinWindow(timestamp: Date, bounds: WindowBounds): boolean {
  const t = timestamp.getTime();
  return t >= bounds.start.getTime() && t < bounds.end.getTime();
}
