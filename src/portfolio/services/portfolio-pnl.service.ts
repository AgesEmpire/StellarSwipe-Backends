import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Trade, TradeSide, TradeStatus } from '../../trades/entities/trade.entity';
import { PnlHistory } from '../entities/pnl-history.entity';
import { PnlCalculatorService } from './pnl-calculator.service';

export interface PositionPnlResult {
  assetSymbol: string;
  signalId: string | null;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  totalFees: number;
  costBasis: number;
  currentValue: number;
  percentageChange: number;
  openQuantity: number;
}

export interface PortfolioPnlSummary {
  userId: string;
  positions: PositionPnlResult[];
  totalRealizedPnL: number;
  totalUnrealizedPnL: number;
  totalPnL: number;
  totalFees: number;
  totalCostBasis: number;
  totalCurrentValue: number;
  snapshotAt: Date;
}

export interface PnlHistoryEntry {
  date: string;
  assetSymbol: string;
  signalId: string | null;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  totalFees: number;
}

@Injectable()
export class PortfolioPnlService {
  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectRepository(PnlHistory)
    private readonly pnlHistoryRepository: Repository<PnlHistory>,
    private readonly pnlCalculator: PnlCalculatorService,
  ) {}

  /**
   * Computes a full portfolio P&L summary for a user across all open positions,
   * broken down by asset and signal.
   */
  async calculatePortfolioPnlSummary(
    userId: string,
    currentPrices: Record<string, number>,
  ): Promise<PortfolioPnlSummary> {
    const trades = await this.tradeRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });

    if (trades.length === 0) {
      return this.emptyPortfolioSummary(userId);
    }

    const pnlResult = this.pnlCalculator.calculatePortfolioPnl(trades, currentPrices);

    const positionMap = new Map<string, PositionPnlResult>();

    for (const trade of trades) {
      const pair = `${trade.baseAsset}/${trade.counterAsset}`;
      const key = `${pair}:${trade.signalId ?? 'none'}`;
      const currentPrice = currentPrices[pair] ?? Number(trade.entryPrice);

      if (!positionMap.has(key)) {
        positionMap.set(key, {
          assetSymbol: pair,
          signalId: trade.signalId ?? null,
          realizedPnL: 0,
          unrealizedPnL: 0,
          totalPnL: 0,
          totalFees: 0,
          costBasis: 0,
          currentValue: 0,
          percentageChange: 0,
          openQuantity: 0,
        });
      }

      const pos = positionMap.get(key)!;
      const amount = Number(trade.amount);
      const entryPrice = Number(trade.entryPrice);

      if (trade.side === TradeSide.BUY) {
        pos.costBasis += amount * entryPrice;
        pos.openQuantity += amount;
      } else {
        pos.openQuantity -= amount;
      }

      const entryFee = Number((trade as any).entryFee ?? 0);
      pos.totalFees += entryFee + Number((trade as any).exitFee ?? 0);
    }

    const positions: PositionPnlResult[] = [];

    for (const pos of positionMap.values()) {
      const pair = pos.assetSymbol;
      const currentPrice = currentPrices[pair] ?? 0;

      pos.currentValue = pos.openQuantity * currentPrice;
      pos.unrealizedPnL = pos.currentValue - (pos.openQuantity > 0 ? (pos.costBasis / Math.max(pos.openQuantity, 1)) * pos.openQuantity : 0);

      const sigKey = pos.signalId ?? 'none';
      const bySignal = pnlResult.bySignal[sigKey] ?? { realizedPnL: 0, unrealizedPnL: 0 };
      pos.realizedPnL = bySignal.realizedPnL;
      pos.unrealizedPnL = bySignal.unrealizedPnL;
      pos.totalPnL = pos.realizedPnL + pos.unrealizedPnL;
      pos.percentageChange = pos.costBasis > 0
        ? ((pos.currentValue - pos.costBasis) / pos.costBasis) * 100
        : 0;

      positions.push(pos);
    }

    return {
      userId,
      positions,
      totalRealizedPnL: parseFloat(pnlResult.realizedPnL.toFixed(8)),
      totalUnrealizedPnL: parseFloat(pnlResult.unrealizedPnL.toFixed(8)),
      totalPnL: parseFloat((pnlResult.realizedPnL + pnlResult.unrealizedPnL).toFixed(8)),
      totalFees: parseFloat(pnlResult.totalFees.toFixed(8)),
      totalCostBasis: parseFloat(positions.reduce((s, p) => s + p.costBasis, 0).toFixed(8)),
      totalCurrentValue: parseFloat(positions.reduce((s, p) => s + p.currentValue, 0).toFixed(8)),
      snapshotAt: new Date(),
    };
  }

  /**
   * Fetches persisted P&L history snapshots for a user within a date range.
   */
  async getPnlHistory(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<PnlHistoryEntry[]> {
    const records = await this.pnlHistoryRepository.find({
      where: { userId, snapshotDate: Between(from, to) as any },
      order: { snapshotDate: 'ASC' },
    });

    return records.map((r) => ({
      date: r.snapshotDate.toString().slice(0, 10),
      assetSymbol: r.assetSymbol,
      signalId: r.signalId ?? null,
      realizedPnL: parseFloat(r.realizedPnL),
      unrealizedPnL: parseFloat(r.unrealizedPnL),
      totalPnL: parseFloat(r.totalPnL),
      totalFees: parseFloat(r.totalFees),
    }));
  }

  /**
   * Saves a daily P&L snapshot to the history table.
   */
  async snapshotPnl(
    userId: string,
    assetSymbol: string,
    signalId: string | null,
    pnl: { realizedPnL: number; unrealizedPnL: number; totalFees: number },
  ): Promise<PnlHistory> {
    const record = this.pnlHistoryRepository.create({
      userId,
      assetSymbol,
      signalId: signalId ?? undefined,
      snapshotDate: new Date(),
      realizedPnL: pnl.realizedPnL.toString(),
      unrealizedPnL: pnl.unrealizedPnL.toString(),
      totalPnL: (pnl.realizedPnL + pnl.unrealizedPnL).toString(),
      totalFees: pnl.totalFees.toString(),
    });
    return this.pnlHistoryRepository.save(record);
  }

  private emptyPortfolioSummary(userId: string): PortfolioPnlSummary {
    return {
      userId,
      positions: [],
      totalRealizedPnL: 0,
      totalUnrealizedPnL: 0,
      totalPnL: 0,
      totalFees: 0,
      totalCostBasis: 0,
      totalCurrentValue: 0,
      snapshotAt: new Date(),
    };
  }
}
