import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PortfolioCreatedEvent } from '../../events/portfolio.events';
import { TradeExecutedEvent } from '../../events/trade.events';
import { PortfolioLifecycleService } from '../services/portfolio-lifecycle.service';

@Injectable()
export class PortfolioLifecycleListener {
  private readonly logger = new Logger(PortfolioLifecycleListener.name);

  constructor(private readonly lifecycle: PortfolioLifecycleService) {}

  @OnEvent('portfolio.created', { async: true, promisify: true })
  async handlePortfolioCreated(event: PortfolioCreatedEvent): Promise<void> {
    try {
      const { portfolio, created } = await this.lifecycle.createPortfolio({
        eventId: event.eventId,
        userId: event.userId,
        baseCurrency: event.baseCurrency,
        name: event.name,
        metadata: event.initialMetadata,
      });
      this.logger.log(
        created
          ? `Portfolio ${portfolio.id} created for user ${event.userId}`
          : `Duplicate portfolio.created ignored for user ${event.userId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to persist portfolio for user ${event.userId}: ${(error as Error).message}`, {
        eventId: event.eventId,
        correlationId: event.correlationId,
      });
      throw error;
    }
  }

  @OnEvent('trade.executed', { async: true, promisify: true })
  async handleTradeExecuted(event: TradeExecutedEvent): Promise<void> {
    try {
      const result = await this.lifecycle.applyTrade({
        tradeId: event.tradeId,
        fillId: event.fillId,
        userId: event.userId,
        asset: event.symbol,
        side: event.type,
        quantity: event.quantity,
        price: event.price,
        executedAt: event.timestamp,
      });
      if (!result.applied) {
        this.logger.debug(`Replayed trade ${event.tradeId} ignored`);
      }
    } catch (error) {
      this.logger.error(`Failed to apply trade ${event.tradeId} to holdings: ${(error as Error).message}`, {
        userId: event.userId,
        correlationId: event.correlationId,
      });
      throw error;
    }
  }
}
