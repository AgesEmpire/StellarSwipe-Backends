import { Trade } from '../../../trades/entities/trade.entity';

export interface SizingMetrics {
  avgTradeSize: number;
  medianTradeSize: number;
  oversizedTrades: number;
  undersizedTrades: number;
  optimalSizeRange: { min: number; max: number };
}

export function analyzeSizing(trades: Trade[]): SizingMetrics {
  if (!trades.length) {
    return {
      avgTradeSize: 0,
      medianTradeSize: 0,
      oversizedTrades: 0,
      undersizedTrades: 0,
      optimalSizeRange: { min: 0, max: 0 },
    };
  }

  const sizes = trades.map((t) => parseFloat(t.amount)).sort((a, b) => a - b);
  const avg = sizes.reduce((s, v) => s + v, 0) / sizes.length;
  const median = sizes[Math.floor(sizes.length / 2)];
  const stdDev = Math.sqrt(
    sizes.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / sizes.length,
  );

  const optimalMin = Math.max(0, avg - stdDev);
  const optimalMax = avg + stdDev;

  return {
    avgTradeSize: avg,
    medianTradeSize: median,
    oversizedTrades: sizes.filter((s) => s > optimalMax).length,
    undersizedTrades: sizes.filter((s) => s < optimalMin).length,
    optimalSizeRange: { min: optimalMin, max: optimalMax },
  };
}
