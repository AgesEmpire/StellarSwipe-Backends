import { Injectable } from '@nestjs/common';
import { TradesService } from '../trades.service';
import { ClosePositionCommand, ClosePositionOutcome, PositionCloser } from './close-all.types';

/**
 * Closes each position through the existing single-position close path, so
 * close-all inherits its validation, version check (409 if the position
 * changed since the preview), outbox event and lifecycle timestamp.
 */
@Injectable()
export class TradesServicePositionCloser implements PositionCloser {
  constructor(private readonly trades: TradesService) {}

  async close(command: ClosePositionCommand): Promise<ClosePositionOutcome> {
    const result = await this.trades.closeTrade({
      tradeId: command.tradeId,
      userId: command.userId,
      version: command.version,
    });
    return {
      exitPrice: result?.exitPrice,
      profitLoss: result?.profitLoss,
      transactionHash: result?.transactionHash,
    };
  }
}
