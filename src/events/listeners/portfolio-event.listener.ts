import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TradeExecutedEvent } from '../events/trade.events';
import { UserRegisteredEvent } from '../events/user.events';

@Injectable()
export class PortfolioEventListener {
  private readonly logger = new Logger(PortfolioEventListener.name);

  /**
   * Initialize portfolio when user registers
   */
  @OnEvent('user.registered', { async: true })
  async handleUserRegistered(event: UserRegisteredEvent): Promise<void> {
    this.logger.log(`Initializing portfolio for new user: ${event.userId}`, {
      userId: event.userId,
      email: event.email,
      correlationId: event.correlationId,
    });

    try {
      await Promise.allSettled([
        this.createInitialPortfolio(event),
        this.sendWelcomeNotification(event),
        this.setupDefaultPreferences(event),
        this.trackUserRegistration(event),
      ]);

      this.logger.log(`User registration processed: ${event.userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to process user registration: ${event.userId}`,
        error.stack,
        {
          userId: event.userId,
          correlationId: event.correlationId,
          error: error.message,
        },
      );
    }
  }

  /**
   * Update portfolio holdings after trade execution
   */
  @OnEvent('trade.executed', { async: true, promisify: true })
  async handleTradeForPortfolio(event: TradeExecutedEvent): Promise<void> {
    this.logger.log(`Updating portfolio holdings for trade: ${event.tradeId}`, {
      tradeId: event.tradeId,
      userId: event.userId,
      symbol: event.symbol,
      type: event.type,
      correlationId: event.correlationId,
    });

    try {
      await Promise.allSettled([
        this.updateHoldings(event),
        this.recalculatePortfolioValue(event),
        this.updateAssetAllocation(event),
        this.checkRebalancingNeeded(event),
      ]);

      this.logger.log(`Portfolio updated for trade: ${event.tradeId}`);
    } catch (error) {
      this.logger.error(
        `Failed to update portfolio for trade: ${event.tradeId}`,
        error.stack,
        {
          tradeId: event.tradeId,
          userId: event.userId,
          correlationId: event.correlationId,
          error: error.message,
        },
      );
    }
  }

  // Private helper methods
  private async createInitialPortfolio(event: UserRegisteredEvent): Promise<void> {
    this.logger.debug(`Creating initial portfolio for user: ${event.userId}`);
    // TODO: Implement portfolio creation
    // await this.portfolioService.create({
    //   userId: event.userId,
    //   initialBalance: 0,
    //   currency: 'USD',
    // });
  }

  private async sendWelcomeNotification(event: UserRegisteredEvent): Promise<void> {
    this.logger.debug(`Sending welcome notification to user: ${event.userId}`);
    // TODO: Implement welcome notification
    // await this.notificationService.sendWelcome({
    //   userId: event.userId,
    //   email: event.email,
    //   username: event.username,
    // });
  }

  private async setupDefaultPreferences(event: UserRegisteredEvent): Promise<void> {
    this.logger.debug(`Setting up default preferences for user: ${event.userId}`);
    // TODO: Implement preference setup
    // await this.preferencesService.setDefaults(event.userId);
  }

  private async trackUserRegistration(event: UserRegisteredEvent): Promise<void> {
    this.logger.debug(`Tracking user registration: ${event.userId}`);
    // TODO: Implement analytics tracking
    // await this.analyticsService.trackRegistration({
    //   userId: event.userId,
    //   referralCode: event.referralCode,
    //   timestamp: event.timestamp,
    // });
  }

  private async updateHoldings(event: TradeExecutedEvent): Promise<void> {
    this.logger.debug(`Updating holdings for user: ${event.userId}`);
    
    const adjustment = event.type === 'BUY' ? event.quantity : -event.quantity;
    
    // TODO: Implement holdings update
    // await this.portfolioService.updateHoldings({
    //   userId: event.userId,
    //   symbol: event.symbol,
    //   quantityChange: adjustment,
    //   averagePrice: event.price,
    //   timestamp: event.timestamp,
    // });
  }

  private async recalculatePortfolioValue(event: TradeExecutedEvent): Promise<void> {
    this.logger.debug(`Recalculating portfolio value for user: ${event.userId}`);
    // TODO: Implement value recalculation
    // await this.portfolioService.recalculateValue(event.userId);
  }

  private async updateAssetAllocation(event: TradeExecutedEvent): Promise<void> {
    this.logger.debug(`Updating asset allocation for user: ${event.userId}`);
    // TODO: Implement allocation update
    // await this.portfolioService.updateAllocation(event.userId);
  }

  private async checkRebalancingNeeded(event: TradeExecutedEvent): Promise<void> {
    this.logger.debug(`Checking if rebalancing needed for user: ${event.userId}`);
    // TODO: Implement rebalancing check
    // const needsRebalancing = await this.portfolioService.needsRebalancing(event.userId);
    // if (needsRebalancing) {
    //   await this.notificationService.sendRebalancingAlert(event.userId);
    // }
  }
}