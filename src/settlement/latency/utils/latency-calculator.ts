export interface LatencySummary {
  count: number;
  averageMs: number;
  p95Ms: number;
  p99Ms: number;
}

export function calculateLatencyMs(executedAt: Date, settledAt: Date): number {
  return Math.max(0, settledAt.getTime() - executedAt.getTime());
}

export function aggregateLatencies(latenciesMs: number[]): LatencySummary {
  if (latenciesMs.length === 0) {
    return {
      count: 0,
      averageMs: 0,
      p95Ms: 0,
      p99Ms: 0,
    };
  }

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    count: sorted.length,
    averageMs: Math.round((total / sorted.length) * 100) / 100,
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
  };
}

function percentile(sortedValues: number[], percentileRank: number): number {
  const index = Math.ceil((percentileRank / 100) * sortedValues.length) - 1;
  return sortedValues[Math.min(Math.max(index, 0), sortedValues.length - 1)];
}
