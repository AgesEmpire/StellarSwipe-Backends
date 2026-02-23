import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Position, PositionStatus } from '../../entities/position.entity';
import { Order, OrderType, OrderSide } from '../../entities/order.entity';
import { SetTakeProfitDto, TakeProfitLevel } from '../dto/set-take-profit.dto';

export interface TakeProfitCheckResult {
  triggered: boolean;
  level?: TakeProfitLevel;
  executedPrice?: number;
  pnl?: number;
  fullyClose?: boolean;
}

@Injectable()
export class TakeProfitService {
  private readonly logger = new Logger(TakeProfitService.name);

  constructor(
    @InjectRepository(Position)
    private readonly positionRepository: Repository<Position>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  async setTakeProfit(dto: SetTakeProfitDto): Promise<Position> {
    const position = await this.positionRepository.findOneOrFail({
      where: { id: dto.positionId, status: PositionStatus.OPEN },
      relations: ['user'],
    });

    if (dto.takeProfitPrice <= position.entryPrice) {
      throw new Error(
        `Take-profit price (${dto.takeProfitPrice}) must be above entry price (${position.entryPrice})`,
      );
    }

    position.takeProfitPrice = dto.takeProfitPrice;
    position.takeProfitLevels = dto.levels ?? null;

    const saved = await this.positionRepository.save(position);
    this.logger.log(`Take-profit set for position ${position.id} at ${dto.takeProfitPrice}`);
    return saved;
  }

  async checkAndExecute(position: Position, currentPrice: number): Promise<TakeProfitCheckResult> {
    if (!position.takeProfitPrice || position.status !== PositionStatus.OPEN) {
      return { triggered: false };
    }

    // Multi-level take profit: check each level in descending order
    if (position.takeProfitLevels?.length) {
      return this.checkMultiLevel(position, currentPrice);
    }

    // Single take-profit level
    if (currentPrice >= position.takeProfitPrice) {
      this.logger.log(
        `Take-profit triggered for position ${position.id}: price ${currentPrice} >= target ${position.takeProfitPrice}`,
      );

      try {
        const executedPrice = await this.executePartialOrFullSell(position, currentPrice, 100);
        const pnl = (executedPrice - position.entryPrice) * position.quantity;

        await this.closePosition(position, executedPrice, 'TAKE_PROFIT');

        this.eventEmitter.emit('position.take_profit_hit', {
          position,
          user: position.user,
          currentPrice,
          executedPrice,
          pnl,
        });

        return { triggered: true, executedPrice, pnl, fullyClose: true };
      } catch (err) {
        this.logger.error(`Failed to execute take-profit for position ${position.id}: ${err.message}`);
        this.eventEmitter.emit('position.take_profit_failed', { position, currentPrice, error: err.message });
        return { triggered: false };
      }
    }

    return { triggered: false };
  }

  private async checkMultiLevel(position: Position, currentPrice: number): Promise<TakeProfitCheckResult> {
    const remainingLevels = (position.takeProfitLevels ?? [])
      .filter((l) => !l['executed'])
      .sort((a, b) => a.price - b.price);

    const hitLevel = remainingLevels.find((l) => currentPrice >= l.price);
    if (!hitLevel) return { triggered: false };

    this.logger.log(
      `Take-profit level ${hitLevel.price} triggered for position ${position.id} (${hitLevel.closePercent}%)`,
    );

    const quantityToSell = (position.quantity * hitLevel.closePercent) / 100;
    const executedPrice = await this.executePartialOrFullSell(position, currentPrice, hitLevel.closePercent);
    const pnl = (executedPrice - position.entryPrice) * quantityToSell;

    // Mark level as executed
    hitLevel['executed'] = true;
    const allExecuted = position.takeProfitLevels!.every((l) => l['executed']);

    if (allExecuted) {
      await this.closePosition(position, executedPrice, 'TAKE_PROFIT_ALL_LEVELS');
    } else {
      position.quantity -= quantityToSell;
      await this.positionRepository.save(position);
    }

    this.eventEmitter.emit('position.take_profit_level_hit', {
      position,
      user: position.user,
      level: hitLevel,
      currentPrice,
      executedPrice,
      pnl,
      fullyClose: allExecuted,
    });

    return { triggered: true, level: hitLevel, executedPrice, pnl, fullyClose: allExecuted };
  }

  private async executePartialOrFullSell(
    position: Position,
    currentPrice: number,
    percent: number,
  ): Promise<number> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const quantity = (position.quantity * percent) / 100;

      const order = queryRunner.manager.create(Order, {
        positionId: position.id,
        userId: position.userId,
        symbol: position.symbol,
        type: OrderType.MARKET,
        side: OrderSide.SELL,
        quantity,
        exitOrder: true,
        requestedPrice: currentPrice,
        filledPrice: currentPrice,
        status: 'FILLED',
      });

      await queryRunner.manager.save(Order, order);
      await queryRunner.commitTransaction();
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
}
