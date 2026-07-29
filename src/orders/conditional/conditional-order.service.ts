import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConditionalOrder } from './conditional-order.entity';
import {
  CreateConditionalOrderDto,
  UpdateConditionalOrderDto,
  ConditionalOrderStatus,
} from './dto/create-conditional-order.dto';
import {
  ConditionGroupDto,
  ConditionType,
  ConditionOperator,
} from './dto/order-condition.dto';
import { Cron, CronExpression } from '@nestjs/schedule';

export interface PriceSnapshot {
  assetCode: string;
  assetIssuer?: string;
  price: number;
  timestamp: Date;
}

@Injectable()
export class ConditionalOrderService {
  private readonly logger = new Logger(ConditionalOrderService.name);

  constructor(
    @InjectRepository(ConditionalOrder)
    private readonly conditionalOrderRepo: Repository<ConditionalOrder>,
  ) {}

  /**
   * Create a new conditional order.
   */
  async create(dto: CreateConditionalOrderDto): Promise<ConditionalOrder> {
    this.logger.log(`Creating conditional order for user ${dto.userId}`);

    if (!dto.conditionGroups || dto.conditionGroups.length === 0) {
      throw new BadRequestException('At least one condition group is required');
    }

    const order = this.conditionalOrderRepo.create({
      userId: dto.userId,
      side: dto.side,
      sellingAssetCode: dto.sellingAssetCode,
      sellingAssetIssuer: dto.sellingAssetIssuer,
      buyingAssetCode: dto.buyingAssetCode,
      buyingAssetIssuer: dto.buyingAssetIssuer,
      amount: dto.amount,
      limitPrice: dto.limitPrice,
      slippageTolerance: dto.slippageTolerance ?? 1,
      conditions: dto.conditionGroups as any,
      status: ConditionalOrderStatus.PENDING,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    });

    return this.conditionalOrderRepo.save(order);
  }

