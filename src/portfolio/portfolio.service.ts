import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Trade, TradeStatus } from '../trades/entities/trade.entity';
import { PriceService } from '../shared/price.service';
import { PositionDetailDto } from './dto/position-detail.dto';
import { PortfolioSummaryDto, TradeDetail } from './dto/portfolio-summary.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { PnlCalculatorService } from './services/pnl-calculator.service';

@Injectable()
export class PortfolioService {
  constructor(
    @InjectRepository(Trade)
    private tradeRepository: Repository<Trade>,
    private priceService: PriceService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private pnlCalculator: PnlCalculatorService,
  ) {}

  async getPositions(userId: string): Promise<PositionDetailDto[]> {
    const openTrades = await this.tradeRepository.find({
      where: {
        userId,
        status: In([TradeStatus.PENDING, TradeStatus.EXECUTING]),
      },
      order: { createdAt: 'DESC' },
    });

    if (openTrades.length === 0) {
      return [];
    }

    const symbols = [...new Set(openTrades.map((t) => `${t.baseAsset}/${t.counterAsset}`))];
    const prices = await this.priceService.getMultiplePrices(symbols);

    return openTrades.map((trade) => {
      const pair = `${trade.baseAsset}/${trade.counterAsset}`;
      const currentPrice = prices[pair] || Number(trade.entryPrice);
      const unrealizedPnL = this.pnlCalculator.calculateUnrealizedPnL(trade, currentPrice);

      return {
        id: trade.id,
        assetSymbol: pair,
        amount: Number(trade.amount),
        entryPrice: Number(trade.entryPrice),
        currentPrice: currentPrice,
        unrealizedPnL: unrealizedPnL,
        side: trade.side,
        openedAt: trade.executedAt || trade.createdAt,
      };
    });
  }

  async getHistory(userId: string, page: number = 1, limit: number = 10): Promise<{ data: Trade[]; total: number }> {
    const [data, total] = await this.tradeRepository.findAndCount({
      where: {
        userId,
        status: TradeStatus.COMPLETED,
      },
      order: { closedAt: 'DESC', updatedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total };
  }

  async getPerformance(userId: string): Promise<PortfolioSummaryDto> {
    const cacheKey = `portfolio_performance_${userId}`;
    const cachedData = await this.cacheManager.get<PortfolioSummaryDto>(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const allTrades = await this.tradeRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    let realizedPnL = 0;
    let unrealizedPnL = 0;
    let openPositions = 0;
    let winningTrades = 0;
    let closedTradesCount = 0;
    let bestTrade: TradeDetail | undefined;
    let worstTrade: TradeDetail | undefined;

    const openTrades = allTrades.filter((t) => 
      t.status === TradeStatus.EXECUTING || t.status === TradeStatus.PENDING
    );
    
    const openTradeSymbols = openTrades.map((t) => `${t.baseAsset}/${t.counterAsset}`);
    const uniqueSymbols = [...new Set(openTradeSymbols)];
    const prices = uniqueSymbols.length > 0 ? await this.priceService.getMultiplePrices(uniqueSymbols) : {};

    let totalValue = 0;

    for (const trade of allTrades) {
      if (trade.status === TradeStatus.COMPLETED) {
        const pnl = Number(trade.profitLoss || 0);
        closedTradesCount++;
        if (pnl > 0) winningTrades++;
        
        const tradeDetail: TradeDetail = {
          id: trade.id,
          side: trade.side,
          baseAsset: trade.baseAsset,
          counterAsset: trade.counterAsset,
          amount: Number(trade.amount),
          entryPrice: Number(trade.entryPrice),
          exitPrice: trade.exitPrice ? Number(trade.exitPrice) : undefined,
          profitLoss: pnl,
          profitLossPercentage: trade.profitLossPercentage ? Number(trade.profitLossPercentage) : undefined,
          executedAt: trade.executedAt,
          closedAt: trade.closedAt,
        };

        if (!bestTrade || pnl > bestTrade.profitLoss) {
          bestTrade = tradeDetail;
        }
        if (!worstTrade || pnl < worstTrade.profitLoss) {
          worstTrade = tradeDetail;
        }
      } else if (trade.status === TradeStatus.EXECUTING || trade.status === TradeStatus.PENDING) {
        openPositions++;
        const pair = `${trade.baseAsset}/${trade.counterAsset}`;
        const currentPrice = prices[pair] || Number(trade.entryPrice);
        const positionPnL = this.pnlCalculator.calculateUnrealizedPnL(trade, currentPrice);
        unrealizedPnL += positionPnL;
        totalValue += Number(trade.amount) * currentPrice;
      }
    }

    const pnlBreakdown = this.pnlCalculator.calculatePortfolioPnl(allTrades, prices);
    realizedPnL = pnlBreakdown.realizedPnL;
    unrealizedPnL = pnlBreakdown.unrealizedPnL;

    const winRate = closedTradesCount > 0 ? (winningTrades / closedTradesCount) * 100 : 0;

    const result: PortfolioSummaryDto = {
      totalValue,
      unrealizedPnL,
      realizedPnL,
      openPositions,
      winRate,
      bestTrade,
      worstTrade,
    };

    await this.cacheManager.set(cacheKey, result, 300000); // 5 minutes TTL
    return result;
  }

  // Unrealized PnL is delegated to PnlCalculatorService for fee inclusion.
}
