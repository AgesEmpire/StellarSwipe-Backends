import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Trade, TradeStatus } from '../../trades/entities/trade.entity';
import { PriceService } from '../../shared/price.service';
import { PnlHistory } from '../entities/pnl-history.entity';
import { PnlCalculatorService, PnlAttribution } from './pnl-calculator.service';

const AGGREGATE_ASSET_SYMBOL = 'ALL';

@Injectable()
export class PerformanceTrackerService {
  constructor(
    @InjectRepository(Trade) private tradeRepository: Repository<Trade>,
    @InjectRepository(PnlHistory) private pnlHistoryRepository: Repository<PnlHistory>,
    private priceService: PriceService,
    private pnlCalculator: PnlCalculatorService,
  ) {}

  async recordDailySnapshot(userId: string, snapshotDate: Date = new Date()): Promise<void> {
    const trades = await this.tradeRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });

    const openTrades = trades.filter((trade) =>
      [TradeStatus.PENDING, TradeStatus.EXECUTING].includes(trade.status),
    );
    const symbols = [...new Set(openTrades.map((trade) => `${trade.baseAsset}/${trade.counterAsset}`))];
    const currentPrices = symbols.length > 0 ? await this.priceService.getMultiplePrices(symbols) : {};

    const pnl = this.pnlCalculator.calculatePortfolioPnl(trades, currentPrices);
    const normalizedDate = this.normalizeSnapshotDate(snapshotDate);

    const historyEntries: Array<Partial<PnlHistory>> = [];

    historyEntries.push(
      this.buildSnapshotEntry(userId, AGGREGATE_ASSET_SYMBOL, null, normalizedDate, {
        realizedPnL: pnl.realizedPnL,
        unrealizedPnL: pnl.unrealizedPnL,
        totalFees: pnl.totalFees,
      }),
    );

    for (const [assetSymbol, attribution] of Object.entries(pnl.byAsset)) {
      historyEntries.push(
        this.buildSnapshotEntry(userId, assetSymbol, null, normalizedDate, attribution),
      );
    }

    for (const [signalId, attribution] of Object.entries(pnl.bySignal)) {
      historyEntries.push(
        this.buildSnapshotEntry(userId, AGGREGATE_ASSET_SYMBOL, signalId, normalizedDate, attribution),
      );
    }

    await this.upsertSnapshots(historyEntries);
  }

  private buildSnapshotEntry(
    userId: string,
    assetSymbol: string,
    signalId: string | null,
    snapshotDate: Date,
    attribution: PnlAttribution,
  ): Partial<PnlHistory> {
    const totalPnL = attribution.realizedPnL + attribution.unrealizedPnL;

    return {
      userId,
      assetSymbol,
      signalId,
      snapshotDate,
      realizedPnL: attribution.realizedPnL.toString(),
      unrealizedPnL: attribution.unrealizedPnL.toString(),
      totalPnL: totalPnL.toString(),
      totalFees: attribution.totalFees.toString(),
    };
  }

  private async upsertSnapshots(entries: Array<Partial<PnlHistory>>): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const snapshotDate = entries[0].snapshotDate!;
    const signalIds = entries.map((entry) => entry.signalId ?? null);
    const assetSymbols = entries.map((entry) => entry.assetSymbol!);

    const existingSnapshots = await this.pnlHistoryRepository.find({
      where: {
        snapshotDate,
        userId: entries[0].userId!,
        assetSymbol: In(assetSymbols),
        signalId: In(signalIds),
      },
    });

    const existingMap = new Map<string, PnlHistory>();
    for (const snapshot of existingSnapshots) {
      existingMap.set(this.snapshotKey(snapshot), snapshot);
    }

    const toSave = entries.map((entry) => {
      const key = this.snapshotKey(entry as PnlHistory);
      const existing = existingMap.get(key);
      if (existing) {
        return Object.assign(existing, entry);
      }
      return this.pnlHistoryRepository.create(entry);
    });

    await this.pnlHistoryRepository.save(toSave);
  }

  private snapshotKey(entry: PnlHistory): string {
    return `${entry.userId}:${entry.assetSymbol}:${entry.signalId ?? 'none'}:${entry.snapshotDate.toISOString()}`;
  }

  private normalizeSnapshotDate(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
}