  /**
   * Find a conditional order by ID.
   */
  async findById(id: string): Promise<ConditionalOrder> {
    const order = await this.conditionalOrderRepo.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Conditional order ${id} not found`);
    }
    return order;
  }

  /**
   * List conditional orders for a user with optional status filter.
   */
  async findByUser(
    userId: string,
    status?: ConditionalOrderStatus,
  ): Promise<ConditionalOrder[]> {
    const where: any = { userId };
    if (status) {
      where.status = status;
    }
    return this.conditionalOrderRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Update an existing conditional order (amount, price, conditions).
   */
  async update(
    id: string,
    dto: UpdateConditionalOrderDto,
  ): Promise<ConditionalOrder> {
    const order = await this.findById(id);

    if (
      order.status !== ConditionalOrderStatus.PENDING &&
      order.status !== ConditionalOrderStatus.ACTIVE
    ) {
      throw new BadRequestException(
        `Cannot update order in status ${order.status}`,
      );
    }

    if (dto.amount !== undefined) order.amount = dto.amount;
    if (dto.limitPrice !== undefined) order.limitPrice = dto.limitPrice;
    if (dto.conditionGroups !== undefined)
      order.conditions = dto.conditionGroups as any;
    if (dto.expiresAt !== undefined)
      order.expiresAt = new Date(dto.expiresAt);

    return this.conditionalOrderRepo.save(order);
  }

  /**
   * Cancel a conditional order.
   */
  async cancel(id: string): Promise<ConditionalOrder> {
    const order = await this.findById(id);

    if (
      order.status === ConditionalOrderStatus.FILLED ||
      order.status === ConditionalOrderStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot cancel order in status ${order.status}`,
      );
    }

    order.status = ConditionalOrderStatus.CANCELLED;
    order.cancelledAt = new Date();
    return this.conditionalOrderRepo.save(order);
  }

  /**
   * Evaluate all active conditional orders against current market prices.
   */
  async evaluateConditions(
    priceSnapshots: Map<string, PriceSnapshot>,
  ): Promise<{ triggered: string[]; evaluated: number }> {
    const activeOrders = await this.conditionalOrderRepo.find({
      where: {
        status: In([
          ConditionalOrderStatus.PENDING,
          ConditionalOrderStatus.ACTIVE,
        ]),
      },
    });

    this.logger.debug(
      `Evaluating conditions for ${activeOrders.length} active orders`,
    );

    const triggered: string[] = [];

    for (const order of activeOrders) {
      try {
        const conditionGroups = order.conditions as unknown as ConditionGroupDto[];
        const isMet = this.evaluateConditionGroups(conditionGroups, priceSnapshots);

        if (isMet) {
          order.status = ConditionalOrderStatus.TRIGGERED;
          order.triggeredAt = new Date();
          await this.conditionalOrderRepo.save(order);
          triggered.push(order.id);
          this.logger.log(`Conditional order ${order.id} triggered`);
        }
      } catch (error) {
        this.logger.error(
          `Error evaluating conditions for order ${order.id}: ${(error as Error).message}`,
        );
      }
    }

    return { triggered, evaluated: activeOrders.length };
  }

  /**
   * Execute a triggered order (creates a real trade).
   */
  async executeTriggeredOrder(
    orderId: string,
    tradeId?: string,
  ): Promise<ConditionalOrder> {
    const order = await this.findById(orderId);

    if (order.status !== ConditionalOrderStatus.TRIGGERED) {
      throw new BadRequestException(
        `Order ${orderId} is not in TRIGGERED state (current: ${order.status})`,
      );
    }

    order.status = ConditionalOrderStatus.FILLED;
    order.filledAt = new Date();
    if (tradeId) {
      order.resultingTradeId = tradeId;
    }

    return this.conditionalOrderRepo.save(order);
  }

  /**
   * Mark expired orders.
   */
  async expireStaleOrders(): Promise<number> {
    const now = new Date();
    const result = await this.conditionalOrderRepo
      .createQueryBuilder()
      .update()
      .set({
        status: ConditionalOrderStatus.EXPIRED,
        cancelledAt: now,
        errorMessage: 'Order expired',
      })
      .where('expires_at IS NOT NULL')
      .andWhere('expires_at <= :now', { now })
      .andWhere('status IN (:...statuses)', {
        statuses: [
          ConditionalOrderStatus.PENDING,
          ConditionalOrderStatus.ACTIVE,
        ],
      })
      .execute();

    if (result.affected && result.affected > 0) {
      this.logger.log(`Expired ${result.affected} stale conditional orders`);
    }

    return result.affected ?? 0;
  }

  // ─── Scheduled Jobs ─────────────────────────────────────────────────────────

  /**
   * Periodic evaluation job — runs every minute.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledEvaluation(): Promise<void> {
    this.logger.debug('Running scheduled conditional order evaluation');
    // In production, fetch live prices from a price oracle/feed
    const priceSnapshots = new Map<string, PriceSnapshot>();
    await this.evaluateConditions(priceSnapshots);
  }

  /**
   * Expire stale orders — runs every 5 minutes.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledExpiration(): Promise<void> {
    await this.expireStaleOrders();
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private evaluateConditionGroups(
    groups: ConditionGroupDto[],
    priceSnapshots: Map<string, PriceSnapshot>,
  ): boolean {
    if (!groups || groups.length === 0) return false;
    return groups.some((group) => this.evaluateSingleGroup(group, priceSnapshots));
  }

  private evaluateSingleGroup(
    group: ConditionGroupDto,
    priceSnapshots: Map<string, PriceSnapshot>,
  ): boolean {
    if (!group.conditions || group.conditions.length === 0) return false;
    const operator = group.operator ?? ConditionOperator.AND;

    if (operator === ConditionOperator.AND) {
      return group.conditions.every((condition) =>
        this.evaluateSingleCondition(condition, priceSnapshots),
      );
    } else {
      return group.conditions.some((condition) =>
        this.evaluateSingleCondition(condition, priceSnapshots),
      );
    }
  }

  private evaluateSingleCondition(
    condition: any,
    priceSnapshots: Map<string, PriceSnapshot>,
  ): boolean {
    const { type, value, valueMax, assetCode, assetIssuer } = condition;

    switch (type) {
      case ConditionType.PRICE_ABOVE: {
        const price = this.getPrice(assetCode, assetIssuer, priceSnapshots);
        if (price === null) return false;
        return price > value;
      }
      case ConditionType.PRICE_BELOW: {
        const price = this.getPrice(assetCode, assetIssuer, priceSnapshots);
        if (price === null) return false;
        return price < value;
      }
      case ConditionType.PRICE_BETWEEN: {
        const price = this.getPrice(assetCode, assetIssuer, priceSnapshots);
        if (price === null || valueMax === undefined) return false;
        return price >= value && price <= valueMax;
      }
      case ConditionType.TIME_BASED: {
        return Date.now() >= value;
      }
      case ConditionType.VOLUME_SPIKE:
      case ConditionType.SIGNAL_TRIGGER: {
        const price = this.getPrice(assetCode, assetIssuer, priceSnapshots);
        if (price === null) return false;
        return price >= value;
      }
      default:
        this.logger.warn(`Unknown condition type: ${type}`);
        return false;
    }
  }

  private getPrice(
    assetCode?: string,
    assetIssuer?: string,
    priceSnapshots?: Map<string, PriceSnapshot>,
  ): number | null {
    if (!priceSnapshots || priceSnapshots.size === 0) return null;
    const key = `${assetCode ?? 'XLM'}:${assetIssuer ?? 'native'}`;
    const snapshot = priceSnapshots.get(key);
    return snapshot?.price ?? null;
  }
}

  // ─── Scheduled Jobs ─────────────────────────────────────────────────────────
