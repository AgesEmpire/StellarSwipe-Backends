import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { In, LessThan, Repository } from 'typeorm';
import { Trade, TradeStatus } from '../../trades/entities/trade.entity';
import { PriceService } from '../../shared/price.service';
import { PnlHistory } from '../entities/pnl-history.entity';
import { PnlCalculatorService } from './pnl-calculator.service';
import { PnlSnapshotStatusDto } from '../dto/pnl-snapshot-status.dto';

const OPEN_STATUSES = [TradeStatus.PENDING, TradeStatus.EXECUTING];
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_RETENTION_DAYS = 90;

interface MutableStatus {
  inProgress: boolean;
  lastRunStartedAt?: Date;
  lastSuccessfulRunAt?: Date;
  lastRunCompletedAt?: Date;
  usersProcessed: number;
  snapshotsWritten: number;
  snapshotsDeleted: number;
  lastError?: string;
}

/**
 * Creates hourly P&L history rows without loading every user's trades into
 * memory at once. The service deliberately keeps the run state in memory:
 * the endpoint is operational telemetry, while the history rows are the
 * durable source of truth for charts.
 */
@Injectable()
export class PnlSnapshotService {
  private readonly logger = new Logger(PnlSnapshotService.name);
  private readonly batchSize: number;
  private readonly retentionDays: number;
  private status: MutableStatus = {
    inProgress: false,
    usersProcessed: 0,
    snapshotsWritten: 0,
    snapshotsDeleted: 0,
  };

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectRepository(PnlHistory)
    private readonly pnlHistoryRepository: Repository<PnlHistory>,
    private readonly pnlCalculator: PnlCalculatorService,
    private readonly priceService: PriceService,
    private readonly configService: ConfigService,
  ) {
    this.batchSize = Math.max(
      1,
      this.configService.get<number>('portfolio.pnlSnapshotBatchSize', DEFAULT_BATCH_SIZE),
    );
    this.retentionDays = Math.max(
      1,
      this.configService.get<number>('portfolio.pnlSnapshotRetentionDays', DEFAULT_RETENTION_DAYS),
    );
  }

  async runHourlySnapshot(): Promise<PnlSnapshotStatusDto> {
    if (this.status.inProgress) {
      this.logger.warn('Skipping overlapping P&L snapshot run');
      return this.getStatus();
    }

    this.status = {
      ...this.status,
      inProgress: true,
      lastRunStartedAt: new Date(),
      lastError: undefined,
      usersProcessed: 0,
      snapshotsWritten: 0,
      snapshotsDeleted: 0,
    };

    try {
      const userIds = await this.findUsersWithOpenPositions();
      for (let offset = 0; offset < userIds.length; offset += this.batchSize) {
        const batch = userIds.slice(offset, offset + this.batchSize);
        const rows = await this.buildRows(batch, new Date());
        await this.insertRows(rows);
        this.status.usersProcessed += batch.length;
        this.status.snapshotsWritten += rows.length;
      }

      this.status.snapshotsDeleted = await this.deleteExpiredRows();
      this.status.lastSuccessfulRunAt = new Date();
      this.logger.log(
        `P&L snapshot run completed: users=${this.status.usersProcessed} rows=${this.status.snapshotsWritten} deleted=${this.status.snapshotsDeleted}`,
      );
    } catch (error) {
      this.status.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error(`P&L snapshot run failed: ${this.status.lastError}`);
    } finally {
      this.status.inProgress = false;
      this.status.lastRunCompletedAt = new Date();
    }

    return this.getStatus();
  }

  getStatus(): PnlSnapshotStatusDto {
    return {
      inProgress: this.status.inProgress,
      lastRunStartedAt: this.status.lastRunStartedAt?.toISOString(),
      lastSuccessfulRunAt: this.status.lastSuccessfulRunAt?.toISOString(),
      lastRunCompletedAt: this.status.lastRunCompletedAt?.toISOString(),
      usersProcessed: this.status.usersProcessed,
      snapshotsWritten: this.status.snapshotsWritten,
      snapshotsDeleted: this.status.snapshotsDeleted,
      lastError: this.status.lastError,
    };
  }

  private async findUsersWithOpenPositions(): Promise<string[]> {
    const trades = await this.tradeRepository.find({
      select: { userId: true },
      where: { status: In(OPEN_STATUSES) },
    } as any);
    return [...new Set(trades.map((trade) => trade.userId).filter(Boolean))];
  }

  private async buildRows(userIds: string[], snapshotDate: Date): Promise<Partial<PnlHistory>[]> {
    const rows: Partial<PnlHistory>[] = [];
    for (const userId of userIds) {
      try {
        const trades = await this.tradeRepository.find({ where: { userId }, order: { createdAt: 'ASC' } });
        const openTrades = trades.filter((trade) => OPEN_STATUSES.includes(trade.status));
        if (openTrades.length === 0) continue;

        const symbols = [...new Set(openTrades.map((trade) => `${trade.baseAsset}/${trade.counterAsset}`))];
        const prices = await this.priceService.getMultiplePrices(symbols);
        const result = this.pnlCalculator.calculatePortfolioPnl(trades, prices);
        const assetEntries = Object.entries(result.byAsset);
        const entries = assetEntries.length > 0
          ? assetEntries
          : [['PORTFOLIO', { realizedPnL: result.realizedPnL, unrealizedPnL: result.unrealizedPnL, totalFees: result.totalFees }]];

        rows.push(...entries.map(([assetSymbol, pnl]) => ({
          userId,
          assetSymbol,
          signalId: null,
          snapshotDate,
          realizedPnL: pnl.realizedPnL.toFixed(8),
          unrealizedPnL: pnl.unrealizedPnL.toFixed(8),
          totalPnL: (pnl.realizedPnL + pnl.unrealizedPnL).toFixed(8),
          totalFees: pnl.totalFees.toFixed(8),
        })));
      } catch (error) {
        this.logger.warn(`Unable to snapshot user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return rows;
  }

  private async insertRows(rows: Partial<PnlHistory>[]): Promise<void> {
    if (rows.length === 0) return;
    await this.pnlHistoryRepository
      .createQueryBuilder()
      .insert()
      .into(PnlHistory)
      .values(rows)
      .execute();
  }

  private async deleteExpiredRows(): Promise<number> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - this.retentionDays);
    const result = await this.pnlHistoryRepository.delete({ snapshotDate: LessThan(cutoff) });
    return result.affected ?? 0;
  }
}
