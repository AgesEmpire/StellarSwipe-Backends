import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Position, PositionStatus } from '../../entities/position.entity';
import { Order, OrderType, OrderSide } from '../../entities/order.entity';
import { SetStopLossDto } from '../dto/set-stop-loss.dto';
import { PriceService } from './price.service';

export interface StopLossCheckResult {
  triggered: boolean;
  position?: Position;
  executedPrice?: number;
  pnl?: number;
  reason?: string;
}

@Injectable()
export class StopLossService {
  private readonly logger = new Logger(StopLossService.name);

  constructor(
    @InjectRepository(Position)
    private readonly positionRepository: Repository<Position>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly priceService: PriceService,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  async setStopLoss(dto: SetStopLossDto): Promise<Position> {
    const position = await this.positionRepository.findOneOrFail({
      where: { id: dto.positionId, status: PositionStatus.OPEN },
      relations: ['user'],
    });

    if (dto.stopLossPrice >= position.entryPrice) {
      throw new Error(
        `Stop-loss price (${dto.stopLossPrice}) must be below entry price (${position.entryPrice}) for long positions`,
      );
    }

    position.stopLossPrice = dto.stopLossPrice;
    position.isTrailingStop = dto.trailing ?? false;
    position.trailingPercent = dto.trailingPercent ?? 5;
    position.highestPrice = position.entryPrice; // seed for trailing logic

    const saved = await this.positionRepository.save(position);
    this.logger.log(`Stop-loss set for position ${position.id} at ${dto.stopLossPrice}`);
    return saved;
  }

  async checkAndExecute(position: Position, currentPrice: number): Promise<StopLossCheckResult> {
    if (!position.stopLossPrice || position.status !== PositionStatus.OPEN) {
      return { triggered: false };
    }

    // Price gap handling: execute even if price blew past stop-loss
    if (currentPrice <= position.stopLossPrice) {
      this.logger.warn(
        `Stop-loss triggered for position ${position.id}: price ${currentPrice} <= stop ${position.stopLossPrice}`,
      );

      try {
        const executedPrice = await this.executeMarketSell(position, currentPrice);
        const pnl = this.calculatePnl(position, executedPrice);

        await this.closePosition(position, executedPrice, 'STOP_LOSS');

        this.eventEmitter.emit('position.stop_loss_hit', {
          position,
          user: position.user,
          currentPrice,
          executedPrice,
          pnl,
        });

        return { triggered: true, position, executedPrice, pnl };
      } catch (err) {
        this.logger.error(`Failed to execute stop-loss for position ${position.id}: ${err.message}`);
        // Emit alert so ops team can handle manually
        this.eventEmitter.emit('position.stop_loss_failed', { position, currentPrice, error: err.message });
        return { triggered: false, reason: err.message };
      }
    }

    return { triggered: false };
  }

  private async executeMarketSell(position: Position, currentPrice: number): Promise<number> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Idempotency: ensure we haven't already created an exit order
      const existingOrder = await queryRunner.manager.findOne(Order, {
        where: { positionId: position.id, type: OrderType.MARKET, side: OrderSide.SELL, exitOrder: true },
      });

      if (existingOrder) {
        await queryRunner.rollbackTransaction();
        this.logger.warn(`Exit order already exists for position ${position.id}, skipping duplicate execution`);
        return existingOrder.filledPrice ?? currentPrice;
      }

      const order = queryRunner.manager.create(Order, {
        positionId: position.id,
        userId: position.userId,
        symbol: position.symbol,
        type: OrderType.MARKET,
        side: OrderSide.SELL,
        quantity: position.quantity,
        exitOrder: true,
        requestedPrice: currentPrice,
        filledPrice: currentPrice, // In production, send to exchange and await fill
        status: 'FILLED',
      });

      await queryRunner.manager.save(Order, order);
      await queryRunner.commitTransaction();

      this.logger.log(`Market sell executed for position ${position.id} at ~${currentPrice}`);
      return currentPrice;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  private async closePosition(position: Position, exitPrice: number, reason: string): Promise<void> {
    position.status = PositionStatus.CLOSED;
    position.exitPrice = exitPrice;
    position.exitReason = reason;
    position.closedAt = new Date();
    await this.positionRepository.save(position);
  }

  private calculatePnl(position: Position, exitPrice: number): number {
    return (exitPrice - position.entryPrice) * position.quantity;
  }
}
