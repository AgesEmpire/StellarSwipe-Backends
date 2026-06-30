import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Repository } from 'typeorm';
import { Trade, TradeStatus } from '../../trades/entities/trade.entity';
import { PortfolioSnapshot } from '../entities/portfolio-snapshot.entity';
import { PnlCalculatorService } from './pnl-calculator.service';
import { PriceService } from '../../shared/price.service';

@Injectable()
export class PortfolioSnapshotService {
  private readonly logger = new Logger(PortfolioSnapshotService.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectRepository(PortfolioSnapshot)
    private readonly snapshotRepository: Repository<PortfolioSnapshot>,
    private readonly pnlCalculator: PnlCalculatorService,
    private readonly priceService: PriceService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async computeSnapshotForUser(userId: string): Promise<PortfolioSnapshot> {
    const trades = await this.tradeRepository.find({ where: { userId }, order: { createdAt: 'ASC' } });

    const openTrades = trades.filter((trade) => trade.status === TradeStatus.PENDING || trade.status === TradeStatus.EXECUTING);
    const symbols = Array.from(new Set(openTrades.map((trade) => `${trade.baseAsset}/${trade.counterAsset}`)));
    const prices = symbols.length > 0 ? await this.priceService.getMultiplePrices(symbols) : {};

    const pnlResult = this.pnlCalculator.calculatePortfolioPnl(trades, prices);

    let portfolioValue = 0;
    for (const trade of openTrades) {
      const pair = `${trade.baseAsset}/${trade.counterAsset}`;
      const currentPrice = prices[pair] ?? Number(trade.entryPrice);
      portfolioValue += Number(trade.amount) * currentPrice;
    }

    const snapshot = this.snapshotRepository.create({
      userId,
      realizedPnl: pnlResult.realizedPnL.toFixed(8),
      unrealizedPnl: pnlResult.unrealizedPnL.toFixed(8),
      totalPnl: (pnlResult.realizedPnL + pnlResult.unrealizedPnL).toFixed(8),
      portfolioValue: portfolioValue.toFixed(8),
      computedAt: new Date(),
    });

    const saved = await this.snapshotRepository.save(snapshot);
    const persistedSnapshot = saved ?? snapshot;
    const cacheKey = this.getCacheKey(userId);
    await this.cacheManager.set(cacheKey, persistedSnapshot, 60 * 60 * 6);
    return persistedSnapshot;
  }

  async getLatestSnapshot(userId: string): Promise<PortfolioSnapshot | null> {
    const cacheKey = this.getCacheKey(userId);
    const cached = await this.cacheManager.get<PortfolioSnapshot>(cacheKey);
    if (cached) {
      return cached;
    }

    const snapshot = await this.snapshotRepository.findOne({
      where: { userId },
      order: { computedAt: 'DESC' },
    });

    if (snapshot) {
      await this.cacheManager.set(cacheKey, snapshot, 60 * 60 * 6);
    }

    return snapshot;
  }

  async refreshSnapshotForUser(userId: string): Promise<PortfolioSnapshot> {
    return this.computeSnapshotForUser(userId);
  }

  async refreshSnapshotsForAllUsers(): Promise<void> {
    const trades = await this.tradeRepository.find({ select: ['userId'] });
    const uniqueUserIds = Array.from(new Set(trades.map((trade) => trade.userId)));

    for (const userId of uniqueUserIds) {
      try {
        await this.computeSnapshotForUser(userId);
      } catch (error) {
        this.logger.warn(`Failed to compute snapshot for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private getCacheKey(userId: string): string {
    return `portfolio_snapshot:${userId}`;
  }
}
