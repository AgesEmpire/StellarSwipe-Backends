import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Trade, TradeStatus } from './entities/trade.entity';
import { TradeDetailsDto, UserTradesSummaryDto } from './dto/trade-result.dto';
import { GetUserTradesDto } from './dto/execute-trade.dto';

/**
 * Extended DTO for trade history queries with date-range filtering.
 * Extends the base GetUserTradesDto to add startDate / endDate support.
 */
export interface TradeHistoryQueryDto extends GetUserTradesDto {
  /** ISO-8601 date string – only return trades created on or after this date */
  startDate?: string;
  /** ISO-8601 date string – only return trades created on or before this date */
  endDate?: string;
}

/**
 * Paginated response wrapper for trade history.
 */
export interface PaginatedTradeHistoryDto {
  data: TradeDetailsDto[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * TradeHistoryService
 *
 * Provides optimised database queries for trade history endpoints.
 * All aggregations are pushed to the database layer to avoid loading
 * large result sets into application memory.
 *
 * Performance characteristics:
 *  - getUserTradeHistory  → uses idx_trades_user_created_at, single query + COUNT
 *  - getUserTradesSummary → single SQL aggregate query (no in-memory reduce)
 *  - getOpenPositions     → uses idx_trades_user_status_closed, DB-side NULL filter
 *  - getTradesBySignal    → uses idx_trades_signal_id
 */
@Injectable()
export class TradeHistoryService {
  private readonly logger = new Logger(TradeHistoryService.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Returns a paginated, filtered list of trades for a user.
   *
   * Optimisations vs the original TradesService.getUserTrades():
   *  - Explicit SELECT projection avoids fetching the heavy `metadata` JSONB column.
   *  - Date-range predicates are pushed to the DB so the index on
   *    (user_id, created_at) can be used for range scans.
   *  - Total count is fetched in the same query via getManyAndCount() to avoid
   *    a second round-trip.
   */
  async getUserTradeHistory(
    dto: TradeHistoryQueryDto,
  ): Promise<PaginatedTradeHistoryDto> {
    const limit = Math.min(dto.limit ?? 20, 100);
    const offset = dto.offset ?? 0;

    const qb = this.buildHistoryQuery(dto);
    qb.take(limit).skip(offset);

    const [trades, total] = await qb.getManyAndCount();

    return {
      data: trades.map((t) => this.mapToTradeDetails(t)),
      total,
      limit,
      offset,
    };
  }

  /**
   * Returns aggregate statistics for a user's trade history.
   *
   * Optimisation: replaces the original implementation that loaded ALL trades
   * into memory and computed aggregates in JavaScript. This version issues a
   * single SQL query with SUM / COUNT / FILTER expressions.
   */
  async getUserTradesSummary(userId: string): Promise<UserTradesSummaryDto> {
    const raw = await this.tradeRepository
      .createQueryBuilder('trade')
      .select('COUNT(*)', 'totalTrades')
      .addSelect(
        `COUNT(*) FILTER (WHERE trade.status = :completedStatus AND trade.closed_at IS NULL)`,
        'openTrades',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE trade.closed_at IS NOT NULL)`,
        'completedTrades',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE trade.status = :failedStatus)`,
        'failedTrades',
      )
      .addSelect(
        `COALESCE(SUM(CAST(trade.profit_loss AS DECIMAL)) FILTER (WHERE trade.closed_at IS NOT NULL), 0)`,
        'totalProfitLoss',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE trade.closed_at IS NOT NULL AND CAST(trade.profit_loss AS DECIMAL) > 0)`,
        'winningTrades',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE trade.closed_at IS NOT NULL AND trade.profit_loss IS NOT NULL)`,
        'closedWithPnl',
      )
      .addSelect(
        `COALESCE(AVG(CAST(trade.profit_loss AS DECIMAL)) FILTER (WHERE trade.closed_at IS NOT NULL AND trade.profit_loss IS NOT NULL), 0)`,
        'averageProfitLoss',
      )
      .where('trade.user_id = :userId', { userId })
      .setParameter('completedStatus', TradeStatus.COMPLETED)
      .setParameter('failedStatus', TradeStatus.FAILED)
      .getRawOne();

    const totalTrades = parseInt(raw.totalTrades, 10);
    const openTrades = parseInt(raw.openTrades, 10);
    const completedTrades = parseInt(raw.completedTrades, 10);
    const failedTrades = parseInt(raw.failedTrades, 10);
    const totalProfitLoss = parseFloat(raw.totalProfitLoss);
    const winningTrades = parseInt(raw.winningTrades, 10);
    const closedWithPnl = parseInt(raw.closedWithPnl, 10);
    const averageProfitLoss = parseFloat(raw.averageProfitLoss);
    const winRate = closedWithPnl > 0 ? (winningTrades / closedWithPnl) * 100 : 0;

    return {
      totalTrades,
      openTrades,
      completedTrades,
      failedTrades,
      totalProfitLoss: totalProfitLoss.toFixed(8),
      winRate: winRate.toFixed(2),
      averageProfitLoss: averageProfitLoss.toFixed(8),
    };
  }

  /**
   * Returns all open positions for a user.
   *
   * Optimisation: the original implementation fetched all COMPLETED trades and
   * filtered `!closedAt` in JavaScript. This version pushes the IS NULL
   * predicate to the DB, allowing the composite index
   * idx_trades_user_status_closed to be used.
   */
  async getOpenPositions(userId: string): Promise<TradeDetailsDto[]> {
    const trades = await this.tradeRepository
      .createQueryBuilder('trade')
      .select(this.historyColumns('trade'))
      .where('trade.user_id = :userId', { userId })
      .andWhere('trade.status = :status', { status: TradeStatus.COMPLETED })
      .andWhere('trade.closed_at IS NULL')
      .orderBy('trade.created_at', 'DESC')
      .getMany();

    return trades.map((t) => this.mapToTradeDetails(t));
  }

  /**
   * Returns all trades for a given signal, ordered newest-first.
   * Uses idx_trades_signal_id for efficient lookup.
   */
  async getTradesBySignal(signalId: string): Promise<TradeDetailsDto[]> {
    const trades = await this.tradeRepository
      .createQueryBuilder('trade')
      .select(this.historyColumns('trade'))
      .where('trade.signal_id = :signalId', { signalId })
      .orderBy('trade.created_at', 'DESC')
      .getMany();

    return trades.map((t) => this.mapToTradeDetails(t));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds the base QueryBuilder for history list queries.
   * Applies user, status, and date-range filters.
   */
  private buildHistoryQuery(
    dto: TradeHistoryQueryDto,
  ): SelectQueryBuilder<Trade> {
    const qb = this.tradeRepository
      .createQueryBuilder('trade')
      .select(this.historyColumns('trade'))
      .where('trade.user_id = :userId', { userId: dto.userId })
      .orderBy('trade.created_at', 'DESC');

    if (dto.status && dto.status !== 'all') {
      qb.andWhere('trade.status = :status', { status: dto.status });
    }

    if (dto.startDate) {
      qb.andWhere('trade.created_at >= :startDate', {
        startDate: new Date(dto.startDate),
      });
    }

    if (dto.endDate) {
      qb.andWhere('trade.created_at <= :endDate', {
        endDate: new Date(dto.endDate),
      });
    }

    return qb;
  }

  /**
   * Returns the explicit column list used in SELECT projections.
   * Excludes the `metadata` JSONB column to reduce data transfer for list queries.
   */
  private historyColumns(alias: string): string[] {
    return [
      `${alias}.id`,
      `${alias}.userId`,
      `${alias}.signalId`,
      `${alias}.status`,
      `${alias}.side`,
      `${alias}.baseAsset`,
      `${alias}.counterAsset`,
      `${alias}.entryPrice`,
      `${alias}.exitPrice`,
      `${alias}.amount`,
      `${alias}.totalValue`,
      `${alias}.feeAmount`,
      `${alias}.profitLoss`,
      `${alias}.profitLossPercentage`,
      `${alias}.stopLossPrice`,
      `${alias}.takeProfitPrice`,
      `${alias}.transactionHash`,
      `${alias}.sorobanContractId`,
      `${alias}.errorMessage`,
      `${alias}.executedAt`,
      `${alias}.closedAt`,
      `${alias}.createdAt`,
      `${alias}.updatedAt`,
    ];
  }

  private mapToTradeDetails(trade: Trade): TradeDetailsDto {
    return {
      id: trade.id,
      userId: trade.userId,
      signalId: trade.signalId,
      status: trade.status,
      side: trade.side,
      baseAsset: trade.baseAsset,
      counterAsset: trade.counterAsset,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      amount: trade.amount,
      totalValue: trade.totalValue,
      feeAmount: trade.feeAmount,
      profitLoss: trade.profitLoss,
      profitLossPercentage: trade.profitLossPercentage,
      stopLossPrice: trade.stopLossPrice,
      takeProfitPrice: trade.takeProfitPrice,
      transactionHash: trade.transactionHash,
      sorobanContractId: trade.sorobanContractId,
      errorMessage: trade.errorMessage,
      executedAt: trade.executedAt,
      closedAt: trade.closedAt,
      createdAt: trade.createdAt,
      updatedAt: trade.updatedAt,
    };
  }
}
