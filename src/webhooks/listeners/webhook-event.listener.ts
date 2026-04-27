import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebhooksService } from '../webhooks.service';
import { TradeExecutedEvent, TradeFailedEvent, TradeCancelledEvent } from '../../events/trade.events';
import { SignalCreatedEvent, SignalValidatedEvent, SignalPerformanceUpdatedEvent } from '../../events/signal.events';

@Injectable()
export class WebhookEventListener {
  private readonly logger = new Logger(WebhookEventListener.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @OnEvent('trade.executed', { async: true })
  async onTradeExecuted(event: TradeExecutedEvent): Promise<void> {
    await this.dispatch('trade.executed', {
      tradeId: event.tradeId,
      userId: event.userId,
      symbol: event.symbol,
      type: event.type,
      quantity: event.quantity,
      price: event.price,
      totalValue: event.totalValue,
      signalId: event.signalId,
    });
  }

  @OnEvent('trade.failed', { async: true })
  async onTradeFailed(event: TradeFailedEvent): Promise<void> {
    await this.dispatch('trade.failed', {
      tradeId: event.tradeId,
      userId: event.userId,
      reason: event.reason,
    });
  }

  @OnEvent('trade.cancelled', { async: true })
  async onTradeCancelled(event: TradeCancelledEvent): Promise<void> {
    await this.dispatch('trade.cancelled', {
      tradeId: event.tradeId,
      userId: event.userId,
      reason: event.reason,
    });
  }

  @OnEvent('signal.created', { async: true })
  async onSignalCreated(event: SignalCreatedEvent): Promise<void> {
    await this.dispatch('signal.created', {
      signalId: event.signalId,
      userId: event.userId,
      symbol: event.symbol,
      type: event.type,
      targetPrice: event.targetPrice,
      stopLoss: event.stopLoss,
      takeProfit: event.takeProfit,
      reasoning: event.reasoning,
    });
  }

  @OnEvent('signal.validated', { async: true })
  async onSignalValidated(event: SignalValidatedEvent): Promise<void> {
    await this.dispatch('signal.validated', {
      signalId: event.signalId,
      status: event.status,
      validationNotes: event.validationNotes,
      confidenceScore: event.confidenceScore,
    });
  }

  @OnEvent('signal.performance.updated', { async: true })
  async onSignalPerformanceUpdated(event: SignalPerformanceUpdatedEvent): Promise<void> {
    await this.dispatch('signal.performance.updated', {
      signalId: event.signalId,
      userId: event.userId,
      performanceScore: event.performanceScore,
      returnPercentage: event.returnPercentage,
      copiers: event.copiers,
      accuracy: event.accuracy,
    });
  }

  @OnEvent('contest.updated', { async: true })
  async onContestUpdated(event: Record<string, unknown>): Promise<void> {
    await this.dispatch('contest.updated', {
      contestId: event['contestId'],
      status: event['status'],
      winnerId: event['winnerId'],
      prizePool: event['prizePool'],
    });
  }

  @OnEvent('payout.completed', { async: true })
  async onPayoutCompleted(event: Record<string, unknown>): Promise<void> {
    await this.dispatch('payout.completed', {
      payoutId: event['payoutId'],
      userId: event['userId'],
      amount: event['amount'],
      currency: event['currency'],
      txHash: event['txHash'],
    });
  }

  private async dispatch(
    eventName: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.webhooksService.dispatchEvent(eventName, data);
    } catch (err) {
      this.logger.error(
        `Failed to dispatch webhook for event "${eventName}": ${(err as Error).message}`,
      );
    }
  }
}
