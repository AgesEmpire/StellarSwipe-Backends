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

// Portfolio import batch limits and validation
const MAX_IMPORT_BATCH_SIZE = 500;
const MAX_IMPORT_PRECISION = 8;
const MAX_IMPORT_SCALE = 8;
const ASSET_CODE_RE = /^[A-Z0-9]{1,12}$/;

interface PortfolioImportRow {
  baseAsset: string;
  counterAsset: string;
  amount: number | string;
  entryPrice: number | string;
  feeAmount?: number | string;
}

interface PortfolioImportRowError {
  row: number;
  field: string;
  message: string;
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
          amount: savedTrade.amount,
          entryPrice: savedTrade.entryPrice,
          totalValue: savedTrade.totalValue,
          feeAmount: savedTrade.feeAmount,
          status: savedTrade.status,
          correlationId: savedTrade.id,
        }),
        manager,
      );

      return savedTrade;
    });

    await this.cacheManager.del(`portfolio_performance_${userId}`);
    return saved;
  }

  /**
   * Import a batch of portfolio transactions.
   *
   * All rows are validated up front (batch size, asset identifiers, numeric
   * precision) before any writes occur, so a validation failure never leaves
   * partial records behind. Errors are reported per-row with safe messages
   * that do not leak internal details.
   */
  async importTransactions(userId: string, rows: PortfolioImportRow[]): Promise<Trade[]> {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException('Import batch must contain at least one row');
    }

    if (rows.length > MAX_IMPORT_BATCH_SIZE) {
      throw new BadRequestException(
        `Import batch exceeds maximum size of ${MAX_IMPORT_BATCH_SIZE} rows`,
      );
    }

    const errors: PortfolioImportRowError[] = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 1;

      if (!row || typeof row !== 'object') {
        errors.push({ row: rowNumber, field: 'row', message: 'Row must be an object' });
        return;
      }

      if (!this.isValidAssetIdentifier(row.baseAsset)) {
        errors.push({ row: rowNumber, field: 'baseAsset', message: 'Invalid asset identifier' });
      }

      if (!this.isValidAssetIdentifier(row.counterAsset)) {
        errors.push({ row: rowNumber, field: 'counterAsset', message: 'Invalid asset identifier' });
      }

      if (!this.isValidPrecision(row.amount)) {
        errors.push({ row: rowNumber, field: 'amount', message: 'Invalid amount precision' });
      }

      if (!this.isValidPrecision(row.entryPrice)) {
        errors.push({ row: rowNumber, field: 'entryPrice', message: 'Invalid entry price precision' });
      }

      if (row.feeAmount !== undefined && !this.isValidPrecision(row.feeAmount)) {
        errors.push({ row: rowNumber, field: 'feeAmount', message: 'Invalid fee amount precision' });
      }
    });

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Portfolio import validation failed',
        errors,
      });
    }

    const saved = await this.tradeRepository.manager.transaction(async (manager: EntityManager) => {
      const created: Trade[] = [];

      for (const row of rows) {
        const amount = Number(row.amount);
        const entryPrice = Number(row.entryPrice);
        const feeAmount = row.feeAmount !== undefined ? Number(row.feeAmount) : 0;

        const trade = manager.create(Trade, {
          userId,
          signalId: '00000000-0000-0000-0000-000000000000',
          side: undefined as any,
          baseAsset: row.baseAsset,
          counterAsset: row.counterAsset,
          amount: String(amount),
          entryPrice: String(entryPrice),
          totalValue: String(amount * entryPrice),
          feeAmount: String(feeAmount),
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
            amount: savedTrade.amount,
            entryPrice: savedTrade.entryPrice,
            totalValue: savedTrade.totalValue,
            feeAmount: savedTrade.feeAmount,
            status: savedTrade.status,
            correlationId: savedTrade.id,
          }),
          manager,
        );

        created.push(savedTrade);
      }

      return created;
    });

    await this.cacheManager.del(`portfolio_performance_${userId}`);
    return saved;
  }

  private isValidAssetIdentifier(value: unknown): boolean {
    return typeof value === 'string' && ASSET_CODE_RE.test(value);
  }

  private isValidPrecision(value: unknown): boolean {
    if (value === null || value === undefined || value === '') {
      return false;
    }

    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return false;
    }

    const [integerPart, fractionalPart = ''] = String(value).split('.');
    if (fractionalPart.length > MAX_IMPORT_SCALE) {
      return false;
    }

    const significantDigits = integerPart.replace(/^0+/, '').length + fractionalPart.length;
    return significantDigits <= MAX_IMPORT_PRECISION + MAX_IMPORT_SCALE;
  }

  async getWalletSummary(walletAddress: string): Promise<PortfolioSummaryDto & { walletAddress: string }> {
    if (!STELLAR_ADDRESS_RE.test(walletAddress)) {
      throw new BadRequestException('Invalid Stellar wallet address format');
    }

    const cacheKey = `portfolio_wallet_summary_${walletAddress}`;
    const cached = await this.cacheManager.get<PortfolioSummaryDto & { walletAddress: string }>(cacheKey);
    if (cached) return cached;

    const trades = await this.tradeRepository.find({
      where: { userId: walletAddress },
      order: { createdAt: 'DESC' },
    });

    const summary = this.pnlCalculator.calculatePortfolioPnl(trades, {});

    const result: PortfolioSummaryDto & { walletAddress: string } = {
      totalValue: 0,
      unrealizedPnL: summary.unrealizedPnL,
      realizedPnL: summary.realizedPnL,
      openPositions: trades.filter(
        (t) => t.status === TradeStatus.EXECUTING || t.status === TradeStatus.PENDING,
      ).length,
      winRate: 0,
      walletAddress,
    };

    await this.cacheManager.set(cacheKey, result, 300000);
    return result;
  }
}
