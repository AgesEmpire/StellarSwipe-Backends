import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Position, PositionStatus } from '../../entities/position.entity';
import { StopLossService } from '../services/stop-loss.service';
import { TakeProfitService } from '../services/take-profit.service';
import { TrailingStopService } from '../services/trailing-stop.service';
import { PriceService } from '../services/price.service';

interface MonitorSummary {
  checkedPositions: number;
  stopLossTriggered: number;
  takeProfitTriggered: number;
  trailingStopsUpdated: number;
  errors: number;
  durationMs: number;
}

@Injectable()
export class MonitorPositionsJob {
  private readonly logger = new Logger(MonitorPositionsJob.name);
  private isRunning = false; // Guard against overlapping runs

  constructor(
    @InjectRepository(Position)
    private readonly positionRepository: Repository<Position>,
    private readonly stopLossService: StopLossService,
    private readonly takeProfitService: TakeProfitService,
    private readonly trailingStopService: TrailingStopService,
    private readonly priceService: PriceService,
  ) {}

  /** Runs every 30 seconds */
  @Cron('*/30 * * * * *')
  async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Previous monitor cycle still running — skipping this tick');
      return;
    }

    this.isRunning = true;
    const start = Date.now();
    const summary: MonitorSummary = {
      checkedPositions: 0,
      stopLossTriggered: 0,
      takeProfitTriggered: 0,
      trailingStopsUpdated: 0,
      errors: 0,
      durationMs: 0,
    };

    try {
      const positions = await this.fetchOpenPositions();
      if (!positions.length) return;

      summary.checkedPositions = positions.length;

      // Batch-fetch all prices in one call to avoid N+1
      const symbols = [...new Set(positions.map((p) => p.symbol))];
      const priceMap = await this.priceService.getBatchPrices(symbols);

      // Process each position concurrently, but cap concurrency to avoid DB pool exhaustion
      await this.processInBatches(positions, priceMap, summary, 10);
    } catch (err) {
      this.logger.error(`Monitor job failed: ${err.message}`, err.stack);
    } finally {
      summary.durationMs = Date.now() - start;
      this.isRunning = false;
      this.logger.log(
        `Monitor cycle complete in ${summary.durationMs}ms — ` +
          `checked=${summary.checkedPositions} ` +
          `SL=${summary.stopLossTriggered} TP=${summary.takeProfitTriggered} ` +
          `trailing=${summary.trailingStopsUpdated} errors=${summary.errors}`,
      );
    }
  }

  private async processInBatches(
    positions: Position[],
    priceMap: Map<string, number>,
    summary: MonitorSummary,
    batchSize: number,
  ): Promise<void> {
    for (let i = 0; i < positions.length; i += batchSize) {
      const batch = positions.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map((position) => this.processPosition(position, priceMap, summary)),
      );
    }
  }

  private async processPosition(
    position: Position,
    priceMap: Map<string, number>,
    summary: MonitorSummary,
  ): Promise<void> {
    const currentPrice = priceMap.get(position.symbol);

    if (currentPrice === undefined || currentPrice <= 0) {
      this.logger.warn(`No valid price for symbol ${position.symbol} (position ${position.id})`);
      summary.errors++;
      return;
    }

    try {
      // 1. Update trailing stop-loss first (so we check updated stop levels below)
      if (position.isTrailingStop) {
        const trailResult = await this.trailingStopService.update(position, currentPrice);
        if (trailResult.updated) {
          summary.trailingStopsUpdated++;
          this.logger.debug(
            `Trailing stop updated: position=${position.id} stop ${trailResult.oldStopLoss}→${trailResult.newStopLoss}`,
          );
        }
      }

      // 2. Check stop-loss (position object may have updated stopLossPrice from trailing)
      const slResult = await this.stopLossService.checkAndExecute(position, currentPrice);
      if (slResult.triggered) {
        summary.stopLossTriggered++;
        return; // Position is closed — no need to check take-profit
      }

      // 3. Check take-profit
      const tpResult = await this.takeProfitService.checkAndExecute(position, currentPrice);
      if (tpResult.triggered) {
        summary.takeProfitTriggered++;
      }
    } catch (err) {
      summary.errors++;
      this.logger.error(`Error processing position ${position.id}: ${err.message}`, err.stack);
    }
  }

  private async fetchOpenPositions(): Promise<Position[]> {
    return this.positionRepository.find({
      where: {
        status: In([PositionStatus.OPEN]),
      },
      relations: ['user'],
    });
  }
}
