import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Trade, TradeStatus } from '../trades/entities/trade.entity';
import { NotificationService } from '../notifications/notification.service';
import { NotificationChannel } from '../notifications/entities/notification.entity';
import { TradeExecutorService } from '../trades/services/trade-executor.service';
import { PriceService } from '../shared/price.service';
import { SetRiskLevelsDto } from './dto/set-risk-levels.dto';

const PRICE_FEED_FAILURE_ALERT_THRESHOLD = 3;

@Injectable()
export class RiskControlsService {
  private readonly logger = new Logger(RiskControlsService.name);
  private readonly priceFeedFailuresByPair = new Map<string, number>();
  private readonly alertedPriceFeedPairs = new Set<string>();

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    private readonly tradeExecutor: TradeExecutorService,
    private readonly notificationService: NotificationService,
    private readonly priceService: PriceService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async setRiskLevels(userId: string, dto: SetRiskLevelsDto): Promise<Trade> {
    const trade = await this.tradeRepository.findOne({
      where: { id: dto.tradeId, userId },
    });

    if (!trade) throw new NotFoundException('Trade not found');
    if (trade.status !== TradeStatus.COMPLETED || trade.closedAt) {
      throw new BadRequestException(
        'Risk levels can only be set on open trades',
      );
    }

    if (dto.stopLossPrice) trade.stopLossPrice = dto.stopLossPrice;
    if (dto.takeProfitPrice) trade.takeProfitPrice = dto.takeProfitPrice;

    return this.tradeRepository.save(trade);
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async enforceRiskLevels(): Promise<void> {
    const openTrades = await this.tradeRepository.find({
      where: { status: TradeStatus.COMPLETED, closedAt: IsNull() },
    });

    const tradesWithLevels = openTrades.filter(
      (t) => t.stopLossPrice || t.takeProfitPrice,
    );

    for (const trade of tradesWithLevels) {
      try {
        await this.checkAndEnforce(trade);
      } catch (err) {
        this.logger.error(
          `Risk enforcement failed for trade ${trade.id}: ${err}`,
        );
      }
    }
  }

  private async checkAndEnforce(trade: Trade): Promise<void> {
    const currentPrice = await this.resolveCurrentPrice(trade);
    if (currentPrice === null) return;

    const price = currentPrice;
    const currentPriceText = currentPrice.toString();

    const stopLoss = trade.stopLossPrice
      ? parseFloat(trade.stopLossPrice)
      : null;
    const takeProfit = trade.takeProfitPrice
      ? parseFloat(trade.takeProfitPrice)
      : null;

    let triggered: 'stop_loss' | 'take_profit' | null = null;

    if (stopLoss !== null && price <= stopLoss) triggered = 'stop_loss';
    else if (takeProfit !== null && price >= takeProfit)
      triggered = 'take_profit';

    if (!triggered) return;

    this.logger.log(
      `Triggering ${triggered} for trade ${trade.id} at price ${price}`,
    );

    const result = await this.tradeExecutor.closeTrade(trade, currentPriceText);

    if (result.success) {
      trade.exitPrice = currentPriceText;
      trade.closedAt = new Date();
      trade.metadata = { ...(trade.metadata ?? {}), closedBy: triggered };
      await this.tradeRepository.save(trade);

      await this.notificationService.send({
        userId: trade.userId,
        type:
          triggered === 'stop_loss'
            ? 'STOP_LOSS_TRIGGERED'
            : 'TAKE_PROFIT_TRIGGERED',
        title:
          triggered === 'stop_loss'
            ? 'Stop-Loss Executed'
            : 'Take-Profit Executed',
        message:
          triggered === 'stop_loss'
            ? `Your stop-loss was triggered for ${trade.baseAsset}/${trade.counterAsset} at ${currentPriceText}`
            : `Your take-profit was triggered for ${trade.baseAsset}/${trade.counterAsset} at ${currentPriceText}`,
        channel: NotificationChannel.IN_APP,
        metadata: {
          tradeId: trade.id,
          triggerPrice: currentPriceText,
          type: triggered,
        },
      });
    } else {
      this.logger.error(
        `Failed to close trade ${trade.id} on ${triggered}: ${result.error}`,
      );
    }
  }

  private async resolveCurrentPrice(trade: Trade): Promise<number | null> {
    const assetPair = this.toAssetPair(trade);

    try {
      const price = await this.priceService.getCurrentPrice(assetPair);
      if (!Number.isFinite(price)) {
        throw new Error(`Price feed returned a non-finite value: ${price}`);
      }

      this.resetPriceFeedFailures(assetPair);
      return price;
    } catch (err) {
      this.recordPriceFeedFailure(assetPair, err);
      return null;
    }
  }

  private recordPriceFeedFailure(assetPair: string, err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));
    const failureCount = (this.priceFeedFailuresByPair.get(assetPair) ?? 0) + 1;
    this.priceFeedFailuresByPair.set(assetPair, failureCount);

    this.logger.error(
      `Price feed failed for ${assetPair} during risk enforcement: ${error.message}`,
      error.stack,
    );

    if (
      failureCount >= PRICE_FEED_FAILURE_ALERT_THRESHOLD &&
      !this.alertedPriceFeedPairs.has(assetPair)
    ) {
      this.alertedPriceFeedPairs.add(assetPair);
      this.eventEmitter.emit('alert.price-feed.failure', {
        type: 'PRICE_FEED_UNAVAILABLE',
        severity: 'high',
        timestamp: new Date(),
        message: `Price feed failed ${failureCount} consecutive enforcement ticks for ${assetPair}`,
        metrics: {
          assetPair,
          failureCount,
          threshold: PRICE_FEED_FAILURE_ALERT_THRESHOLD,
          error: error.message,
        },
      });
    }
  }

  private resetPriceFeedFailures(assetPair: string): void {
    if (!this.priceFeedFailuresByPair.has(assetPair)) return;

    this.priceFeedFailuresByPair.delete(assetPair);
    this.alertedPriceFeedPairs.delete(assetPair);
  }

  private toAssetPair(
    trade: Pick<Trade, 'baseAsset' | 'counterAsset'>,
  ): string {
    return `${trade.baseAsset}/${trade.counterAsset}`;
  }
}
