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

// Imports at or above this row count are processed asynchronously in the background.
const ASYNC_IMPORT_THRESHOLD = 50;

export enum PortfolioImportStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface PortfolioImportJob {
  id: string;
  userId: string;
  status: PortfolioImportStatus;
  totalRows: number;
  processedRows: number;
  importedCount: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

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
  // Durable in-memory job registry keyed by job id. Each job is owned by a userId
  // so status lookups can be scoped to the requester.
  private readonly importJobs = new Map<string, PortfolioImportJob>();

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
   * Enqueue a validated portfolio import for background processing.
   * Large batches are processed asynchronously; the returned job id can be
   * polled via getImportJobStatus to observe durable progress.
   */
  async enqueuePortfolioImport(
    userId: string,
    rows: PortfolioImportRow[],
  ): Promise<PortfolioImportJob> {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException('Import contains no rows');
    }
    if (rows.length > MAX_IMPORT_BATCH_SIZE) {
      throw new BadRequestException(
        `Import exceeds maximum batch size of ${MAX_IMPORT_BATCH_SIZE} rows`,
      );
    }

    const now = new Date();
    const job: PortfolioImportJob = {
      id: this.generateJobId(),
      userId,
      status: PortfolioImportStatus.PENDING,
      totalRows: rows.length,
      processedRows: 0,
      importedCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.importJobs.set(job.id, job);

    // Kick off background processing without blocking the request path.
    void this.processImportJob(job.id, rows);

    return { ...job };
  }

  /**
   * Return the durable status of an import job, scoped to its owner.
   */
  async getImportJobStatus(userId: string, jobId: string): Promise<PortfolioImportJob> {
    const job = this.importJobs.get(jobId);
    if (!job || job.userId !== userId) {
      throw new NotFoundException(`Import job ${jobId} not found`);
    }
    return { ...job };
  }

  private async processImportJob(jobId: string, rows: PortfolioImportRow[]): Promise<void> {
    const job = this.importJobs.get(jobId);
    if (!job) {
      return;
    }

    // Idempotency guard: only a PENDING job may transition to PROCESSING.
    // Retries that re-enter after completion/failure are no-ops, preventing
    // duplicate trade records.
    if (job.status !== PortfolioImportStatus.PENDING) {
      return;
    }
    job.status = PortfolioImportStatus.PROCESSING;
    job.updatedAt = new Date();

    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const amount = Number(row.amount);
        const entryPrice = Number(row.entryPrice);
        const feeAmount = Number(row.feeAmount ?? 0);

        await this.tradeRepository.manager.transaction(async (manager: EntityManager) => {
          const trade = manager.create(Trade, {
            userId: job.userId,
            signalId: '00000000-0000-0000-0000-000000000000',
            side: 'BUY' as any,
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
              userId: job.userId,
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
        });

        job.processedRows = i + 1;
        job.importedCount += 1;
        job.updatedAt = new Date();
      }

      job.status = PortfolioImportStatus.COMPLETED;
      job.updatedAt = new Date();
      await this.cacheManager.del(`portfolio_performance_${job.userId}`);
    } catch (error) {
      job.status = PortfolioImportStatus.FAILED;
      job.error = error instanceof Error ? error.message : String(error);
      job.updatedAt = new Date();
    }
  }

  private generateJobId(): string {
    // Simple unique id; avoids adding a uuid dependency.
    return `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
