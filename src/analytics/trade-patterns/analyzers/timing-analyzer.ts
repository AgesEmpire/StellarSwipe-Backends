import { Trade } from '../../../trades/entities/trade.entity';

export interface TimingMetrics {
  bestHour: number;
  worstHour: number;
  bestDayOfWeek: number;
  tradesByHour: Record<number, { count: number; avgPnl: number }>;
}

export function analyzeTiming(trades: Trade[]): TimingMetrics {
  if (!trades.length) {
    return {
      bestHour: 0,
      worstHour: 0,
      bestDayOfWeek: 0,
      tradesByHour: {},
    };
  }

  const byHour: Record<number, { pnl: number; count: number }> = {};

  for (const trade of trades) {
    const executedAt = trade.executedAt ?? trade.createdAt;
    const hour = new Date(executedAt).getUTCHours();
    if (!byHour[hour]) byHour[hour] = { pnl: 0, count: 0 };
    byHour[hour].pnl += parseFloat(trade.profitLoss ?? '0');
    byHour[hour].count++;
  }

  const tradesByHour = Object.fromEntries(
    Object.entries(byHour).map(([h, v]) => [
      Number(h),
      { count: v.count, avgPnl: v.count > 0 ? v.pnl / v.count : 0 },
    ]),
  );

  const hours = Object.keys(tradesByHour).map(Number);
  const bestHour = hours.reduce(
    (a, b) => (tradesByHour[a].avgPnl >= tradesByHour[b].avgPnl ? a : b),
    hours[0],
  );
  const worstHour = hours.reduce(
    (a, b) => (tradesByHour[a].avgPnl <= tradesByHour[b].avgPnl ? a : b),
    hours[0],
  );

  const byDay: Record<number, number> = {};
  for (const trade of trades) {
    const executedAt = trade.executedAt ?? trade.createdAt;
    const day = new Date(executedAt).getUTCDay();
    byDay[day] = (byDay[day] ?? 0) + parseFloat(trade.profitLoss ?? '0');
  }
  const days = Object.keys(byDay).map(Number);
  const bestDayOfWeek = days.reduce(
    (a, b) => (byDay[a] >= byDay[b] ? a : b),
    days[0],
  );

  return { bestHour, worstHour, bestDayOfWeek, tradesByHour };
}
