import { Trade, TradeStatus } from '../../../trades/entities/trade.entity';

export interface HoldingPeriodMetrics {
  avgHoldingHours: number;
  medianHoldingHours: number;
  bestHoldingRangeHours: { min: number; max: number };
  earlyExits: number;
  lateExits: number;
}

export function analyzeHoldingPeriod(trades: Trade[]): HoldingPeriodMetrics {
  const closed = trades.filter(
    (t) =>
      (t.status === TradeStatus.SETTLED ||
        t.status === TradeStatus.COMPLETED) &&
      t.executedAt &&
      t.closedAt,
  );

  if (!closed.length) {
    return {
      avgHoldingHours: 0,
      medianHoldingHours: 0,
      bestHoldingRangeHours: { min: 0, max: 0 },
      earlyExits: 0,
      lateExits: 0,
    };
  }

  const holdingHours = closed
    .map(
      (t) =>
        (new Date(t.closedAt!).getTime() - new Date(t.executedAt!).getTime()) /
        3_600_000,
    )
    .sort((a, b) => a - b);

  const avg = holdingHours.reduce((s, v) => s + v, 0) / holdingHours.length;
  const median = holdingHours[Math.floor(holdingHours.length / 2)];

  const profitable = closed.filter((t) => parseFloat(t.profitLoss ?? '0') > 0);
  const profitableHours = profitable
    .map(
      (t) =>
        (new Date(t.closedAt!).getTime() - new Date(t.executedAt!).getTime()) /
        3_600_000,
    )
    .sort((a, b) => a - b);

  const bestMin = profitableHours[0] ?? 0;
  const bestMax = profitableHours[profitableHours.length - 1] ?? 0;

  return {
    avgHoldingHours: avg,
    medianHoldingHours: median,
    bestHoldingRangeHours: { min: bestMin, max: bestMax },
    earlyExits: holdingHours.filter((h) => h < avg * 0.25).length,
    lateExits: holdingHours.filter((h) => h > avg * 2).length,
  };
}
