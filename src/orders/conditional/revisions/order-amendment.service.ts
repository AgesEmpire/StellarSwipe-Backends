import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConditionalOrder } from '../conditional-order.entity';
import { ConditionalOrderStatus } from '../dto/create-conditional-order.dto';
import { ConditionGroupDto } from '../dto/order-condition.dto';
import { ConditionalOrderRevision, RevisionFieldChange } from './conditional-order-revision.entity';
import { AtomicTransactionHelper } from '../../../common/database/atomic-transaction.helper';
import { OutboxService } from '../../../events/outbox/outbox.service';
import { OptimisticLockException } from '../../../common/exceptions/optimistic-lock.exception';
import { assertOwnership } from '../../../authorization/utils/assert-ownership.util';

/** Order fields an amendment may change. Everything else (status, timestamps…) is not amendable. */
export const AMENDABLE_FIELDS = ['amount', 'limitPrice', 'conditions', 'expiresAt'] as const;
export type AmendableField = (typeof AMENDABLE_FIELDS)[number];
export type AmendableValues = Record<AmendableField, unknown>;

export const AMENDABLE_STATUSES: ConditionalOrderStatus[] = [
  ConditionalOrderStatus.PENDING,
  ConditionalOrderStatus.ACTIVE,
];

export const MIN_REASON_LENGTH = 3;
export const MAX_REASON_LENGTH = 500;

export interface AmendmentActor {
  id: string;
  roles?: string[];
  /** Internal callers with no end-user identity; skips the ownership check. */
  system?: boolean;
}

export interface AmendOrderInput {
  reason: string;
  /** If set, the amendment is rejected (409) unless the order is still at this version. */
  expectedVersion?: number;
  amount?: number;
  limitPrice?: number;
  conditionGroups?: ConditionGroupDto[];
  expiresAt?: string;
}

export interface AmendOrderResult {
  order: ConditionalOrder;
  revision: ConditionalOrderRevision;
}

export interface OrderStateAtRevision {
  orderId: string;
  revisionNumber: number;
  /** Amendable values as they were right after `revisionNumber` was applied (0 = as created). */
  values: AmendableValues;
  revision: ConditionalOrderRevision | null;
}

