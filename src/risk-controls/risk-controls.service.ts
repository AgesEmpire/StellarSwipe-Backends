import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Trade, TradeStatus } from '../trades/entities/trade.entity';
import { NotificationService } from '../notifications/notification.service';
import { NotificationChannel } from '../notifications/entities/notification.entity';
import { TradeExecutorService } from '../trades/services/trade-executor.service';
import { SetRiskLevelsDto } from './dto/set-risk-levels.dto';

@Injectable()
export class RiskControlsService {
  private readonly logger = new Logger(RiskControlsService.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    private readonly tradeExecutor: TradeExecutorService,
    private readonly notificationService: NotificationService,
  ) {}

  async setRiskLevels(userId: string, dto: SetRiskLevelsDto): Promise<Trade> {
    const trade = await this.tradeRepository.findOne({
      where: { id: dto.tradeId, userId },
    });

    if (!trade) throw new NotFoundException('Trade not found');
    if (trade.status !== TradeStatus.COMPLETED || trade.closedAt) {
      throw new BadRequestException('Risk levels can only be set on open trades');
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
        this.logger.error(`Risk enforcement failed for trade ${trade.id}: ${err}`);
      }
    }
  }

  private async checkAndEnforce(trade: Trade): Promise<void> {
    const currentPrice = await this.getCurrentPrice(trade.baseAsset, trade.counterAsset);
    const price = parseFloat(currentPrice);

    const stopLoss = trade.stopLossPrice ? parseFloat(trade.stopLossPrice) : null;
    const takeProfit = trade.takeProfitPrice ? parseFloat(trade.takeProfitPrice) : null;

    let triggered: 'stop_loss' | 'take_profit' | null = null;

    if (stopLoss !== null && price <= stopLoss) triggered = 'stop_loss';
    else if (takeProfit !== null && price >= takeProfit) triggered = 'take_profit';

    if (!triggered) return;

    this.logger.log(`Triggering ${triggered} for trade ${trade.id} at price ${price}`);

    const result = await this.tradeExecutor.closeTrade(trade, currentPrice);

    if (result.success) {
      trade.exitPrice = currentPrice;
      trade.closedAt = new Date();
      trade.metadata = { ...(trade.metadata ?? {}), closedBy: triggered };
      await this.tradeRepository.save(trade);

      await this.notificationService.send({
        userId: trade.userId,
        type: triggered === 'stop_loss' ? 'STOP_LOSS_TRIGGERED' : 'TAKE_PROFIT_TRIGGERED',
        title: triggered === 'stop_loss' ? 'Stop-Loss Executed' : 'Take-Profit Executed',
        message:
          triggered === 'stop_loss'
            ? `Your stop-loss was triggered for ${trade.baseAsset}/${trade.counterAsset} at ${currentPrice}`
            : `Your take-profit was triggered for ${trade.baseAsset}/${trade.counterAsset} at ${currentPrice}`,
        channel: NotificationChannel.IN_APP,
        metadata: { tradeId: trade.id, triggerPrice: currentPrice, type: triggered },
      });
    } else {
      this.logger.error(`Failed to close trade ${trade.id} on ${triggered}: ${result.error}`);
    }
  }

  // Stub — in production delegates to a price feed service
  private async getCurrentPrice(_base: string, _counter: string): Promise<string> {
    return '0.15000000';
  }
}
