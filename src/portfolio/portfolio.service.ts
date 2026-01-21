import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Trade, TradeStatus, TradeSide } from '../trades/entities/trade.entity';
import { PriceService } from '../shared/price.service';
import { PositionDetailDto } from './dto/position-detail.dto';
import { PortfolioSummaryDto } from './dto/portfolio-summary.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager'; // New import for cache
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';

@Injectable()
export class PortfolioService {
  constructor(
    @InjectRepository(Trade)
    private tradeRepository: Repository<Trade>,
    private priceService: PriceService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getPositions(userId: string): Promise<PositionDetailDto[]> {
    const openTrades = await this.tradeRepository.find({
      where: {
        userId,
        status: In([TradeStatus.OPEN, TradeStatus.PENDING]),
      },
    });

    if (openTrades.length === 0) {
      return [];
    }

    const symbols = [...new Set(openTrades.map((t) => t.assetSymbol))];
    const prices = await this.priceService.getMultiplePrices(symbols);

    return openTrades.map((trade) => {
      const currentPrice = prices[trade.assetSymbol] || trade.entryPrice;
      const unrealizedPnL = this.calculateUnrealizedPnL(trade, currentPrice);

      return {
        id: trade.id,
        assetSymbol: trade.assetSymbol,
        amount: Number(trade.amount),
        entryPrice: Number(trade.entryPrice),
        currentPrice: currentPrice,
        unrealizedPnL: unrealizedPnL,
        side: trade.side,
        openedAt: trade.openedAt,
      };
    });
  }

  async getHistory(userId: string, page: number = 1, limit: number = 10): Promise<{ data: Trade[]; total: number }> {
    const [data, total] = await this.tradeRepository.findAndCount({
      where: {
        userId,
        status: TradeStatus.CLOSED,
      },
      order: { closedAt: 'DESC' },
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
    });

    let realizedPnL = 0;
    let unrealizedPnL = 0;
    let openPositions = 0;
    let winningTrades = 0;
    let closedTradesCount = 0;
    let bestTrade = null;
    let worstTrade = null;

    // Get current prices for open positions
    const openTradeSymbols = allTrades
      .filter((t) => t.status === TradeStatus.OPEN || t.status === TradeStatus.PENDING)
      .map((t) => t.assetSymbol);
    
    // De-duplicate symbols
    const uniqueSymbols = [...new Set(openTradeSymbols)];
    const prices = await this.priceService.getMultiplePrices(uniqueSymbols);

    for (const trade of allTrades) {
      if (trade.status === TradeStatus.CLOSED) {
        realizedPnL += Number(trade.realizedPnl || 0);
        closedTradesCount++;
        if (Number(trade.realizedPnl) > 0) winningTrades++;
        
        if (!bestTrade || Number(trade.realizedPnl) > Number(bestTrade.realizedPnl)) {
            bestTrade = trade;
        }
        if (!worstTrade || Number(trade.realizedPnl) < Number(worstTrade.realizedPnl)) {
            worstTrade = trade;
        }

      } else if (trade.status === TradeStatus.OPEN || trade.status === TradeStatus.PENDING) {
        openPositions++;
        const currentPrice = prices[trade.assetSymbol] || Number(trade.entryPrice);
        unrealizedPnL += this.calculateUnrealizedPnL(trade, currentPrice);
      }
    }

    const winRate = closedTradesCount > 0 ? winningTrades / closedTradesCount : 0;
    // Total value = (Initial Balance - not tracked here) + Realized + Unrealized? 
    // Or just sum of current value of assets? 
    // Usually Total Equity = Cash + Unrealized PnL. 
    // Since we don't track Cash here, we can just return PnL stats.
    // The requirement says "Portfolio Value". I'll approximate it as sum of (amount * currentPrice) for open positions.
    
    let totalValue = 0;
     for (const trade of allTrades) {
         if (trade.status === TradeStatus.OPEN || trade.status === TradeStatus.PENDING) {
             const price = prices[trade.assetSymbol] || Number(trade.entryPrice);
             totalValue += Number(trade.amount) * price;
         }
     }


    const result = {
      totalValue,
      unrealizedPnL,
      realizedPnL,
      openPositions,
      winRate,
      bestTrade,
      worstTrade,
    };

    await this.cacheManager.set(cacheKey, result, 300000); // 5 minutes TTL (in milliseconds)
    return result;
  }

  private calculateUnrealizedPnL(trade: Trade, currentPrice: number): number {
    const amount = Number(trade.amount);
    const entryPrice = Number(trade.entryPrice);
    if (trade.side === TradeSide.BUY) {
      return (currentPrice - entryPrice) * amount;
    } else {
      return (entryPrice - currentPrice) * amount;
    }
  }
}