/** Canonical comparable form of each amendable field (decimals arrive from PG as strings). */
function normalize(field: AmendableField, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  switch (field) {
    case 'amount':
    case 'limitPrice':
      return Number(value);
    case 'expiresAt':
      return new Date(value as string | Date).toISOString();
    case 'conditions':
      return JSON.parse(JSON.stringify(value));
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function snapshotAmendable(order: ConditionalOrder): AmendableValues {
  return {
    amount: normalize('amount', order.amount),
    limitPrice: normalize('limitPrice', order.limitPrice),
    conditions: normalize('conditions', order.conditions),
    expiresAt: normalize('expiresAt', order.expiresAt),
  };
}

/**
 * Applies amendments to conditional orders and keeps an append-only revision
 * history of every accepted change (#1529).
 *
 * Each amendment runs in one transaction that takes a row lock on the order,
 * re-validates status and (optionally) the caller's expected version under that
 * lock, applies the change, and inserts the revision. Concurrent amendments are
 * therefore serialized: revision numbers are gap-free and each revision's
 * "previous" values are exactly the prior revision's "requested" values. If
 * anything fails, the order update and its revision roll back together.
 */
@Injectable()
export class OrderAmendmentService {
  private readonly logger = new Logger(OrderAmendmentService.name);

  constructor(
    @InjectRepository(ConditionalOrder)
    private readonly orderRepo: Repository<ConditionalOrder>,
    @InjectRepository(ConditionalOrderRevision)
    private readonly revisionRepo: Repository<ConditionalOrderRevision>,
    private readonly atomicTransaction: AtomicTransactionHelper,
    private readonly outboxService: OutboxService,
  ) {}

  async amend(orderId: string, input: AmendOrderInput, actor: AmendmentActor): Promise<AmendOrderResult> {
    if (!actor?.id) {
      throw new BadRequestException('An authenticated actor is required to amend an order');
    }
    const reason = this.validateReason(input?.reason);
    const requested = this.buildRequestedValues(input);

    return this.atomicTransaction.run(async (queryRunner) => {
      const manager = queryRunner.manager;
      const order = await manager.findOne(ConditionalOrder, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) {
        throw new NotFoundException(`Conditional order ${orderId} not found`);
      }
      if (!actor.system) {
        assertOwnership({
          requesterId: actor.id,
          ownerId: order.userId,
          requesterRoles: actor.roles,
          resource: 'order',
        });
      }
      if (!AMENDABLE_STATUSES.includes(order.status)) {
        throw new BadRequestException(`Cannot update order in status ${order.status}`);
      }
      if (input.expectedVersion !== undefined && input.expectedVersion !== order.version) {
        throw new OptimisticLockException('ConditionalOrder', orderId);
      }

      const before = snapshotAmendable(order);
      const changedFields: Record<string, RevisionFieldChange> = {};
      for (const [field, value] of Object.entries(requested) as [AmendableField, unknown][]) {
        if (!sameValue(before[field], value)) {
          changedFields[field] = { previous: before[field], requested: value };
        }
      }
      if (Object.keys(changedFields).length === 0) {
        throw new BadRequestException('Amendment does not change any order field');
      }

      const versionBefore = order.version;
      this.applyChanges(order, changedFields);
      const saved = await manager.save(ConditionalOrder, order);
      const versionAfter = saved.version ?? versionBefore + 1;

      const latest = await manager.findOne(ConditionalOrderRevision, {
        where: { orderId },
        order: { revisionNumber: 'DESC' },
      });
      const revision = manager.create(ConditionalOrderRevision, {
        orderId,
        revisionNumber: (latest?.revisionNumber ?? 0) + 1,
        actorId: actor.id,
        actorRoles: actor.roles ?? [],
        reason,
        changedFields,
        requestedValues: requested,
        orderVersionBefore: versionBefore,
        orderVersionAfter: versionAfter,
        amendedAt: new Date(),
      });
      await manager.insert(ConditionalOrderRevision, revision);

      await this.outboxService.record(
        manager,
        'conditional_order.amended',
        {
          orderId,
          userId: order.userId,
          revisionNumber: revision.revisionNumber,
          changedFields: Object.keys(changedFields),
          actorId: actor.id,
        },
        `conditional_order.amended:${orderId}:${revision.revisionNumber}`,
      );

      this.logger.log(
        `Order ${orderId} amended to revision ${revision.revisionNumber} by ${actor.id} (${Object.keys(changedFields).join(', ')})`,
      );
      return { order: saved, revision };
    });
  }

  /** Full revision history, oldest first. */
  async listRevisions(orderId: string, actor?: AmendmentActor): Promise<ConditionalOrderRevision[]> {
    await this.loadOrderForRead(orderId, actor);
    return this.revisionRepo.find({ where: { orderId }, order: { revisionNumber: 'ASC' } });
  }

  /**
   * Reconstructs the order's amendable values as they stood right after
   * `revisionNumber` (0 = as originally created) by walking back from the
   * current order through later revisions' "previous" values.
   */
  async getStateAtRevision(
    orderId: string,
    revisionNumber: number,
    actor?: AmendmentActor,
  ): Promise<OrderStateAtRevision> {
    if (!Number.isInteger(revisionNumber) || revisionNumber < 0) {
      throw new BadRequestException('revisionNumber must be a non-negative integer');
    }
    const order = await this.loadOrderForRead(orderId, actor);
    const revisions = await this.revisionRepo.find({ where: { orderId }, order: { revisionNumber: 'ASC' } });
    const latest = revisions.length ? revisions[revisions.length - 1].revisionNumber : 0;
    if (revisionNumber > latest) {
      throw new NotFoundException(`Order ${orderId} has no revision ${revisionNumber}`);
    }

    const values = snapshotAmendable(order);
    for (const rev of [...revisions].reverse()) {
      if (rev.revisionNumber <= revisionNumber) break;
      for (const [field, change] of Object.entries(rev.changedFields)) {
        values[field as AmendableField] = change.previous;
      }
    }

    return {
      orderId,
      revisionNumber,
      values,
      revision: revisions.find((r) => r.revisionNumber === revisionNumber) ?? null,
    };
  }

  private async loadOrderForRead(orderId: string, actor?: AmendmentActor): Promise<ConditionalOrder> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException(`Conditional order ${orderId} not found`);
    }
    if (actor && !actor.system) {
      assertOwnership({ requesterId: actor.id, ownerId: order.userId, requesterRoles: actor.roles, resource: 'order' });
    }
    return order;
  }

  private validateReason(reason: unknown): string {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (trimmed.length < MIN_REASON_LENGTH || trimmed.length > MAX_REASON_LENGTH) {
      throw new BadRequestException(
        `An amendment reason of ${MIN_REASON_LENGTH}-${MAX_REASON_LENGTH} characters is required`,
      );
    }
    return trimmed;
  }

  private buildRequestedValues(input: AmendOrderInput): Partial<AmendableValues> {
    const requested: Partial<AmendableValues> = {};
    if (input.amount !== undefined) {
      if (!(Number(input.amount) > 0)) throw new BadRequestException('amount must be positive');
      requested.amount = normalize('amount', input.amount);
    }
    if (input.limitPrice !== undefined) {
      if (!(Number(input.limitPrice) > 0)) throw new BadRequestException('limitPrice must be positive');
      requested.limitPrice = normalize('limitPrice', input.limitPrice);
    }
    if (input.conditionGroups !== undefined) {
      if (!Array.isArray(input.conditionGroups) || input.conditionGroups.length === 0) {
        throw new BadRequestException('At least one condition group is required');
      }
      requested.conditions = normalize('conditions', input.conditionGroups);
    }
    if (input.expiresAt !== undefined) {
      if (Number.isNaN(new Date(input.expiresAt).getTime())) {
        throw new BadRequestException('expiresAt must be a valid ISO date');
      }
      requested.expiresAt = normalize('expiresAt', input.expiresAt);
    }
    if (Object.keys(requested).length === 0) {
      throw new BadRequestException(`Provide at least one of: ${AMENDABLE_FIELDS.join(', ')}`);
    }
    return requested;
  }

  private applyChanges(order: ConditionalOrder, changes: Record<string, RevisionFieldChange>): void {
    for (const [field, { requested }] of Object.entries(changes)) {
      switch (field as AmendableField) {
        case 'amount':
          order.amount = requested as number;
          break;
        case 'limitPrice':
          order.limitPrice = requested as number;
          break;
        case 'conditions':
          order.conditions = requested as Record<string, any>;
          break;
        case 'expiresAt':
          order.expiresAt = requested === null ? undefined : new Date(requested as string);
          break;
      }
    }
  }
}
