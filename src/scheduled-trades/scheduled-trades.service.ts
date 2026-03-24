import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  ScheduledTrade,
  ScheduleType,
  ScheduleStatus,
} from './entities/scheduled-trade.entity';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { PriceConditionEvaluator } from './conditions/price-condition.evaluator';
import { TimeConditionEvaluator } from './conditions/time-condition.evaluator';

@Injectable()
export class ScheduledTradesService {
  private readonly logger = new Logger(ScheduledTradesService.name);

  constructor(
    @InjectRepository(ScheduledTrade)
    private readonly repository: Repository<ScheduledTrade>,
    private readonly dataSource: DataSource,
    private readonly priceEvaluator: PriceConditionEvaluator,
    private readonly timeEvaluator: TimeConditionEvaluator,
  ) {}

  async create(dto: CreateScheduleDto): Promise<ScheduledTrade> {
    const trade = this.repository.create(dto);
    return this.repository.save(trade);
  }

  async findAll(userId: string): Promise<ScheduledTrade[]> {
    return this.repository.find({ where: { userId } });
  }

  async findOne(id: string): Promise<ScheduledTrade> {
    const trade = await this.repository.findOne({ where: { id } });
    if (!trade) {
      throw new NotFoundException(`Scheduled trade ${id} not found`);
    }
    return trade;
  }

  async cancel(id: string, userId: string): Promise<ScheduledTrade> {
    const trade = await this.findOne(id);

    if (trade.userId !== userId) {
      throw new ForbiddenException(
        'You are not allowed to cancel this schedule',
      );
    }

    if (trade.status !== ScheduleStatus.PENDING) {
      throw new BadRequestException('Only pending schedules can be cancelled');
    }

    trade.status = ScheduleStatus.CANCELLED;
    return this.repository.save(trade);
  }

  async findPending(): Promise<ScheduledTrade[]> {
    return this.repository.find({ where: { status: ScheduleStatus.PENDING } });
  }

  async getCurrentPrice(assetPair: string): Promise<number | null> {
    const rows = await this.dataSource.query(
      `SELECT price FROM price_history WHERE asset_pair = $1 ORDER BY timestamp DESC LIMIT 1`,
      [assetPair],
    );
    if (!rows || rows.length === 0) {
      return null;
    }
    return parseFloat(rows[0].price);
  }

  async evaluateScheduledTrades(): Promise<void> {
    const pending = await this.findPending();

    for (const schedule of pending) {
      if (schedule.expiresAt && new Date() > new Date(schedule.expiresAt)) {
        await this.updateScheduleStatus(schedule.id, ScheduleStatus.EXPIRED);
        continue;
      }

      let shouldExecute = false;

      if (schedule.scheduleType === ScheduleType.TIME) {
        if (schedule.conditions.executeAt) {
          shouldExecute = this.timeEvaluator.isTimeReached(
            schedule.conditions.executeAt,
          );
        }
      } else if (schedule.scheduleType === ScheduleType.PRICE) {
        const currentPrice = await this.getCurrentPrice(schedule.assetPair);
        if (
          currentPrice !== null &&
          schedule.conditions.targetPrice !== undefined &&
          schedule.conditions.priceCondition
        ) {
          shouldExecute = this.priceEvaluator.evaluate(
            currentPrice,
            schedule.conditions.targetPrice,
            schedule.conditions.priceCondition,
          );
        }
      } else if (schedule.scheduleType === ScheduleType.RECURRING) {
        if (schedule.conditions.recurTime && schedule.conditions.recurrence) {
          shouldExecute = this.timeEvaluator.isRecurrenceTime(
            schedule.conditions.recurTime,
            schedule.conditions.recurrence,
            schedule.executedAt,
          );
        }
      }

      if (shouldExecute) {
        await this.executeTrade(schedule);
      }
    }
  }

  async executeTrade(schedule: ScheduledTrade): Promise<void> {
    try {
      const executedAt = new Date();
      if (schedule.scheduleType === ScheduleType.RECURRING) {
        await this.repository.update(schedule.id, { executedAt });
      } else {
        await this.repository.update(schedule.id, {
          status: ScheduleStatus.EXECUTED,
          executedAt,
        });
      }
      this.logger.log(
        `Executed scheduled trade ${schedule.id} (type=${schedule.scheduleType})`,
      );
    } catch (error: any) {
      const retryCount = (schedule.retryCount || 0) + 1;
      this.logger.error(
        `Failed to execute trade ${schedule.id}: ${error.message}`,
      );
      if (retryCount >= (schedule.maxRetries || 3)) {
        await this.repository.update(schedule.id, {
          status: ScheduleStatus.EXPIRED,
          retryCount,
          lastError: error.message,
        });
      } else {
        await this.repository.update(schedule.id, {
          retryCount,
          lastError: error.message,
        });
      }
    }
  }

  async updateScheduleStatus(
    id: string,
    status: ScheduleStatus,
  ): Promise<void> {
    await this.repository.update(id, { status });
  }
}
