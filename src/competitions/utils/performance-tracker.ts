import { CompetitionTrade } from '../entities/competition-trade.entity';
import type { ParticipantPerformanceSnapshot } from '../interfaces/scoring-system.interface';

function sumDecimal(values: string[]): string {
  let acc = 0;
  for (const v of values) {
    acc += parseFloat(v) || 0;
  }
  return acc.toFixed(8);
}

export function buildPerformanceSnapshot(
  trades: CompetitionTrade[],
): ParticipantPerformanceSnapshot {
  if (trades.length === 0) {
    return {
      realizedPnl: '0',
      volume: '0',
      winRate: 0,
      tradeCount: 0,
    };
  }
  const volumes = trades.map((t) => t.volume);
  const pnls = trades.map((t) => t.realizedPnl);
  const wins = trades.filter((t) => parseFloat(t.realizedPnl) > 0).length;
  return {
    realizedPnl: sumDecimal(pnls),
    volume: sumDecimal(volumes),
    winRate: wins / trades.length,
    tradeCount: trades.length,
  };
}
