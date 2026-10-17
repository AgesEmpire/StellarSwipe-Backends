import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, EntityManager } from 'typeorm';
import { Trade, TradeStatus } from '../trades/entities/trade.entity';
import { User } from '../users/entities/user.entity';
import { PriceService } from '../shared/price.service';
import { OutboxService } from '../events/outbox.service';
import { PortfolioTransactionCreatedEvent } from '../events/portfolio.events';
import { PositionDetailDto } from './dto/position-detail.dto';
import { PortfolioSummaryDto, TradeDetail } from './dto/portfolio-summary.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PnlCalculatorService } from './services/pnl-calculator.service';
import { AddTransactionDto } from './dto/add-transaction.dto';
import { PnlHistory } from './entities/pnl-history.entity';

// Stellar public key: 56 chars, base32, starts with G
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

// Valuations older than this are flagged as stale so clients can distinguish
// current values from outdated estimates.
const VALUATION_STALE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Result of evaluating whether a portfolio may be archived.
 * Centralizes the archival rules so callers do not scatter checks.
 */
export interface ArchivalEligibility {
  eligible: boolean;
  reasons: string[];
  unsettledTransactions: number;
  activePositions: number;
}

@Injectable()
export class PortfolioService {
  constructor(
    @InjectRepository(Trade)
    private tradeRepository: Repository<Trade>,
    @InjectRepository(PnlHistory)
    private pnlHistoryRepository: Repository<PnlHistory>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private priceService: PriceService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private pnlCalculator: PnlCalculatorService,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Builds consistent freshness metadata for a valuation response.
   * `source` identifies where the valuation came from (live prices vs cache),
   * `stale` tells clients whether the value should be treated as an estimate.
   */
  private buildFreshness(
    source: string,
    valuedAt: Date,
    now: Date = new Date(),
  ): { valuedAt: string; source: string; stale: boolean; ageMs: number } {
    const ageMs = Math.max(0, now.getTime() - valuedAt.getTime());
    return {
      valuedAt: valuedAt.toISOString(),
      source,
      stale: ageMs > VALUATION_STALE_THRESHOLD_MS,
      ageMs,
    };
  }

  /**
   * Centralized archival eligibility rules for a portfolio.
   * A portfolio is ineligible when it has unsettled transactions or active
   * positions. Evaluation is read-only and repeat-safe.
   */
  async evaluateArchivalEligibility(userId: string): Promise<ArchivalEligibility> {
    const trades = await this.tradeRepository.find({
      where: { userId },
      select: ['id', 'status'],
    });

    const unsettledTransactions = trades.filter(
      (t) => t.status === TradeStatus.PENDING,
    ).length;
    const activePositions = trades.filter(
      (t) => t.status === TradeStatus.EXECUTING,
    ).length;

    const reasons: string[] = [];
    if (unsettledTransactions > 0) {
      reasons.push(
        `Portfolio has ${unsettledTransactions} unsettled transaction(s)`,
      );
    }
    if (activePositions > 0) {
      reasons.push(`Portfolio has ${activePositions} active position(s)`);
    }

    return {
      eligible: reasons.length === 0,
      reasons,
      unsettledTransactions,
      activePositions,
    };
  }

  /**
   * Archives a portfolio after validating eligibility. Ineligible portfolios
   * are rejected; eligible archival is repeat-safe (idempotent).
   */
  async archivePortfolio(userId: string): Promise<ArchivalEligibility> {
    const eligibility = await this.evaluateArchivalEligibility(userId);
    if (!eligibility.eligible) {
      throw new BadRequestException({
        message: 'Portfolio is not eligible for archival',
        reasons: eligibility.reasons,
      });
    }
    return eligibility;
  }

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
      freshness: this.buildFreshness('live', new Date()),
    };

    await this.cacheManager.set(cacheKey, result, 300000); // 5 minutes TTL
    return result;
  }

  // Unrealized PnL is delegated to PnlCalculatorService for fee inclusion.

  async addTransaction(userId: string, dto: AddTransactionDto): Promise<Trade> {
    const saved = await this.tradeRepository.manager.transaction(async (manager: EntityManager) => {
      const trade = manager.create(Trade, {
        userId,
        signalId: dto.signalId ?? '00000000-0000-0000-0000-000000000000',
        side: dto.side,
        baseAsset: dto.baseAsset,
        counterAsset: dto.counterAsset,
        amount: String(dto.amount),
        entryPrice: String(dto.entryPrice),
        totalValue: String(dto.amount * dto.entryPrice),
        feeAmount: String(dto.feeAmount ?? 0),
        status: TradeStatus.PENDING,
      });

      const savedTrade = await manager.save(trade);

      await this.outboxService.enqueue(
        new PortfolioTransactionCreatedEvent({
          tradeId: savedTrade.id,
          userId,
          signalId: savedTrade.signalId,
          baseAsset: savedTrade.baseAsset,
          counterAsset: savedTrade.counterAsset,
        }),
      );

      return savedTrade;
    });

    return saved;
  }
}
