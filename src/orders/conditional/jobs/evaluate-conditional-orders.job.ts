import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConditionalOrderService } from '../conditional-order.service';

/**
 * Scheduled job that evaluates pending/active conditional orders
 * against current market conditions and executes triggered orders.
 */
@Injectable()
export class EvaluateConditionalOrdersJob {
  private readonly logger = new Logger(EvaluateConditionalOrdersJob.name);

  constructor(
    private readonly conditionalOrderService: ConditionalOrderService,
  ) {}

  /**
   * Evaluate all conditional orders — runs every 30 seconds.
   * In production, this would use live price feeds from the price oracle.
   */
  @Cron('*/30 * * * * *')
  async evaluate(): Promise<void> {
    this.logger.debug('EvaluateConditionalOrdersJob: starting evaluation');

    // Collect current price snapshots from the market data service.
    // For now, an empty map means conditions won't trigger on price
    // unless explicitly injected by the caller.
    const priceSnapshots = new Map<string, { assetCode: string; assetIssuer?: string; price: number; timestamp: Date }>();

    const result = await this.conditionalOrderService.evaluateConditions(priceSnapshots);

    if (result.triggered.length > 0) {
      this.logger.log(
        `EvaluateConditionalOrdersJob: ${result.triggered.length} orders triggered out of ${result.evaluated}`,
      );

      // In production, queue each triggered order for execution via a trade service
      for (const orderId of result.triggered) {
        try {
          await this.conditionalOrderService.executeTriggeredOrder(orderId);
          this.logger.log(`EvaluateConditionalOrdersJob: executed triggered order ${orderId}`);
        } catch (error) {
          this.logger.error(
            `EvaluateConditionalOrdersJob: failed to execute order ${orderId}: ${(error as Error).message}`,
          );
        }
      }
    }
  }

  /**
   * Clean up expired orders every 10 minutes.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanupExpired(): Promise<void> {
    const count = await this.conditionalOrderService.expireStaleOrders();
    if (count > 0) {
      this.logger.log(`EvaluateConditionalOrdersJob: expired ${count} stale orders`);
    }
  }
}
