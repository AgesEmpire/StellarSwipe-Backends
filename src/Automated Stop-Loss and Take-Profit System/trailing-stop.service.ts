import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Position, PositionStatus } from '../../entities/position.entity';

export interface TrailingStopUpdateResult {
  updated: boolean;
  oldStopLoss?: number;
  newStopLoss?: number;
  highestPrice?: number;
}

@Injectable()
export class TrailingStopService {
  private readonly logger = new Logger(TrailingStopService.name);

  constructor(
    @InjectRepository(Position)
    private readonly positionRepository: Repository<Position>,
  ) {}

  /**
   * Recalculates trailing stop-loss for a position given the current price.
   * If price has moved favorably (up for long), the stop-loss is raised proportionally.
   * The stop-loss only moves in the favorable direction — never back down.
   *
   * Example: entry=$100, trailing=5%, price rises to $110
   *   → highestPrice=$110, newStop = 110 * (1 - 0.05) = $104.50
   */
  async update(position: Position, currentPrice: number): Promise<TrailingStopUpdateResult> {
    if (!position.isTrailingStop || position.status !== PositionStatus.OPEN || !position.stopLossPrice) {
      return { updated: false };
    }

    const trailingFraction = (position.trailingPercent ?? 5) / 100;
    const previousHigh = position.highestPrice ?? position.entryPrice;

    // Only update if price has moved to a new high
    if (currentPrice <= previousHigh) {
      return { updated: false };
    }

    const oldStopLoss = position.stopLossPrice;
    const newStopLoss = parseFloat((currentPrice * (1 - trailingFraction)).toFixed(8));

    // Only raise stop-loss, never lower it
    if (newStopLoss <= oldStopLoss) {
      return { updated: false };
    }

    position.highestPrice = currentPrice;
    position.stopLossPrice = newStopLoss;

    await this.positionRepository.save(position);

    this.logger.log(
      `Trailing stop updated for position ${position.id}: ${oldStopLoss} → ${newStopLoss} (highestPrice=${currentPrice})`,
    );

    return {
      updated: true,
      oldStopLoss,
      newStopLoss,
      highestPrice: currentPrice,
    };
  }

  /**
   * Initialize trailing stop for a position.
   * Sets initial stop-loss based on entry price and trailing percent.
   */
  async initialize(position: Position): Promise<Position> {
    if (!position.isTrailingStop) return position;

    const trailingFraction = (position.trailingPercent ?? 5) / 100;
    position.stopLossPrice = parseFloat((position.entryPrice * (1 - trailingFraction)).toFixed(8));
    position.highestPrice = position.entryPrice;

    return this.positionRepository.save(position);
  }
}
