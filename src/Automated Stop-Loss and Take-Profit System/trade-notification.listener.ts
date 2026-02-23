import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from '../../notifications/notifications.service';
import { Position } from '../../entities/position.entity';
import { User } from '../../entities/user.entity';

interface StopLossEvent {
  position: Position;
  user: User;
  currentPrice: number;
  executedPrice: number;
  pnl: number;
}

interface TakeProfitEvent extends StopLossEvent {
  fullyClose?: boolean;
}

@Injectable()
export class TradeNotificationListener {
  private readonly logger = new Logger(TradeNotificationListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent('position.stop_loss_hit')
  async handleStopLossHit(event: StopLossEvent): Promise<void> {
    const { position, user, executedPrice, pnl } = event;
    const pnlFormatted = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;

    this.logger.log(`Sending STOP_LOSS_HIT notification to user ${user.id} for position ${position.id}`);

    await this.notificationsService.send(user, {
      type: 'STOP_LOSS_HIT',
      title: `⛔ Stop-Loss Triggered: ${position.symbol}`,
      message:
        `Your stop-loss on ${position.symbol} was triggered. ` +
        `Position closed at $${executedPrice.toFixed(4)}. ` +
        `PnL: ${pnlFormatted}`,
      metadata: {
        positionId: position.id,
        symbol: position.symbol,
        executedPrice,
        pnl,
      },
    });
  }

  @OnEvent('position.take_profit_hit')
  async handleTakeProfitHit(event: TakeProfitEvent): Promise<void> {
    const { position, user, executedPrice, pnl } = event;
    const pnlFormatted = `+$${pnl.toFixed(2)}`;

    this.logger.log(`Sending TAKE_PROFIT_HIT notification to user ${user.id} for position ${position.id}`);

    await this.notificationsService.send(user, {
      type: 'TAKE_PROFIT_HIT',
      title: `✅ Take-Profit Hit: ${position.symbol}`,
      message:
        `Your take-profit target on ${position.symbol} was reached. ` +
        `Position closed at $${executedPrice.toFixed(4)}. ` +
        `PnL: ${pnlFormatted}`,
      metadata: {
        positionId: position.id,
        symbol: position.symbol,
        executedPrice,
        pnl,
      },
    });
  }

  @OnEvent('position.take_profit_level_hit')
  async handleTakeProfitLevelHit(event: TakeProfitEvent & { level: any }): Promise<void> {
    const { position, user, executedPrice, pnl, level, fullyClose } = event;

    await this.notificationsService.send(user, {
      type: 'TAKE_PROFIT_LEVEL_HIT',
      title: `✅ Take-Profit Level Hit: ${position.symbol}`,
      message:
        `${level.closePercent}% of your ${position.symbol} position was closed at $${executedPrice.toFixed(4)}. ` +
        `PnL: +$${pnl.toFixed(2)}. ` +
        (fullyClose ? 'Position fully closed.' : 'Remaining position still open.'),
      metadata: { positionId: position.id, symbol: position.symbol, executedPrice, pnl, level, fullyClose },
    });
  }

  @OnEvent('position.stop_loss_failed')
  async handleStopLossFailed(event: { position: Position; currentPrice: number; error: string }): Promise<void> {
    this.logger.error(
      `CRITICAL: Stop-loss execution failed for position ${event.position.id} at price ${event.currentPrice}: ${event.error}`,
    );
    // Alert ops/admin channel
    await this.notificationsService.sendOpsAlert({
      severity: 'CRITICAL',
      message: `Stop-loss FAILED for position ${event.position.id} (${event.position.symbol}) at price ${event.currentPrice}`,
      error: event.error,
    });
  }
}
