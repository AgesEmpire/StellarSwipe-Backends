import { Trade, TradeStatus } from '../../../trades/entities/trade.entity';

export interface WinLossMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWinAmount: number;
  avgLossAmount: number;
  profitFactor: number;
}

export function analyzeWinLoss(trades: Trade[]): WinLossMetrics {
  const closed = trades.filter(
    (t) =>
      t.status === TradeStatus.SETTLED || t.status === TradeStatus.COMPLETED,
  );

  const wins = closed.filter((t) => parseFloat(t.profitLoss ?? '0') > 0);
  const losses = closed.filter((t) => parseFloat(t.profitLoss ?? '0') <= 0);

  const totalWin = wins.reduce(
    (s, t) => s + parseFloat(t.profitLoss ?? '0'),
    0,
  );
  const totalLoss = Math.abs(
    losses.reduce((s, t) => s + parseFloat(t.profitLoss ?? '0'), 0),
  );

  return {
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length > 0 ? wins.length / closed.length : 0,
    avgWinAmount: wins.length > 0 ? totalWin / wins.length : 0,
    avgLossAmount: losses.length > 0 ? totalLoss / losses.length : 0,
    profitFactor:
      totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0,
  };
}
