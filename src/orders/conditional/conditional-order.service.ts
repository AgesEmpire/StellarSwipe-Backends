import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
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
import { assertOwnership } from '../../authorization/utils/assert-ownership.util';
import { AtomicTransactionHelper } from '../../common/database/atomic-transaction.helper';
import { OutboxService } from '../../events/outbox/outbox.service';
import { assertTransitionAllowed } from './conditional-order-state-machine';
import { updateWithVersionCheck } from '../../common/utils/optimistic-update.util';

export interface OwnershipActor {
  id: string;
  roles?: string[];
}

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
    private readonly atomicTransaction: AtomicTransactionHelper,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Create a new conditional order.
   */
  async create(dto: CreateConditionalOrderDto, actor?: OwnershipActor): Promise<ConditionalOrder> {
    if (actor) {
      assertOwnership({ requesterId: actor.id, ownerId: dto.userId, requesterRoles: actor.roles, resource: 'order' });
    }
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
  async findById(id: string, actor?: OwnershipActor): Promise<ConditionalOrder> {
    const order = await this.conditionalOrderRepo.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Conditional order ${id} not found`);
    }
    if (actor) {
      assertOwnership({ requesterId: actor.id, ownerId: order.userId, requesterRoles: actor.roles, resource: 'order' });
    }
    return order;
  }

  /**
   * List conditional orders for a user with optional status filter.
   */
  async findByUser(
    userId: string,
    status?: ConditionalOrderStatus,
    actor?: OwnershipActor,
  ): Promise<ConditionalOrder[]> {
    if (actor) {
      assertOwnership({ requesterId: actor.id, ownerId: userId, requesterRoles: actor.roles, resource: 'orders' });
    }
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
   *
   * Uses the shared optimistic-concurrency helper: the update only applies
   * if the row's version still matches `expectedVersion` (the version the
   * caller supplied, or the one we just read when they didn't), bumping
   * the version atomically as part of the same UPDATE. A concurrent
   * modification between our read and this write is therefore detected
   * as an OptimisticLockException (409) instead of silently overwritten.
   */
  async update(
    id: string,
    dto: UpdateConditionalOrderDto,
    actor?: OwnershipActor,
  ): Promise<ConditionalOrder> {
    const order = await this.findById(id, actor);

    if (
      order.status !== ConditionalOrderStatus.PENDING &&
      order.status !== ConditionalOrderStatus.ACTIVE
    ) {
      throw new BadRequestException(
        `Cannot update order in status ${order.status}`,
      );
    }

    const expectedVersion = dto.expectedVersion ?? order.version;

    const changes: Partial<ConditionalOrder> = {};
    if (dto.amount !== undefined) changes.amount = dto.amount;
    if (dto.limitPrice !== undefined) changes.limitPrice = dto.limitPrice;
    if (dto.conditionGroups !== undefined)
      changes.conditions = dto.conditionGroups as any;
    if (dto.expiresAt !== undefined)
      changes.expiresAt = new Date(dto.expiresAt);

    await updateWithVersionCheck(
      this.conditionalOrderRepo,
      'ConditionalOrder',
      id,
      expectedVersion,
      changes,
    );

    return this.findById(id, actor);
  }

  /**
   * Cancel a conditional order.
   *
   * Runs inside a DB transaction and takes a pessimistic write lock on the
   * order row before re-checking its status, so a concurrent fill
   * (evaluateConditions -> executeTriggeredOrder) racing against this
   * cancel cannot both apply their effects: whichever transaction acquires
   * the row lock first commits its terminal state, and the other's
   * re-checked transition is then rejected by assertTransitionAllowed.
   * The status change and its outbox event are written atomically, so a
   * failure anywhere in the transaction rolls back both.
   */
  async cancel(id: string, actor?: OwnershipActor): Promise<ConditionalOrder> {
    // Ownership check up front, before taking any lock.
    await this.findById(id, actor);

    return this.atomicTransaction.run(async (queryRunner) => {
      const manager = queryRunner.manager;
      const order = await manager.findOne(ConditionalOrder, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) {
        throw new NotFoundException(`Conditional order ${id} not found`);
      }

      assertTransitionAllowed(order.status, ConditionalOrderStatus.CANCELLED);

      order.status = ConditionalOrderStatus.CANCELLED;
      order.cancelledAt = new Date();
      const saved = await manager.save(ConditionalOrder, order);

      await this.outboxService.record(
        manager,
        'conditional_order.cancelled',
        { orderId: order.id, userId: order.userId },
        `conditional_order.cancelled:${order.id}`,
      );

      return saved;
    });
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
          const wasTriggered = await this.tryTriggerOrder(order.id);
          if (wasTriggered) {
            triggered.push(order.id);
            this.logger.log(`Conditional order ${order.id} triggered`);
          }
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
   * Execute a triggered order (creates a real trade) — the "fill" side of
   * the cancellation-vs-fill race. Locks the row, re-validates the
   * transition, and writes the status change plus its outbox event in one
   * transaction so exactly one balance-affecting fill is ever applied for
   * a given order, and a concurrent cancel cannot silently overwrite it
   * (or vice versa).
   */
  async executeTriggeredOrder(
    orderId: string,
    tradeId?: string,
    actor?: OwnershipActor,
  ): Promise<ConditionalOrder> {
    await this.findById(orderId, actor);

    return this.atomicTransaction.run(async (queryRunner) => {
      const manager = queryRunner.manager;
      const order = await manager.findOne(ConditionalOrder, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) {
        throw new NotFoundException(`Conditional order ${orderId} not found`);
      }

      assertTransitionAllowed(order.status, ConditionalOrderStatus.FILLED);

      order.status = ConditionalOrderStatus.FILLED;
      order.filledAt = new Date();
      if (tradeId) {
        order.resultingTradeId = tradeId;
      }

      const saved = await manager.save(ConditionalOrder, order);

      await this.outboxService.record(
        manager,
        'conditional_order.filled',
        { orderId: order.id, userId: order.userId, tradeId },
        `conditional_order.filled:${order.id}`,
      );

      return saved;
    });
  }

  /**
   * Locks and transitions a single order from PENDING/ACTIVE to TRIGGERED,
   * used by the condition-evaluation sweep. Returns false (rather than
   * throwing) when the order was concurrently cancelled/expired/filled
   * since it was read for evaluation — that is an expected outcome of the
   * race, not a failure worth surfacing as an error.
   */
  private async tryTriggerOrder(orderId: string): Promise<boolean> {
    try {
      return await this.atomicTransaction.run(async (queryRunner) => {
        const manager = queryRunner.manager;
        const order = await manager.findOne(ConditionalOrder, {
          where: { id: orderId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!order) return false;

        assertTransitionAllowed(order.status, ConditionalOrderStatus.TRIGGERED);

        order.status = ConditionalOrderStatus.TRIGGERED;
        order.triggeredAt = new Date();
        await manager.save(ConditionalOrder, order);

        await this.outboxService.record(
          manager,
          'conditional_order.triggered',
          { orderId: order.id, userId: order.userId },
          `conditional_order.triggered:${order.id}`,
        );

        return true;
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        return false;
      }
      throw error;
    }
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
